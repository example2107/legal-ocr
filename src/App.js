import React, { useState, useRef, useCallback, useEffect } from 'react';
import { analyzePD, analyzePastedText, PD_ANALYSIS_CHAR_LIMIT } from './utils/claudeApi';
import { parseDocx } from './utils/docxParser';
import AppHeader from './components/AppHeader';
import AuthScreen from './components/AuthScreen';
import HomeProjectsView from './components/HomeProjectsView';
import PdFragmentEditorModal from './components/PdFragmentEditorModal';
import PdRecordEditorModal from './components/PdRecordEditorModal';
import ProcessingView from './components/ProcessingView';
import ProjectWorkspaceView from './components/ProjectWorkspaceView';
import { buildAnnotatedHtml, buildPdMatchPattern, patchPdMarks, initPdMarkOriginals } from './components/RichEditor';
import ResultWorkspaceView from './components/ResultWorkspaceView';
import { useAuth } from './context/AuthContext';
import { useStoredData } from './hooks/useStoredData';
import { buildLoadedDocumentState, getClearedWorkspaceState } from './utils/documentViewState';
import { generateId, exportDocument, importDocument } from './utils/history';
import { getOriginalImageIndexForPage } from './utils/originalImagePages';
import { getProjectSummaryDocEntry, mergeProjectDocument, saveProjectSummaryDocument } from './utils/projectDocumentOps';
import {
  addDocumentToProjectRecord,
  buildSourceFileKey,
  createProjectRecord,
  deleteDocumentRecord,
  deleteProjectRecord,
  removeDocumentFromProjectRecord,
  saveDocumentRecord,
  saveProjectRecord,
  updateProjectBatchSessionRecord,
  updateProjectSharedPDRecord,
  uploadSourceFile,
} from './utils/dataStore';
import { formatProjectChunkPageRange, getProjectPdfChunkEnd } from './utils/projectBatch';
import { exportRichTextPdf } from './utils/pdfExportFlow';
import { runProjectBatchRecognition } from './utils/runProjectBatchRecognition';
import './App.css';

const ALPHA_PRIVATE = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЭЮЯ'.split('').map(l => l + '.');
const OTHER_PD_TYPES_MAP = {
  address: 'адрес', phone: 'телефон', passport: 'паспорт', zagranpassport: 'загранпаспорт',
  inn: 'ИНН', snils: 'СНИЛС', card: 'карта', email: 'email', dob: 'дата рождения',
  birthplace: 'место рождения', vehicle_plate: 'номер авто', vehicle_vin: 'VIN',
  driver_license: 'вод. удостоверение', military_id: 'военный билет', oms_policy: 'полис ОМС',
  birth_certificate: 'свид. о рождении', imei: 'IMEI', other: 'ПД',
};
const makeProfletter = (n) => `[ФИО ${n}]`;

function normalizePdText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dedupeMentions(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values || []) {
    const value = normalizePdText(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function getPersonMentions(person) {
  return dedupeMentions([person?.fullName, ...(person?.mentions || [])]);
}

function getOtherPdMentions(item) {
  return dedupeMentions([item?.value, ...(item?.mentions || [])]);
}

function buildCanonicalPersonMentions(fullName) {
  const normalized = normalizePdText(fullName);
  if (!normalized) return [];

  const words = normalized.split(/\s+/).filter(Boolean);
  const surname = words[0] || '';
  const initials = words.slice(1)
    .flatMap(word => {
      const letters = word.match(/[A-Za-zА-Яа-яЁё]/g) || [];
      if (letters.length === 0) return [];
      if (/[.,]/.test(word)) return letters.slice(0, 2);
      return [letters[0]];
    })
    .map(letter => letter.toUpperCase())
    .slice(0, 2);
  const initialsText = initials.map(letter => `${letter}.`).join('');

  return dedupeMentions([
    normalized,
    surname,
    initialsText ? `${surname} ${initialsText}` : '',
    initialsText ? `${initialsText} ${surname}` : '',
  ]);
}

function formatDocumentPageProgress(doc) {
  if (!doc?.pageTo) return '';
  if (doc?.totalPages) return `${doc.pageTo} из ${doc.totalPages}`;
  return `${doc.pageTo}`;
}

function parseCssSize(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value || '').replace('px', '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBatchStatusTitle(status, sourceKind = 'pdf') {
  const subject = sourceKind === 'image' ? 'изображений' : 'PDF';
  if (status === 'failed') return `Обработка ${subject} остановлена`;
  if (status === 'paused') return 'Обработка приостановлена';
  if (status === 'pausing') return 'Пауза будет поставлена';
  if (status === 'running') return `Идёт обработка ${subject}`;
  return `Есть незавершённая обработка ${subject}`;
}

function getBatchResumeText({
  nextPage,
  totalPages,
  chunkSize,
  sourceKind = 'pdf',
}) {
  return `Продолжение: ${formatProjectChunkPageRange(
    nextPage,
    getProjectPdfChunkEnd(nextPage, totalPages, chunkSize || 1),
    totalPages,
    sourceKind
  )}.`;
}

function getBatchSourceSelectionHint(sourceKind = 'pdf') {
  if (sourceKind === 'image') return 'Для продолжения выберите тот же набор изображений.';
  return 'Для продолжения выберите тот же PDF.';
}

function mergeBatchUiState(prevState, nextState) {
  if (!nextState) return null;
  if (!prevState) return nextState;
  if (prevState.status !== 'pausing') return nextState;
  if (!['running', 'pausing'].includes(nextState.status)) return nextState;

  return {
    ...nextState,
    status: 'pausing',
    message: prevState.message || 'Пауза будет поставлена после текущей страницы.',
  };
}

function assignLetters(personalData, existingPD) {
  // Если есть существующая база — продолжаем нумерацию с того места где остановились
  let pi = 0, pf = 0;
  if (existingPD) {
    pi = (existingPD.persons || []).filter(p => p.category === 'private').length;
    pf = (existingPD.persons || []).filter(p => p.category === 'professional').length;
  }
  return {
    ...personalData,
    persons: (personalData.persons || []).map(p => ({
      ...p,
      letter: p.letter || (p.category === 'private'
        ? (ALPHA_PRIVATE[pi] !== undefined ? ALPHA_PRIVATE[pi++] : `Л-${++pi}`)
        : makeProfletter(++pf)),
    })),
  };
}

// Мёржит новые ПД с существующей базой: известные лица сохраняют буквы, новые добавляются
function mergePD(existingPD, newPD) {
  const merged = {
    persons: [...(existingPD.persons || [])],
    otherPD: [...(existingPD.otherPD || [])],
  };

  // Нормализация строки для сравнения otherPD
  const normalizeValue = (s) => normalizePdText(s).toLowerCase();

  // Мёржим persons — по совпадению fullName
  for (const newP of (newPD.persons || [])) {
    const existing = merged.persons.find(p =>
      p.fullName.toLowerCase() === newP.fullName.toLowerCase()
    );
    if (existing) {
      // Добавляем новые mentions к уже известному лицу
      const existingMentions = new Set(getPersonMentions(existing).map(m => m.toLowerCase()));
      const addedMentions = getPersonMentions(newP).filter(m => !existingMentions.has(m.toLowerCase()));
      if (addedMentions.length > 0) {
        existing.mentions = dedupeMentions([...(existing.mentions || []), ...addedMentions]);
      }
      // Обновляем роль если была пустая
      if (!existing.role && newP.role) existing.role = newP.role;
    } else {
      // Новое лицо — добавляем (letter назначит assignLetters)
      merged.persons.push({ ...newP });
    }
  }

  // Мёржим otherPD — по совпадению type + нормализованного value
  for (const newItem of (newPD.otherPD || [])) {
    const nv = normalizeValue(newItem.value);
    const exists = merged.otherPD.some(it =>
      it.type === newItem.type && normalizeValue(it.value) === nv
    );
    if (!exists) {
      merged.otherPD.push({ ...newItem });
    } else {
      const existing = merged.otherPD.find(it =>
        it.type === newItem.type && normalizeValue(it.value) === nv
      );
      if (existing) {
        existing.mentions = dedupeMentions([...(existing.mentions || []), ...getOtherPdMentions(newItem)]);
      }
    }
  }

  return merged;
}

const VIEW_HOME = 'home';
const VIEW_PROCESSING = 'processing';
const VIEW_RESULT = 'result';
const VIEW_PROJECT = 'project';
const BATCH_PROGRESS_STORAGE_KEY = 'legal_ocr_batch_progress';

function loadBatchProgressSnapshot() {
  try {
    const raw = localStorage.getItem(BATCH_PROGRESS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveBatchProgressSnapshot(snapshot) {
  try {
    if (!snapshot) {
      localStorage.removeItem(BATCH_PROGRESS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(BATCH_PROGRESS_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {}
}

export default function App() {
  const { user, loading: authLoading, isConfigured, signInWithPassword, signUpWithPassword, signOut } = useAuth();
  const userId = user?.id || null;
  const [view, setView] = useState(VIEW_HOME);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [provider, setProvider] = useState('claude');

  // ── Projects ──────────────────────────────────────────────────────────────
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);
  const [editingPdId, setEditingPdId] = useState(null);
  const [editingPdFragment, setEditingPdFragment] = useState(null);
  const [inputTab, setInputTab] = useState('documents'); // 'documents' | 'docx' | 'text'
  const [pdIdsInDoc, setPdIdsInDoc] = useState(null); // Set of PD ids present in current doc, or null if not in project

  const [files, setFiles] = useState([]);
  const [docxFiles, setDocxFiles] = useState([]);
  const [pastedText, setPastedText] = useState('');
  const [originalImages, setOriginalImages] = useState([]); // for file viewer
  const [showOriginal, setShowOriginal] = useState(false);
  const [originalPage, setOriginalPage] = useState(0);
  const [zoomActive, setZoomActive] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [, setZoomOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);


  const [progress, setProgress] = useState(null);
  const [activeBatchUiState, setActiveBatchUiState] = useState(null);
  const [persistedBatchUiState, setPersistedBatchUiState] = useState(() => loadBatchProgressSnapshot());
  const progressCreepRef = useRef(null);
  const activeBatchControlRef = useRef({
    projectId: null,
    pauseRequested: false,
    targetView: null,
  });

  const setNonDecreasingProgress = useCallback((next) => {
    setProgress(prev => prev && prev.percent > next.percent
      ? { ...prev, message: next.message }
      : next
    );
  }, []);

  // Animate progress bar smoothly to a target integer value
  const animateTo = useCallback((target, message) => {
    if (progressCreepRef.current) clearInterval(progressCreepRef.current);
    progressCreepRef.current = setInterval(() => {
      setProgress(prev => {
        if (!prev) return prev;
        const cur = Math.round(prev.percent);
        // Никогда не уменьшаем прогресс
        const safeTarget = Math.max(target, cur);
        if (cur >= safeTarget) {
          clearInterval(progressCreepRef.current);
          return { ...prev, percent: safeTarget, message: message || prev.message };
        }
        const step = Math.max(1, Math.round((safeTarget - cur) / 5));
        return { ...prev, percent: Math.min(cur + step, safeTarget) };
      });
    }, 100);
  }, []);

  const stopProgressCreep = useCallback(() => {
    if (progressCreepRef.current) {
      clearInterval(progressCreepRef.current);
      progressCreepRef.current = null;
    }
  }, []);
  const [error, setError] = useState(null);
  const [warningMessage, setWarningMessage] = useState(null);

  const [docId, setDocId] = useState(null);
  const [docTitle, setDocTitle] = useState('');
  const [originalFileName, setOriginalFileName] = useState('');
  const [sourceFiles, setSourceFiles] = useState([]);
  const [pageMetadata, setPageMetadata] = useState(null);
  const [rawText, setRawText] = useState('');
  // editorHtml is only used for initial load and save/export — NOT rebuilt on every anonymize
  const [editorHtml, setEditorHtml] = useState('');
  const [personalData, setPersonalData] = useState({ persons: [], otherPD: [], ambiguousPersons: [] });
  // anonymized: { [id]: bool }
  const [anonymized, setAnonymized] = useState({});
  const [lastSavedState, setLastSavedState] = useState(null);

  const [showUnsaved, setShowUnsaved] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [showUncertainWarning, setShowUncertainWarning] = useState(false);
  const [editorCurrentPage, setEditorCurrentPage] = useState(null);
  const [editorTotalPages, setEditorTotalPages] = useState(null);
  const [editorPageInput, setEditorPageInput] = useState('');
  const [showLongDocWarning, setShowLongDocWarning] = useState(false);
  const [highlightUncertain, setHighlightUncertain] = useState(false);
  const [pendingExportAction, setPendingExportAction] = useState(null); // 'save'|'pdf'|'docx'
  const pendingNavRef = useRef(null);
  const projectFileInputRef = useRef();
  const projectDocxInputRef = useRef();
  const projectImportRef = useRef();
  const editorPageInputRef = useRef(null);
  const editorNavigatingPageRef = useRef(null);
  const editorPageNavigationTimerRef = useRef(null);
  const uploadedFilesRef = useRef(new Map());

  const handleStoredDataError = useCallback((message) => {
    setError(message);
  }, []);

  const handleStoredDataSignedOut = useCallback(() => {
    setCurrentProjectId(null);
    uploadedFilesRef.current.clear();
  }, []);

  const syncOriginalViewerToDocumentPage = useCallback((pageNumber) => {
    const imageIndex = getOriginalImageIndexForPage(originalImages, pageNumber);
    if (imageIndex < 0) return;
    setOriginalPage(imageIndex);
  }, [originalImages]);

  const handleToggleOriginalViewer = useCallback(() => {
    setShowOriginal((visible) => !visible);
    setOriginalPage(0);
  }, []);

  const handleLoadOriginalViewerImages = useCallback((allImages) => {
    setOriginalImages(allImages);
    setShowOriginal(true);
    setOriginalPage(0);
  }, []);

  const {
    dataLoading,
    history,
    projects,
    refreshHistory,
    refreshProjects,
    setProjects,
  } = useStoredData({
    authLoading,
    isConfigured,
    userId,
    onError: handleStoredDataError,
    onSignedOut: handleStoredDataSignedOut,
  });

  useEffect(() => {
    if (!activeBatchUiState) return;
    saveBatchProgressSnapshot(activeBatchUiState);
    setPersistedBatchUiState(activeBatchUiState);
  }, [activeBatchUiState]);

  useEffect(() => {
    const handler = () => {
      if (!activeBatchUiState) return;
      if (!['running', 'pausing'].includes(activeBatchUiState.status)) return;
      const pausedSnapshot = {
        ...activeBatchUiState,
        status: 'paused',
        message: activeBatchUiState.message || 'Обработка была приостановлена после обновления страницы.',
      };
      saveBatchProgressSnapshot(pausedSnapshot);
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activeBatchUiState]);

  const removeAmbiguousEntry = useCallback((pd, markEl) => {
    if (!markEl) return pd;
    const value = markEl.dataset?.value || '';
    const context = markEl.dataset?.context || '';
    const reason = markEl.dataset?.reason || '';
    return {
      ...pd,
      ambiguousPersons: (pd.ambiguousPersons || []).filter(item =>
        !(
          (item?.value || '') === value &&
          (item?.context || '') === context &&
          (item?.reason || '') === reason
        )
      ),
    };
  }, []);

  // ── Resizable panels ──────────────────────────────────────────────────────
  const getDefaultPdWidth = () => window.innerWidth >= 1800 ? 300 : window.innerWidth >= 1400 ? 270 : 240;
  const getDefaultViewerWidth = () => {
    const vw = window.innerWidth;
    if (vw >= 1800) return 500;
    if (vw >= 1400) return 440;
    return 400;  // MacBook 14" (1512px) — достаточно, чтобы кнопка "Скрыть" не обрезалась
  };
  const [pdWidth, setPdWidth] = React.useState(getDefaultPdWidth);
  const [viewerWidth, setViewerWidth] = React.useState(getDefaultViewerWidth);

  const startResize = React.useCallback((type) => (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startPd = pdWidth;
    const startViewer = viewerWidth;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const vw = window.innerWidth;
      if (type === 'pd') {
        const maxPd = Math.min(400, Math.round(vw * 0.22));
        setPdWidth(Math.max(160, Math.min(maxPd, startPd + dx)));
      } else {
        const maxViewer = Math.min(700, Math.round(vw * 0.4));
        setViewerWidth(Math.max(220, Math.min(maxViewer, startViewer - dx)));
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [pdWidth, viewerWidth]);



  // Direct ref to the editor DOM element — used for DOM patching
  const editorDomRef = useRef(null);

  // Global Ctrl-Z / Ctrl-Shift-Z / Ctrl-Y — works regardless of which element has focus
  useEffect(() => {
    const handler = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const isUndo = (e.key === 'z' || e.code === 'KeyZ') && !e.shiftKey;
      const isRedo = ((e.key === 'z' || e.code === 'KeyZ') && e.shiftKey)
                  || (e.key === 'y' || e.code === 'KeyY');
      if (!isUndo && !isRedo) return;
      const tag = document.activeElement?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (undoStackRef.current.length === 0) return;
      e.preventDefault();
      if (isUndo) performUndo(); else performRedo();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }); // no deps — intentionally runs every render so closures are always fresh
  // Timer ref for deferred PD cleanup after editing
  const pdCleanupTimerRef = useRef(null);
  // Sync refs — always hold latest values so snapshot is always accurate
  const pdRef   = useRef({ persons: [], otherPD: [], ambiguousPersons: [] });
  const anonRef = useRef({});
  // Undo stack
  const undoStackRef  = useRef([]); // array of {html, pd, anon}
  const undoIndexRef  = useRef(-1);
  const MAX_UNDO = 80;
  const headerRef = useRef(null);
  // Ref to doc-title-row — used to measure its height for --toolbar-top CSS var
  const titleRowRef = useRef(null);
  // Callback-ref for pd-panel — prevents wheel events from bleeding to page scroll
  const pdPanelRef = useRef(null);
  const setPdPanelRef = useCallback((el) => {
    if (pdPanelRef.current) {
      pdPanelRef.current.removeEventListener('wheel', pdPanelRef._wheelHandler);
    }
    pdPanelRef.current = el;
    if (!el) return;
    const handler = (e) => {
      const { scrollHeight, clientHeight } = el;
      const isScrollable = scrollHeight > clientHeight;
      // Panel fits entirely → let page scroll normally
      if (!isScrollable) return;
      // Panel is scrollable → prevent page scroll entirely while cursor is inside.
      // We need preventDefault (not just stopPropagation) because browsers handle
      // scroll-chaining at compositor level, ignoring stopPropagation.
      // Manually scroll the panel ourselves to compensate.
      e.preventDefault();
      el.scrollTop += e.deltaY;
    };
    pdPanelRef._wheelHandler = handler;
    // passive: false is required to allow preventDefault()
    el.addEventListener('wheel', handler, { passive: false });
  }, []);
  // Navigation state: tracks current mark index per pd-id for ↑↓ cycling
  const pdNavIndexRef = useRef({});
  // Reactive counter state: { [id]: { cur: number, total: number } }
  // cur === -1 means "not navigated yet / idle" → show just total
  const [pdNavState, setPdNavState] = useState({});
  // Idle reset timers: after 10s of inactivity, reset cur to -1 (display-only)
  const pdNavTimerRef = useRef({});

  // On hover: initialise counter total from DOM (without changing cur position)
  const initNavCounter = useCallback((id) => {
    if (!editorDomRef.current) return;
    const total = editorDomRef.current.querySelectorAll(`mark[data-pd-id="${id}"]`).length;
    if (total === 0) return;
    setPdNavState(prev => {
      // If already navigated — keep cur, just ensure total is up to date
      const existing = prev[id];
      if (existing && existing.total === total) return prev;
      return { ...prev, [id]: { cur: existing?.cur ?? -1, total } };
    });
  }, []);

  // Navigate to prev/next mark in editor for a given PD id
  const navigateToPd = useCallback((id, direction, e) => {
    e.stopPropagation(); // don't trigger handlePdClick on the parent item
    if (!editorDomRef.current) return;
    const marks = Array.from(editorDomRef.current.querySelectorAll(`mark[data-pd-id="${id}"]`));
    if (marks.length === 0) return;

    const cur = pdNavIndexRef.current[id] ?? -1;
    let next;
    if (direction === 'down') {
      next = cur >= marks.length - 1 ? 0 : cur + 1;
    } else {
      next = cur <= 0 ? marks.length - 1 : cur - 1;
    }
    pdNavIndexRef.current[id] = next;

    // Update reactive counter
    setPdNavState(prev => ({ ...prev, [id]: { cur: next, total: marks.length } }));

    // Reset to idle display (show just total) after 10s of inactivity
    // pdNavIndexRef keeps the real position for resuming navigation
    if (pdNavTimerRef.current[id]) clearTimeout(pdNavTimerRef.current[id]);
    pdNavTimerRef.current[id] = setTimeout(() => {
      setPdNavState(prev => {
        const entry = prev[id];
        if (!entry || entry.cur === -1) return prev;
        return { ...prev, [id]: { ...entry, cur: -1 } };
      });
    }, 10000);

    const target = marks[next];

    // Save pd-panel scroll position — scrollIntoView may shift sticky panel
    const pdPanel = pdPanelRef.current;
    const pdScrollBefore = pdPanel ? pdPanel.scrollTop : 0;

    const restorePdScroll = () => {
      if (pdPanel) pdPanel.scrollTop = pdScrollBefore;
    };

    // Check if target is already visible — if so, flash immediately
    const rect = target.getBoundingClientRect();
    const alreadyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;

    if (alreadyVisible) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      restorePdScroll();
      target.classList.add('pd-flash');
      setTimeout(() => target.classList.remove('pd-flash'), 700);
    } else {
      // Flash only after element enters viewport (scroll finished)
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      restorePdScroll();
      // Also restore after scroll animation completes
      setTimeout(restorePdScroll, 400);
      const observer = new IntersectionObserver((entries, obs) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          obs.disconnect();
          restorePdScroll();
          target.classList.add('pd-flash');
          setTimeout(() => target.classList.remove('pd-flash'), 700);
        }
      }, { threshold: 0.5 });
      observer.observe(target);
      setTimeout(() => observer.disconnect(), 2000);
    }
  }, []);

  // Keep sticky offsets in sync with the actual visible bottom edge
  // of the app header and the document title row while scrolling.
  useEffect(() => {
    const update = () => {
      const headerEl = headerRef.current;
      const titleEl = titleRowRef.current;
      const headerHeight = headerEl?.offsetHeight || parseCssSize(
        window.getComputedStyle(document.documentElement).getPropertyValue('--header-h'),
        60,
      );
      const headerBottom = headerEl?.getBoundingClientRect().bottom ?? headerHeight;
      if (headerEl) {
        document.documentElement.style.setProperty('--header-h', `${headerHeight}px`);
        document.documentElement.style.setProperty('--header-offset', `${Math.round(headerBottom)}px`);
      }
      if (titleEl) {
        const height = titleEl.offsetHeight;
        const titleBottom = Math.max(headerBottom, titleEl.getBoundingClientRect().bottom - 1);
        document.documentElement.style.setProperty('--titlerow-h', `${height}px`);
        document.documentElement.style.setProperty('--toolbar-top', `${Math.round(titleBottom)}px`);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (headerRef.current) ro.observe(headerRef.current);
    if (titleRowRef.current) ro.observe(titleRowRef.current);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    if (currentProjectId && !projects.some((item) => item.id === currentProjectId)) {
      setCurrentProjectId(null);
    }
  }, [currentProjectId, projects]);

  // Reset panel widths when window resizes significantly
  useEffect(() => {
    const onResize = () => {
      setPdWidth(w => {
        const def = getDefaultPdWidth();
        // Only auto-reset if user hasn't manually dragged (i.e. value is close to a default)
        return Math.abs(w - def) > 120 ? w : def;
      });
      setViewerWidth(w => {
        const def = getDefaultViewerWidth();
        return Math.abs(w - def) > 180 ? w : def;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []); // eslint-disable-line
  // Sync lastSavedState with actual DOM after editor renders
  // Browser normalizes innerHTML (attribute order, whitespace) so the saved string
  // from buildAnnotatedHtml may differ from what the DOM produces.
  useEffect(() => {
    if (view !== VIEW_RESULT) return;
    const timer = setTimeout(() => {
      if (editorDomRef.current && lastSavedState) {
        const realHtml = editorDomRef.current.innerHTML;
        const nextSavedState = JSON.stringify({
          anonymized: JSON.stringify(anonymized),
          html: realHtml,
        });
        if (nextSavedState !== lastSavedState) {
          setLastSavedState(nextSavedState);
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [anonymized, lastSavedState, view]); // sync saved snapshot with real DOM markup

  // ── Project functions ───────────────────────────────────────────────────────
  const handleCreateProject = async () => {
    if (!newProjectTitle.trim()) return;
    await createProjectRecord(user, newProjectTitle.trim());
    setNewProjectTitle('');
    setShowCreateProject(false);
    await refreshProjects();
  };

  const openProject = (projId) => {
    void cleanupDuplicateProjectChunkDocs(projId);
    setCurrentProjectId(projId);
    setView(VIEW_PROJECT);
    setFiles([]);
    setDocxFiles([]);
    setPastedText('');
    setInputTab('documents');
    setError(null);
  };

  const currentProject = currentProjectId
    ? (projects.find((item) => item.id === currentProjectId) || null)
    : null;
  const currentBatchSession = currentProject?.batchSession || null;

  const getProjectBatchDisplayState = useCallback((project) => {
    if (!project?.batchSession || project.batchSession.status === 'completed') return null;
    if (activeBatchUiState?.projectId === project.id) {
      return activeBatchUiState;
    }
    if (persistedBatchUiState?.projectId === project.id) {
      return {
        ...project.batchSession,
        ...persistedBatchUiState,
        status: persistedBatchUiState.status || project.batchSession.status,
        error: persistedBatchUiState.error || project.batchSession.error || '',
      };
    }
    return {
      projectId: project.id,
      sourceKind: project.batchSession.sourceKind || 'pdf',
      fileName: project.batchSession.fileName || '',
      totalPages: project.batchSession.totalPages || 0,
      nextPage: project.batchSession.nextPage || 1,
      currentPageFrom: project.batchSession.currentPageFrom || null,
      currentPageTo: project.batchSession.currentPageTo || null,
      progressPercent: project.batchSession.progressPercent ?? null,
      message: project.batchSession.progressMessage || '',
      status: project.batchSession.status || 'paused',
      error: project.batchSession.error || '',
    };
  }, [activeBatchUiState, persistedBatchUiState]);

  const currentBatchDisplayState = currentProject ? getProjectBatchDisplayState(currentProject) : null;

  useEffect(() => {
    if (!persistedBatchUiState?.projectId) return;
    const matchingProject = projects.find((project) => project.id === persistedBatchUiState.projectId) || null;
    if (!matchingProject?.batchSession || matchingProject.batchSession.status === 'completed') {
      saveBatchProgressSnapshot(null);
      setPersistedBatchUiState(null);
      if (activeBatchUiState?.projectId === persistedBatchUiState.projectId) {
        setActiveBatchUiState(null);
      }
    }
  }, [activeBatchUiState, persistedBatchUiState, projects]);

  const getProjectChunkDocKey = useCallback((doc) => {
    if (!doc || doc.isProjectSummary) return '';
    if (!doc.batchFileName || !doc.pageFrom || !doc.pageTo) return '';
    return `${doc.projectId || ''}::${doc.batchFileName}::${doc.pageFrom}::${doc.pageTo}`;
  }, []);

  const requestPauseActiveBatch = useCallback((targetView = null) => {
    if (!activeBatchControlRef.current.projectId) return false;
    activeBatchControlRef.current.pauseRequested = true;
    if (targetView) {
      activeBatchControlRef.current.targetView = targetView;
    }
    setActiveBatchUiState((prev) => (
      prev
        ? {
            ...prev,
            status: 'pausing',
            message: 'Пауза будет поставлена после текущей страницы.',
          }
        : prev
    ));
    return true;
  }, []);

  const consumePauseBatchTargetView = useCallback(() => {
    const targetView = activeBatchControlRef.current.targetView || null;
    activeBatchControlRef.current.pauseRequested = false;
    activeBatchControlRef.current.targetView = null;
    return targetView;
  }, []);

  const clearActiveBatchTracking = useCallback(() => {
    activeBatchControlRef.current = {
      projectId: null,
      pauseRequested: false,
      targetView: null,
    };
    setActiveBatchUiState(null);
    saveBatchProgressSnapshot(null);
    setPersistedBatchUiState(null);
  }, []);

  const getProjectDocs = useCallback(() => {
    if (!currentProject) return [];
    return currentProject.documentIds
      .map(id => history.find(h => h.id === id))
      .filter((entry) => entry && !entry.isProjectSummary);
  }, [currentProject, history]);

  const shouldShowLongDocWarningForEntry = useCallback((entry) => {
    if (!entry) return false;
    if (entry.isProjectSummary || entry.source === 'project-summary' || entry.source === 'project-batch') return false;
    return (entry.text || '').replace(/\[PAGE:\d+\]/g, '').length > PD_ANALYSIS_CHAR_LIMIT;
  }, []);

  const cleanupDuplicateProjectChunkDocs = useCallback(async (projectId) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return 0;
    const docs = project.documentIds
      .map(id => history.find(h => h.id === id))
      .filter(Boolean);

    const seen = new Map();
    const duplicates = [];
    for (const doc of docs) {
      const key = getProjectChunkDocKey(doc);
      if (!key) continue;
      if (seen.has(key)) duplicates.push(doc.id);
      else seen.set(key, doc.id);
    }

    if (duplicates.length === 0) return 0;

    for (const id of duplicates) {
      await removeDocumentFromProjectRecord(user, projectId, id);
      await deleteDocumentRecord(user, id);
    }
    await refreshHistory();
    await refreshProjects();
    return duplicates.length;
  }, [getProjectChunkDocKey, history, projects, refreshHistory, refreshProjects, user]);

  const getProjectExistingPD = useCallback(() => {
    if (currentProject?.sharedPD && ((currentProject.sharedPD.persons || []).length > 0 || (currentProject.sharedPD.otherPD || []).length > 0)) {
      return currentProject.sharedPD;
    }
    const projectDocs = getProjectDocs();
    if (projectDocs.length === 0) return null;
    const lastDoc = projectDocs[projectDocs.length - 1];
    return lastDoc.personalData || null;
  }, [currentProject, getProjectDocs]);

  const saveProjectBatchSessionState = useCallback(async (session) => {
    if (!currentProjectId) return null;
    const saved = await updateProjectBatchSessionRecord(user, currentProjectId, session);
    try {
      await refreshProjects();
    } catch (error) {
      console.warn('Failed to refresh projects after saving batch session', {
        projectId: currentProjectId,
        errorMessage: error?.message || String(error),
      });
    }
    return saved;
  }, [currentProjectId, refreshProjects, user]);

  const handleDeleteProject = async (projId, e) => {
    if (e) e.stopPropagation();
    await deleteProjectRecord(user, projId);
    await refreshProjects();
    if (currentProjectId === projId) {
      setCurrentProjectId(null);
      setView(VIEW_HOME);
    }
  };

  const handleRemoveDocFromProject = async (docId) => {
    if (!currentProjectId) return;
    await removeDocumentFromProjectRecord(user, currentProjectId, docId);
    await refreshProjects();
  };

  const handleResetProjectBatchSession = async () => {
    if (!currentProjectId) return;
    await updateProjectBatchSessionRecord(user, currentProjectId, null);
    await refreshProjects();
    if (persistedBatchUiState?.projectId === currentProjectId) {
      saveBatchProgressSnapshot(null);
      setPersistedBatchUiState(null);
    }
    if (activeBatchUiState?.projectId === currentProjectId) {
      setActiveBatchUiState(null);
    }
    activeBatchControlRef.current = {
      projectId: null,
      pauseRequested: false,
      targetView: null,
    };
    setError(null);
  };

  const openDocFromProject = (entry) => {
    loadDoc(entry);
  };

  const mergeDocIntoProject = async (docEntry) => {
    return mergeProjectDocument({
      user,
      currentProjectId,
      docEntry,
      projectDocs: getProjectDocs(),
      mergePD,
      assignLetters,
      getOtherPdMentions,
      refreshHistory,
      refreshProjects,
    });
  };

  const handleProjectImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const entry = await importDocument(file);
      const mergedEntry = await mergeDocIntoProject({
        ...entry,
        projectId: currentProjectId,
      });
      openRecognizedDocResult(mergedEntry, []);
      setView(VIEW_RESULT);
    } catch (err) {
      setError(err.message || 'Ошибка импорта');
    }
  };

  // ── Project summary document ────────────────────────────────────────────────
  const getProjectSummaryDoc = useCallback(() => {
    if (!currentProject) return null;
    return getProjectSummaryDocEntry(history, currentProjectId);
  }, [currentProject, currentProjectId, history]);

  const buildProjectSummary = async () => {
    return saveProjectSummaryDocument({
      user,
      currentProject,
      currentProjectId,
      docs: getProjectDocs(),
      history,
      refreshHistory,
      refreshProjects,
    });
  };

  const handleBuildSummary = () => {
    const existing = getProjectSummaryDoc();
    if (existing) {
      setShowRebuildConfirm(true);
    } else {
      void buildProjectSummary();
    }
  };

  const handleConfirmRebuild = () => {
    setShowRebuildConfirm(false);
    void buildProjectSummary();
  };

  const handleDeleteSummary = async (e) => {
    if (e) e.stopPropagation();
    const summary = getProjectSummaryDoc();
    if (summary) {
      await deleteDocumentRecord(user, summary.id);
      await refreshHistory();
    }
  };

  const ensureUploadedSourceFile = useCallback(async (file, projectId = null) => {
    if (!user || !file) return null;
    const key = buildSourceFileKey(file);
    if (uploadedFilesRef.current.has(key)) {
      return uploadedFilesRef.current.get(key);
    }
    try {
      const uploaded = await uploadSourceFile(user, file, { projectId });
      uploadedFilesRef.current.set(key, uploaded);
      return uploaded;
    } catch (error) {
      console.error('Source file upload failed, continuing without cloud source copy', {
        fileName: file.name,
        fileSize: file.size,
        projectId,
        errorMessage: error?.message || String(error),
      });
      uploadedFilesRef.current.set(key, null);
      setWarningMessage(`Не удалось загрузить исходный файл "${file.name}" в облако. Обработка продолжена без облачной копии исходника.`);
      return null;
    }
  }, [user]);

  const openRecognizedDocResult = useCallback((entry, images = []) => {
    const nextState = buildLoadedDocumentState({
      entry,
      images,
      currentProjectId,
      buildAnnotatedHtml,
      extractPdIdsFromHtml,
      shouldShowLongDocWarningForEntry,
    });

    setDocId(nextState.docId);
    setDocTitle(nextState.docTitle);
    setOriginalFileName(nextState.originalFileName);
    setSourceFiles(nextState.sourceFiles);
    setPageMetadata(nextState.pageMetadata);
    setRawText(nextState.rawText);
    setEditorHtml(nextState.editorHtml);
    setOriginalImages(nextState.originalImages);
    setShowOriginal(nextState.showOriginal);
    setOriginalPage(nextState.originalPage);
    setEditorCurrentPage(null);
    setEditorTotalPages(null);
    setEditorPageInput('');
    setPdIdsInDoc(nextState.pdIdsInDoc);
    pdRef.current = nextState.personalData;
    anonRef.current = nextState.anonymized;
    setPersonalData(nextState.personalData);
    setAnonymized(nextState.anonymized);
    setLastSavedState(nextState.lastSavedState);
    undoStackRef.current = [nextState.initialUndoSnapshot];
    undoIndexRef.current = 0;
    setShowLongDocWarning(nextState.showLongDocWarning);
  }, [currentProjectId, shouldShowLongDocWarningForEntry]);

  // ── Dirty check ──────────────────────────────────────────────────────────────
  const isDirty = () => {
    const currentHtml = editorDomRef.current?.innerHTML || '';
    if (!lastSavedState) return !!currentHtml;
    const saved = JSON.parse(lastSavedState);
    if (JSON.stringify(anonymized) !== saved.anonymized) return true;
    if (currentHtml !== saved.html) return true;
    return false;
  };

  // ── Navigation ────────────────────────────────────────────────────────────────
  const goHome = () => {
    if (view === VIEW_PROCESSING && requestPauseActiveBatch(VIEW_HOME)) {
      doGoHome();
      return;
    }
    if (view === VIEW_RESULT && isDirty()) {
      setShowUnsaved(true);
      pendingNavRef.current = 'home';
    } else {
      doGoHome();
    }
  };

  const goBackToProject = () => {
    if (view === VIEW_PROCESSING && requestPauseActiveBatch(VIEW_PROJECT)) {
      doGoBackToProject();
      return;
    }
    if (view === VIEW_RESULT && isDirty()) {
      setShowUnsaved(true);
      pendingNavRef.current = 'project';
    } else {
      doGoBackToProject();
    }
  };

  const resetWorkingDocumentState = useCallback(() => {
    const cleared = getClearedWorkspaceState();
    setFiles(cleared.files);
    setDocxFiles([]);
    setPastedText(cleared.pastedText);
    setInputTab('documents');
    setOriginalImages(cleared.originalImages);
    setShowOriginal(cleared.showOriginal);
    setOriginalPage(cleared.originalPage);
    setZoomActive(cleared.zoomActive);
    setZoomScale(cleared.zoomScale);
    setZoomOffset(cleared.zoomOffset);
    setOriginalFileName(cleared.originalFileName);
    setSourceFiles(cleared.sourceFiles);
    setPageMetadata(cleared.pageMetadata);
    setError(cleared.error);
    setWarningMessage(null);
    setProgress(cleared.progress);
    setShowUnsaved(cleared.showUnsaved);
  }, []);

  const doGoBackToProject = () => {
    setView(VIEW_PROJECT);
    resetWorkingDocumentState();
    void refreshHistory();
    void refreshProjects();
  };

  const doGoHome = () => {
    setView(VIEW_HOME);
    resetWorkingDocumentState();
    setCurrentProjectId(null);
    void refreshHistory();
    void refreshProjects();
  };

  const handleUnsavedSave = async () => {
    await handleSave();
    setShowUnsaved(false);
    if (pendingNavRef.current === 'home') doGoHome();
    else if (pendingNavRef.current === 'project') doGoBackToProject();
    pendingNavRef.current = null;
  };

  const handleUnsavedDiscard = () => {
    setShowUnsaved(false);
    if (pendingNavRef.current === 'home') doGoHome();
    else if (pendingNavRef.current === 'project') doGoBackToProject();
    pendingNavRef.current = null;
  };

  // ── Project inputs ────────────────────────────────────────────────────────────
  const handleProjectDocumentFiles = useCallback((newFiles) => {
    const valid = Array.from(newFiles).filter((file) => file.type === 'application/pdf' || file.type.startsWith('image/'));
    if (valid.length !== newFiles.length) {
      setError('Во вкладке "Документы" поддерживаются только PDF, JPG, PNG и WEBP');
    }
    setFiles((prev) => [...prev, ...valid]);
  }, []);

  const handleProjectDocxFiles = useCallback((newFiles) => {
    const valid = Array.from(newFiles).filter((file) => file.name.toLowerCase().endsWith('.docx'));
    if (valid.length !== newFiles.length) {
      setError('Во вкладке "DOCX" поддерживаются только файлы DOCX');
    }
    setDocxFiles((prev) => [...prev, ...valid]);
  }, []);

  const handleProjectDocumentDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    handleProjectDocumentFiles(e.dataTransfer.files);
  }, [handleProjectDocumentFiles]);

  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));
  const removeDocxFile = (idx) => setDocxFiles((prev) => prev.filter((_, i) => i !== idx));

  const saveRecognizedProjectDocument = useCallback(async ({
    result,
    title,
    originalFileName: nextOriginalFileName = '',
    source,
    uploadedSourceFiles = [],
  }) => {
    if (!currentProjectId) throw new Error('Сначала откройте проект');
    const existingPD = getProjectExistingPD();
    const pd = existingPD
      ? assignLetters(mergePD(existingPD, result.personalData || { persons: [], otherPD: [] }), existingPD)
      : assignLetters(result.personalData || { persons: [], otherPD: [] });
    const initialAnon = {};
    const html = buildAnnotatedHtml(result.text, pd, initialAnon);
    const savedDoc = await saveDocumentRecord(user, {
      id: generateId(),
      title,
      originalFileName: nextOriginalFileName,
      text: result.text,
      editedHtml: html,
      personalData: pd,
      anonymized: initialAnon,
      source,
      projectId: currentProjectId,
      sourceFiles: uploadedSourceFiles,
    });
    await addDocumentToProjectRecord(user, currentProjectId, savedDoc.id);
    await updateProjectSharedPDRecord(user, currentProjectId, pd);
    await refreshHistory();
    await refreshProjects();
    return savedDoc;
  }, [currentProjectId, getProjectExistingPD, refreshHistory, refreshProjects, user]);

  const handleProjectTextRecognize = useCallback(async () => {
    if (!apiKey.trim()) {
      setError('Введите API ключ');
      return;
    }
    if (!pastedText.trim()) {
      setError('Вставьте текст для обезличивания');
      return;
    }

    setError(null);
    setWarningMessage(null);
    setView(VIEW_PROCESSING);

    try {
      setOriginalImages([]);
      setNonDecreasingProgress({ percent: 10, message: 'Подготовка текста...' });
      animateTo(85, null);
      const result = await analyzePastedText(pastedText.trim(), apiKey.trim(), provider, (p) => {
        const pct = p.percent != null ? Math.round(p.percent) : (p.stage === 'done' ? 100 : 50);
        setNonDecreasingProgress({ percent: pct, message: p.message });
      });
      stopProgressCreep();
      const savedDoc = await saveRecognizedProjectDocument({
        result,
        title: `Текст от ${formatDate(new Date())}`,
        originalFileName: '',
        source: 'paste',
        uploadedSourceFiles: [],
      });
      setPastedText('');
      openRecognizedDocResult(savedDoc, []);
      setTimeout(() => { setView(VIEW_RESULT); setProgress(null); }, 400);
    } catch (err) {
      stopProgressCreep();
      setError(err.message || 'Произошла ошибка');
      setView(VIEW_PROJECT);
      setProgress(null);
    }
  }, [apiKey, animateTo, openRecognizedDocResult, pastedText, provider, saveRecognizedProjectDocument, setNonDecreasingProgress, stopProgressCreep]);

  const handleProjectDocxRecognize = useCallback(async () => {
    if (!apiKey.trim()) {
      setError('Введите API ключ');
      return;
    }
    if (docxFiles.length === 0) {
      setError('Добавьте хотя бы один DOCX-файл');
      return;
    }

    setError(null);
    setWarningMessage(null);
    setView(VIEW_PROCESSING);

    try {
      let lastSavedDoc = null;
      for (let index = 0; index < docxFiles.length; index += 1) {
        const file = docxFiles[index];
        setNonDecreasingProgress({
          percent: Math.round(10 + (index / Math.max(1, docxFiles.length)) * 20),
          message: `Чтение DOCX: ${file.name}...`,
        });
        const docxText = await parseDocx(file);
        setNonDecreasingProgress({
          percent: Math.round(30 + (index / Math.max(1, docxFiles.length)) * 20),
          message: `Анализ персональных данных: ${file.name}...`,
        });
        animateTo(90, null);
        const personalData = await analyzePD(docxText, apiKey.trim(), provider, (p) => {
          const pct = p.percent != null ? Math.round(p.percent) : 97;
          setNonDecreasingProgress({ percent: pct, message: `${file.name}: ${p.message}` });
        });
        const uploadedSourceFile = await ensureUploadedSourceFile(file, currentProjectId);
        lastSavedDoc = await saveRecognizedProjectDocument({
          result: { text: docxText, personalData },
          title: file.name,
          originalFileName: file.name,
          source: 'docx',
          uploadedSourceFiles: uploadedSourceFile ? [uploadedSourceFile] : [],
        });
      }
      stopProgressCreep();
      setDocxFiles([]);
      if (lastSavedDoc) {
        openRecognizedDocResult(lastSavedDoc, []);
        setTimeout(() => { setView(VIEW_RESULT); setProgress(null); }, 400);
      } else {
        setView(VIEW_PROJECT);
        setProgress(null);
      }
    } catch (err) {
      stopProgressCreep();
      setError(err.message || 'Произошла ошибка');
      setView(VIEW_PROJECT);
      setProgress(null);
    }
  }, [apiKey, animateTo, currentProjectId, docxFiles, ensureUploadedSourceFile, openRecognizedDocResult, provider, saveRecognizedProjectDocument, setNonDecreasingProgress, stopProgressCreep]);

  const handleProjectRecognize = async () => {
    if (currentBatchSession && currentBatchSession.status !== 'completed') {
      activeBatchControlRef.current.projectId = currentProjectId;
      activeBatchControlRef.current.pauseRequested = false;
      activeBatchControlRef.current.targetView = null;
      setWarningMessage(null);
      await runProjectBatchRecognition({
        apiKey,
        files,
        currentProjectId,
        projects,
        provider,
        user,
        cleanupDuplicateProjectChunkDocs,
        saveProjectBatchSessionState,
        getProjectExistingPD,
        getProjectDocs,
        ensureUploadedSourceFile,
        mergePD,
        assignLetters,
        refreshHistory,
        refreshProjects,
        openRecognizedDocResult,
        shouldPauseBatch: () => activeBatchControlRef.current.pauseRequested,
        consumePauseBatchTargetView,
        onBatchUiStateChange: (nextState) => {
          if (nextState?.projectId) {
            activeBatchControlRef.current.projectId = nextState.projectId;
          }
          setActiveBatchUiState((prevState) => mergeBatchUiState(prevState, nextState));
        },
        onBatchUiStateClear: clearActiveBatchTracking,
        stopProgressCreep,
        setError,
        setView,
        setFiles,
        setProgress,
        viewProcessing: VIEW_PROCESSING,
        viewProject: VIEW_PROJECT,
        viewResult: VIEW_RESULT,
      });
      return;
    }

    if (inputTab === 'text') {
      await handleProjectTextRecognize();
      return;
    }

    if (inputTab === 'docx') {
      await handleProjectDocxRecognize();
      return;
    }

    activeBatchControlRef.current.projectId = currentProjectId;
    activeBatchControlRef.current.pauseRequested = false;
    activeBatchControlRef.current.targetView = null;
    setWarningMessage(null);
    await runProjectBatchRecognition({
      apiKey,
      files,
      currentProjectId,
      projects,
      provider,
      user,
      cleanupDuplicateProjectChunkDocs,
      saveProjectBatchSessionState,
      getProjectExistingPD,
      getProjectDocs,
      ensureUploadedSourceFile,
      mergePD,
      assignLetters,
      refreshHistory,
      refreshProjects,
      openRecognizedDocResult,
      shouldPauseBatch: () => activeBatchControlRef.current.pauseRequested,
      consumePauseBatchTargetView,
      onBatchUiStateChange: (nextState) => {
        if (nextState?.projectId) {
          activeBatchControlRef.current.projectId = nextState.projectId;
        }
        setActiveBatchUiState((prevState) => mergeBatchUiState(prevState, nextState));
      },
      onBatchUiStateClear: clearActiveBatchTracking,
      stopProgressCreep,
      setError,
      setView,
      setFiles,
      setProgress,
      viewProcessing: VIEW_PROCESSING,
      viewProject: VIEW_PROJECT,
      viewResult: VIEW_RESULT,
    });
  };

  // ── Load project document ─────────────────────────────────────────────────────
  const loadDoc = (entry) => {
    openRecognizedDocResult(entry, []);
    setView(VIEW_RESULT);
  };

  const getEditorPageSeparators = useCallback(() => {
    if (!editorDomRef.current) return [];
    return Array.from(editorDomRef.current.querySelectorAll('.page-separator[data-page]'))
      .map((el) => ({
        el,
        pageNumber: Number(el.dataset.page || 0),
      }))
      .filter((item) => item.pageNumber > 0);
  }, []);

  const getEditorTotalPages = useCallback(() => {
    const separators = getEditorPageSeparators();
    if (separators.length > 0) {
      return separators[separators.length - 1].pageNumber;
    }
    return pageMetadata?.sources?.[0]?.totalPages || pageMetadata?.sources?.[0]?.pageTo || null;
  }, [getEditorPageSeparators, pageMetadata]);

  const getEditorScrollOffset = useCallback(() => {
    const rootStyles = window.getComputedStyle(document.documentElement);
    const headerHeight = parseCssSize(rootStyles.getPropertyValue('--header-h'), 60);
    const stickyGap = parseCssSize(rootStyles.getPropertyValue('--sticky-gap'), 10);
    const titleHeight = titleRowRef.current?.getBoundingClientRect().height
      || parseCssSize(rootStyles.getPropertyValue('--titlerow-h'), 49);
    const toolbarHeight = titleRowRef.current
      ?.closest('.doc-card')
      ?.querySelector('.rich-toolbar')
      ?.getBoundingClientRect()
      ?.height || 44;
    return Math.round(headerHeight + stickyGap + titleHeight + toolbarHeight + 12);
  }, []);

  const getCurrentEditorPageNumber = useCallback(() => {
    const separators = getEditorPageSeparators();
    if (separators.length === 0) return null;

    const threshold = getEditorScrollOffset();
    const viewportBottom = window.innerHeight || document.documentElement.clientHeight || 0;
    const nearDocumentBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    let currentPage = separators[0].pageNumber;
    for (const separator of separators) {
      const rect = separator.el.getBoundingClientRect();
      if (rect.top <= threshold) {
        currentPage = separator.pageNumber;
        continue;
      }
      if (rect.top < viewportBottom && nearDocumentBottom) {
        currentPage = separator.pageNumber;
      } else {
        break;
      }
    }
    return currentPage;
  }, [getEditorPageSeparators, getEditorScrollOffset]);

  const releaseEditorPageNavigationLock = useCallback((fallbackPage = null) => {
    const lockedPage = editorNavigatingPageRef.current ?? fallbackPage;
    editorNavigatingPageRef.current = null;
    if (editorPageNavigationTimerRef.current) {
      clearTimeout(editorPageNavigationTimerRef.current);
      editorPageNavigationTimerRef.current = null;
    }
    if (!lockedPage) return;
    const resolvedPage = getCurrentEditorPageNumber() || lockedPage;
    setEditorCurrentPage(resolvedPage);
    setEditorPageInput(String(resolvedPage));
    syncOriginalViewerToDocumentPage(resolvedPage);
  }, [getCurrentEditorPageNumber, syncOriginalViewerToDocumentPage]);

  const goToEditorPage = useCallback((pageNumber) => {
    const targetPage = Number(pageNumber || 0);
    if (!targetPage || !editorDomRef.current) return false;
    const targetSeparator = editorDomRef.current.querySelector(`.page-separator[data-page="${targetPage}"]`);
    if (!targetSeparator) return false;
    if (editorPageNavigationTimerRef.current) {
      clearTimeout(editorPageNavigationTimerRef.current);
      editorPageNavigationTimerRef.current = null;
    }
    editorNavigatingPageRef.current = targetPage;
    setEditorCurrentPage(targetPage);
    setEditorPageInput(String(targetPage));
    syncOriginalViewerToDocumentPage(targetPage);
    const targetTop = window.scrollY + targetSeparator.getBoundingClientRect().top - getEditorScrollOffset();
    requestAnimationFrame(() => {
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      });
    });
    editorPageNavigationTimerRef.current = window.setTimeout(() => {
      if (editorNavigatingPageRef.current === targetPage) {
        releaseEditorPageNavigationLock(targetPage);
      }
    }, 1800);
    return true;
  }, [getEditorScrollOffset, releaseEditorPageNavigationLock, syncOriginalViewerToDocumentPage]);

  const handleEditorPageSubmit = useCallback(() => {
    const totalPages = getEditorTotalPages();
    const rawPage = Number(editorPageInput || 0);
    if (!rawPage) return;
    const targetPage = totalPages
      ? Math.max(1, Math.min(totalPages, rawPage))
      : rawPage;
    if (!targetPage) return;
    goToEditorPage(targetPage);
  }, [editorPageInput, getEditorTotalPages, goToEditorPage]);

  const handleEditorPageStep = useCallback((direction) => {
    const currentPage = editorNavigatingPageRef.current || editorCurrentPage || getCurrentEditorPageNumber();
    const totalPages = editorTotalPages || getEditorTotalPages();
    if (!currentPage || !totalPages) return;
    const nextPage = Math.max(1, Math.min(totalPages, currentPage + direction));
    goToEditorPage(nextPage);
  }, [editorCurrentPage, editorTotalPages, getCurrentEditorPageNumber, getEditorTotalPages, goToEditorPage]);

  useEffect(() => {
    if (view !== VIEW_RESULT) return;
    let rafId = null;
    const syncActualPage = () => {
      const currentPage = getCurrentEditorPageNumber();
      const totalPages = getEditorTotalPages();
      setEditorCurrentPage(currentPage || (totalPages ? 1 : null));
      setEditorTotalPages(totalPages || null);
      if (currentPage) {
        setEditorPageInput(String(currentPage));
        syncOriginalViewerToDocumentPage(currentPage);
      }
    };
    const syncPageInput = () => {
      const navigatingPage = editorNavigatingPageRef.current;
      const totalPages = getEditorTotalPages();
      setEditorTotalPages(totalPages || null);
      if (navigatingPage != null) {
        setEditorCurrentPage(navigatingPage);
        setEditorPageInput(String(navigatingPage));
        syncOriginalViewerToDocumentPage(navigatingPage);
        if (editorPageNavigationTimerRef.current) {
          clearTimeout(editorPageNavigationTimerRef.current);
        }
        editorPageNavigationTimerRef.current = window.setTimeout(() => {
          releaseEditorPageNavigationLock(navigatingPage);
        }, 180);
        return;
      }
      syncActualPage();
    };
    const handleScroll = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(syncPageInput);
    };
    syncActualPage();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (editorPageNavigationTimerRef.current) {
        clearTimeout(editorPageNavigationTimerRef.current);
        editorPageNavigationTimerRef.current = null;
      }
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [editorHtml, getCurrentEditorPageNumber, getEditorTotalPages, releaseEditorPageNavigationLock, syncOriginalViewerToDocumentPage, view]);

  // ── Save ──────────────────────────────────────────────────────────────────────
  const countUncertain = () => {
    if (!editorDomRef.current) return 0;
    return editorDomRef.current.querySelectorAll('mark.uncertain').length;
  };

  const countPageSeparators = () => {
    if (!editorDomRef.current) return 0;
    return editorDomRef.current.querySelectorAll('.part-separator').length;
  };

  const handleDownloadPdf = useCallback(() => {
    try {
      exportRichTextPdf({
        editorDomRef,
        editorHtml,
        docTitle,
        originalFileName,
      });
    } catch (error) {
      alert(error?.message || 'Разрешите всплывающие окна для скачивания PDF');
    }
  }, [docTitle, editorDomRef, editorHtml, originalFileName]);

  const triggerExport = (action) => {
    const uncertainCount = countUncertain();
    const separatorCount = countPageSeparators();
    if (uncertainCount > 0 || separatorCount > 0) {
      setPendingExportAction(action);
      setShowUncertainWarning(true);
      setHighlightUncertain(true);
      // Подсвечиваем разделители частей анимацией
      if (editorDomRef.current) {
        editorDomRef.current.querySelectorAll('.part-separator').forEach(el => {
          el.classList.add('page-separator-highlight');
        });
      }
    } else {
      if (action === 'save') void handleSave();
      else if (action === 'pdf') handleDownloadPdf();
      else if (action === 'docx') handleDownloadDocx();
    }
  };

  const handleUncertainProceed = () => {
    setShowUncertainWarning(false);
    setHighlightUncertain(false);
    // Убираем подсветку разделителей
    if (editorDomRef.current) {
      editorDomRef.current.querySelectorAll('.part-separator').forEach(el => {
        el.classList.remove('page-separator-highlight');
      });
    }
    if (pendingExportAction === 'save') void handleSave();
    else if (pendingExportAction === 'pdf') handleDownloadPdf();
    else if (pendingExportAction === 'docx') handleDownloadDocx();
    setPendingExportAction(null);
  };

  const handleUncertainCancel = () => {
    setShowUncertainWarning(false);
    // Анимация ⚠️ остаётся включённой, подсветка разделителей тоже
    setPendingExportAction(null);
    // Скролл к первому проблемному месту (uncertain или разделитель)
    if (editorDomRef.current) {
      const first = editorDomRef.current.querySelector('mark.uncertain, .page-separator-highlight');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleSave = async () => {
    if (!currentProjectId) {
      setError('Документ можно сохранить только внутри проекта');
      return;
    }
    const currentHtml = editorDomRef.current?.innerHTML || editorHtml;
    const existingDocEntry = history.find((item) => item.id === docId) || null;
    const docData = {
      id: docId,
      title: docTitle,
      originalFileName,
      sourceFiles,
      pageMetadata,
      text: rawText,
      editedHtml: currentHtml,
      personalData,
      anonymized,
      source: existingDocEntry?.source || 'ocr',
    };
    docData.projectId = currentProjectId;
    await saveDocumentRecord(user, docData);
    await addDocumentToProjectRecord(user, currentProjectId, docId);
    await refreshProjects();
    setLastSavedState(JSON.stringify({
      anonymized: JSON.stringify(anonymized),
      html: currentHtml,
    }));
    await refreshHistory();
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  };

  // ── Anonymize — KEY FIX: patch DOM directly, don't rebuild HTML ───────────────
  // ── Undo helpers ─────────────────────────────────────────────────────────────

  // Push snapshot onto stack, discarding any redo entries above current index
  const pushSnap = (s) => {
    const stack = undoStackRef.current;
    const idx   = undoIndexRef.current;
    const next  = stack.slice(0, idx + 1);
    next.push(s);
    if (next.length > MAX_UNDO) next.shift();
    undoStackRef.current = next;
    undoIndexRef.current = next.length - 1;
  };



  // Restore a snapshot — write DOM directly, update React state
  const replaceTopSnap = (s) => {
    const stack = undoStackRef.current;
    const idx = undoIndexRef.current;
    if (idx >= 0) stack[idx] = s;
  };

  const applySnap = (s) => {
    if (editorDomRef.current) {
      editorDomRef.current.innerHTML = s.html;
      initPdMarkOriginals(editorDomRef.current);
    }
    setEditorHtml(s.html);
    // Update refs first so any cascading effects see correct values
    pdRef.current   = s.pd;
    anonRef.current = s.anon;
    setPersonalData(s.pd);
    setAnonymized(s.anon);
  };

  const performUndo = () => {
    const idx = undoIndexRef.current;
    if (idx <= 0) return;
    undoIndexRef.current = idx - 1;
    applySnap(undoStackRef.current[idx - 1]);
  };

  const performRedo = () => {
    const stack = undoStackRef.current;
    const idx = undoIndexRef.current;
    if (idx >= stack.length - 1) return;
    undoIndexRef.current = idx + 1;
    applySnap(stack[idx + 1]);
  };

  const handlePdClick = useCallback((id) => {
    const nextAnon = { ...anonRef.current, [id]: !anonRef.current[id] };
    anonRef.current = nextAnon;
    const isAnon = nextAnon[id];
    const person = personalData.persons?.find(p => p.id === id);
    const otherItem = personalData.otherPD?.find(it => it.id === id);
    patchPdMarks(editorDomRef.current, id, isAnon, person?.letter, otherItem?.replacement);
    const newHtml = editorDomRef.current?.innerHTML ?? '';
    setEditorHtml(newHtml);
    setAnonymized(() => nextAnon);
    pushSnap({ html: newHtml, pd: pdRef.current, anon: nextAnon }); // push AFTER
  }, [personalData]);

  const anonymizeAllByCategory = useCallback((category) => {
    const { persons = [], otherPD = [] } = personalData;
    const newAnon = { ...anonRef.current };
    let items;
    if (category === 'private' || category === 'professional') {
      items = persons.filter(p => p.category === category);
    } else {
      items = otherPD.filter(p => p.type === category);
    }
    const allAnon = items.every(p => newAnon[p.id]);
    const targetState = !allAnon;
    items.forEach(item => {
      newAnon[item.id] = targetState;
      const person = persons.find(p => p.id === item.id);
      const otherItem = otherPD.find(it => it.id === item.id);
      patchPdMarks(editorDomRef.current, item.id, targetState, person?.letter, otherItem?.replacement);
    });
    anonRef.current = newAnon;
    const newHtml = editorDomRef.current?.innerHTML ?? '';
    setEditorHtml(newHtml);
    setAnonymized(() => newAnon);
    pushSnap({ html: newHtml, pd: pdRef.current, anon: newAnon }); // push AFTER
  }, [personalData]);

  // After editor renders with new html, store originals for de-anonymize
  const handleEditorHtmlChange = useCallback((html) => {
    setEditorHtml(html);

    // Snapshot every text change immediately (debounce removed — text edits are rare)
    pushSnap({ html, pd: pdRef.current, anon: anonRef.current });

    // Deferred cleanup: update pdIdsInDoc tracking
    // PD entries are NOT auto-removed — only removed by explicit user action (right-click → "Не является ПД")
    if (pdCleanupTimerRef.current) clearTimeout(pdCleanupTimerRef.current);
    pdCleanupTimerRef.current = setTimeout(() => {
      if (!editorDomRef.current) return;

      const dom = editorDomRef.current;
      const markCounts = {};
      dom.querySelectorAll("mark[data-pd-id]").forEach(el => {
        const id = el.dataset.pdId;
        markCounts[id] = (markCounts[id] || 0) + 1;
      });

      // Update pdIdsInDoc if in project context
      if (currentProjectId) {
        setPdIdsInDoc(new Set(Object.keys(markCounts)));
      }
    }, 1000);
  }, [currentProjectId]);

  // Called from RichEditor when user right-clicks a mark and picks "Не является ПД"
  const handleRemovePdMark = useCallback((id) => {
    if (pdCleanupTimerRef.current) { clearTimeout(pdCleanupTimerRef.current); pdCleanupTimerRef.current = null; }
    setPersonalData(prev => {
      const remaining = editorDomRef.current
        ? editorDomRef.current.querySelectorAll(`mark[data-pd-id="${id}"]`).length
        : 0;
      if (remaining > 0) return prev;
      const next = {
        ...prev,
        persons: prev.persons.filter(p => p.id !== id),
        otherPD: prev.otherPD.filter(p => p.id !== id),
      };
      pdRef.current = next;
      // notifyChange already pushed snap with restored HTML; update top to reflect new pd
      replaceTopSnap({ html: editorDomRef.current?.innerHTML ?? '', pd: next, anon: anonRef.current });
      return next;
    });
  }, []);

  const handleDeletePdEntry = useCallback((id) => {
    if (!id) return;
    if (pdCleanupTimerRef.current) {
      clearTimeout(pdCleanupTimerRef.current);
      pdCleanupTimerRef.current = null;
    }

    const dom = editorDomRef.current;
    if (dom) {
      dom.querySelectorAll(`mark[data-pd-id="${id}"]`).forEach((mark) => {
        const text = document.createTextNode(mark.dataset.original || mark.textContent || '');
        const parent = mark.parentNode;
        if (!parent) return;
        parent.replaceChild(text, mark);
        parent.normalize?.();
      });
    }

    const nextPd = {
      ...pdRef.current,
      persons: (pdRef.current.persons || []).filter((item) => item.id !== id),
      otherPD: (pdRef.current.otherPD || []).filter((item) => item.id !== id),
    };
    const nextAnon = { ...anonRef.current };
    delete nextAnon[id];

    if (pdNavTimerRef.current[id]) {
      clearTimeout(pdNavTimerRef.current[id]);
      delete pdNavTimerRef.current[id];
    }
    delete pdNavIndexRef.current[id];

    pdRef.current = nextPd;
    anonRef.current = nextAnon;
    setPersonalData(nextPd);
    setAnonymized(nextAnon);
    setPdNavState((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setPdIdsInDoc((prev) => {
      if (!prev || !prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    const newHtml = dom?.innerHTML ?? editorHtml;
    setEditorHtml(newHtml);
    pushSnap({ html: newHtml, pd: nextPd, anon: nextAnon });
  }, [editorHtml]);

  // Called from RichEditor when user attaches selection to existing PD
  const handleAttachPdMark = useCallback((id, markEl, ambiguousMarkEl) => {
    // Fix DOM class synchronously
    const person = personalData.persons.find(p => p.id === id);
    const other = personalData.otherPD.find(p => p.id === id);
    const attachedText = normalizePdText(markEl?.dataset?.original || markEl?.textContent || '');
    if (markEl) {
      const cat = person
        ? (person.category === 'professional' ? 'prof' : 'priv')
        : 'oth';
      if (!markEl.dataset.original) {
        markEl.dataset.original = person?.fullName || other?.value || markEl.textContent;
      }
      markEl.className = `pd ${cat}`;
      markEl.contentEditable = 'false';
      markEl.dataset.pdId = id;
      const isAnon = anonymized[id];
      if (isAnon && person) {
        markEl.textContent = person.letter;
        markEl.classList.add('anon');
      } else if (isAnon && other) {
        markEl.textContent = other.replacement || '[ПД]';
        markEl.classList.add('anon');
      }
    }
    const nextPdBase = {
      ...pdRef.current,
      persons: (pdRef.current.persons || []).map(item => item.id === id
        ? { ...item, mentions: dedupeMentions([...(item.mentions || []), attachedText, item.fullName]) }
        : item),
      otherPD: (pdRef.current.otherPD || []).map(item => item.id === id
        ? { ...item, mentions: dedupeMentions([...(item.mentions || []), attachedText, item.value]) }
        : item),
    };
    const nextPd = removeAmbiguousEntry(nextPdBase, ambiguousMarkEl);
    pdRef.current = nextPd;
    setPersonalData(() => nextPd);
    // DOM is now correct — push snap with correct class
    const newHtml = editorDomRef.current?.innerHTML ?? '';
    setEditorHtml(newHtml);
    replaceTopSnap({ html: newHtml, pd: nextPd, anon: anonRef.current });
  }, [personalData, anonymized, removeAmbiguousEntry]);

  // Called from RichEditor when user adds a brand new PD entry
  const handleAddPdMark = useCallback((pdData, selectedText, markEl, ambiguousMarkEl) => {
    // Compute new pd state and fix DOM synchronously BEFORE reading innerHTML
    const newId = `manual_${Date.now()}`;
    let newPersons = pdRef.current.persons;
    let newOtherPD = pdRef.current.otherPD;

    if (pdData.category === 'private' || pdData.category === 'professional') {
      const privateCount = pdRef.current.persons.filter(p => p.category === 'private').length;
      const profCount = pdRef.current.persons.filter(p => p.category === 'professional').length;
      const letter = pdData.category === 'private'
        ? (ALPHA_PRIVATE[privateCount] !== undefined ? ALPHA_PRIVATE[privateCount] : `Л-${privateCount + 1}`)
        : `[ФИО ${profCount + 1}]`;
      newPersons = [...pdRef.current.persons, {
        id: newId, fullName: pdData.fullName, role: pdData.role || '',
        category: pdData.category, letter,
        mentions: dedupeMentions([pdData.fullName, selectedText]),
      }];
      if (markEl) {
        const cat = pdData.category === 'professional' ? 'prof' : 'priv';
        markEl.className = `pd ${cat}`;
        markEl.contentEditable = 'false';
        markEl.dataset.pdId = newId;
        if (!markEl.dataset.original) markEl.dataset.original = selectedText;
      }
    } else {
      const typeLabel = OTHER_PD_TYPES_MAP[pdData.type] || pdData.type;
      newOtherPD = [...pdRef.current.otherPD, {
        id: newId, type: pdData.type, value: selectedText, replacement: `[${typeLabel}]`,
        mentions: dedupeMentions([selectedText]),
      }];
      if (markEl) {
        markEl.className = 'pd oth';
        markEl.contentEditable = 'false';
        markEl.dataset.pdId = newId;
        markEl.dataset.original = selectedText;
      }
    }

    const nextPd = removeAmbiguousEntry({ persons: newPersons, otherPD: newOtherPD, ambiguousPersons: pdRef.current.ambiguousPersons || [] }, ambiguousMarkEl);
    pdRef.current = nextPd;
    setPersonalData(() => nextPd);

    // DOM has correct class and real id — push snap
    const newHtml = editorDomRef.current?.innerHTML ?? '';
    setEditorHtml(newHtml);
    replaceTopSnap({ html: newHtml, pd: nextPd, anon: anonRef.current });
  }, [removeAmbiguousEntry]);

  const handleRemoveAmbiguousMark = useCallback((markEl) => {
    if (pdCleanupTimerRef.current) { clearTimeout(pdCleanupTimerRef.current); pdCleanupTimerRef.current = null; }
    setPersonalData(prev => {
      const next = removeAmbiguousEntry(prev, markEl);
      pdRef.current = next;
      replaceTopSnap({ html: editorDomRef.current?.innerHTML ?? '', pd: next, anon: anonRef.current });
      return next;
    });
  }, [removeAmbiguousEntry]);

  const annotatePdMentionsInEditor = useCallback((pdState, targetId) => {
    const dom = editorDomRef.current;
    if (!dom) return false;

    const targetPerson = (pdState.persons || []).find(item => item.id === targetId);
    const targetOther = (pdState.otherPD || []).find(item => item.id === targetId);
    const target = targetPerson || targetOther;
    if (!target) return false;

    const mentions = targetPerson ? getPersonMentions(target) : getOtherPdMentions(target);
    if (mentions.length === 0) return false;

    let changed = false;

    function annotateNode(node) {
      if (node.nodeType === 3) {
        const text = node.textContent;
        const allMatches = [];
        for (const mention of mentions) {
          if (!mention || mention.length < 2) continue;
          try {
            const pattern = buildPdMatchPattern(
              mention,
              targetPerson ? 'person' : 'other',
              targetOther?.type
            );
            const re = new RegExp(pattern, 'gi');
            let m;
            while ((m = re.exec(text)) !== null) {
              allMatches.push({ start: m.index, end: m.index + m[0].length, mt: m[0] });
            }
          } catch {}
        }

        if (allMatches.length === 0) return;
        allMatches.sort((a, b) => a.start - b.start || b.end - a.end);

        const filtered = [];
        let lastEnd = 0;
        for (const match of allMatches) {
          if (match.start >= lastEnd) {
            filtered.push(match);
            lastEnd = match.end;
          }
        }
        if (filtered.length === 0) return;

        const fragment = document.createDocumentFragment();
        let lastIdx = 0;
        for (const { start, end, mt } of filtered) {
          if (start > lastIdx) fragment.appendChild(document.createTextNode(text.slice(lastIdx, start)));
          const el = document.createElement('mark');
          const isAnon = !!anonRef.current[targetId];
          const isPerson = !!targetPerson;
          el.className = `pd ${isPerson ? (targetPerson.category === 'professional' ? 'prof' : 'priv') : 'oth'}${isAnon ? ' anon' : ''}`;
          el.dataset.pdId = targetId;
          el.dataset.original = mt;
          el.contentEditable = 'false';
          el.title = isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить';
          el.textContent = isAnon
            ? (isPerson ? targetPerson.letter : targetOther.replacement || '[ПД]')
            : mt;
          fragment.appendChild(el);
          lastIdx = end;
          changed = true;
        }
        if (lastIdx < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
        node.parentNode.replaceChild(fragment, node);
      } else if (node.nodeType === 1 && !['mark', 'script', 'style'].includes(node.tagName.toLowerCase())) {
        Array.from(node.childNodes).forEach(annotateNode);
      }
    }

    Array.from(dom.childNodes).forEach(annotateNode);
    return changed;
  }, []);

  const openPdEditor = useCallback((id) => {
    if (!id) return;
    const exists = pdRef.current.persons.some(p => p.id === id) || pdRef.current.otherPD.some(p => p.id === id);
    if (exists) setEditingPdId(id);
  }, []);

  const openPdFragmentEditor = useCallback((id, markEl) => {
    if (!id || !markEl) return;
    const fragmentText = normalizePdText(markEl.dataset.original || markEl.textContent || '');
    setEditingPdFragment({
      id,
      text: fragmentText,
      markEl,
    });
  }, []);

  const handleSavePdEdit = useCallback((payload) => {
    if (!payload?.id) return;

    const nextPd = {
      ...pdRef.current,
      persons: (pdRef.current.persons || []).map(person => {
        if (person.id !== payload.id) return person;
        const fullName = normalizePdText(payload.fullName || person.fullName);
        return {
          ...person,
          fullName,
          role: payload.role ?? person.role ?? '',
          mentions: dedupeMentions([
            ...(person.mentions || []),
            ...buildCanonicalPersonMentions(fullName),
          ]),
        };
      }),
      otherPD: (pdRef.current.otherPD || []).map(item => {
        if (item.id !== payload.id) return item;
        const value = normalizePdText(payload.value || item.value);
        return {
          ...item,
          value,
          mentions: dedupeMentions([...(item.mentions || []), value]),
        };
      }),
    };

    pdRef.current = nextPd;
    setPersonalData(nextPd);
    setEditingPdId(null);

    const updatedItem = nextPd.otherPD.find(item => item.id === payload.id);
    if (updatedItem && anonRef.current[payload.id]) {
      patchPdMarks(editorDomRef.current, payload.id, true, null, updatedItem.replacement);
    }
    annotatePdMentionsInEditor(nextPd, payload.id);

    const finalHtml = editorDomRef.current?.innerHTML ?? editorHtml;
    setEditorHtml(finalHtml);
    pushSnap({ html: finalHtml, pd: nextPd, anon: anonRef.current });
  }, [annotatePdMentionsInEditor, editorHtml]);

  const handleSavePdFragmentEdit = useCallback((payload) => {
    if (!payload?.id) return;
    const dom = editorDomRef.current;
    if (!dom) return;

    const nextText = normalizePdText(payload.text);
    if (!nextText) return;

    const directMark = editingPdFragment?.markEl;
    const marks = Array.from(dom.querySelectorAll(`mark[data-pd-id="${payload.id}"]`));
    const targetMark = (directMark && directMark.isConnected ? directMark : null)
      || marks.find(mark => normalizePdText(mark.dataset.original || mark.textContent) === normalizePdText(editingPdFragment?.text))
      || marks[0];
    if (!targetMark) return;

    targetMark.dataset.original = nextText;
    if (!targetMark.classList.contains('anon')) {
      targetMark.textContent = nextText;
    }

    const nextPd = {
      ...pdRef.current,
      persons: (pdRef.current.persons || []).map(item => item.id === payload.id
        ? { ...item, mentions: dedupeMentions([...(item.mentions || []), nextText, item.fullName]) }
        : item),
      otherPD: (pdRef.current.otherPD || []).map(item => item.id === payload.id
        ? { ...item, mentions: dedupeMentions([...(item.mentions || []), nextText, item.value]) }
        : item),
    };

    pdRef.current = nextPd;
    setPersonalData(nextPd);
    setEditingPdFragment(null);

    const html = dom.innerHTML;
    setEditorHtml(html);
    pushSnap({ html, pd: nextPd, anon: anonRef.current });
  }, [editingPdFragment]);

  const handleApplyPdCanonicalText = useCallback((id, markEl) => {
    if (!id || !markEl) return;

    const person = (pdRef.current.persons || []).find(item => item.id === id) || null;
    const other = (pdRef.current.otherPD || []).find(item => item.id === id) || null;
    const canonicalText = normalizePdText(person?.fullName || other?.value || '');
    if (!canonicalText) return;

    markEl.dataset.original = canonicalText;
    if (!markEl.classList.contains('anon')) {
      markEl.textContent = canonicalText;
    }

    const nextPd = {
      ...pdRef.current,
      persons: (pdRef.current.persons || []).map(item => item.id === id
        ? { ...item, mentions: dedupeMentions([...(item.mentions || []), canonicalText, item.fullName]) }
        : item),
      otherPD: (pdRef.current.otherPD || []).map(item => item.id === id
        ? { ...item, mentions: dedupeMentions([...(item.mentions || []), canonicalText, item.value]) }
        : item),
    };

    pdRef.current = nextPd;
    setPersonalData(nextPd);

    const html = editorDomRef.current?.innerHTML ?? editorHtml;
    setEditorHtml(html);
    pushSnap({ html, pd: nextPd, anon: anonRef.current });
  }, [editorHtml]);

  // ── Re-annotate otherPD after uncertain mark is resolved ──────────────────
  const handleUncertainResolved = useCallback(() => {
    if (!editorDomRef.current) return;
    const dom = editorDomRef.current;
    const otherItems = pdRef.current.otherPD || [];
    if (otherItems.length === 0) return;

    // Collect ids already marked
    const markedIds = new Set();
    dom.querySelectorAll('mark[data-pd-id]').forEach(el => markedIds.add(el.dataset.pdId));
    const unmarked = otherItems.filter(it => !markedIds.has(it.id));
    if (unmarked.length === 0) return;

    // Import buildOtherPdPattern inline (same logic)
    const escReLocal = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const buildPattern = (value) => {
      const parts = value.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return escReLocal(value);
      return parts.map(p => escReLocal(p)).join('[\\s\\n]+');
    };

    let changed = false;
    function tryAnnotate(node) {
      if (node.nodeType === 3) {
        const text = node.textContent;
        const allMatches = [];
        for (const item of unmarked) {
          const values = getOtherPdMentions(item);
          for (const value of values) {
            try {
              const re = new RegExp(buildPattern(value), 'gi');
              let m;
              while ((m = re.exec(text)) !== null) {
                allMatches.push({ start: m.index, end: m.index + m[0].length, mt: m[0], item });
              }
            } catch {}
          }
        }
        if (allMatches.length === 0) return;
        allMatches.sort((a, b) => a.start - b.start);
        const filtered = [];
        let lastEnd = 0;
        for (const m of allMatches) {
          if (m.start >= lastEnd) { filtered.push(m); lastEnd = m.end; }
        }
        const fragment = document.createDocumentFragment();
        let lastIdx = 0;
        for (const { start, end, mt, item } of filtered) {
          if (start > lastIdx) fragment.appendChild(document.createTextNode(text.slice(lastIdx, start)));
          const el = document.createElement('mark');
          const isAnon = !!anonRef.current[item.id];
          el.className = 'pd oth' + (isAnon ? ' anon' : '');
          el.dataset.pdId = item.id;
          el.dataset.original = mt;
          el.contentEditable = 'false';
          el.title = isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить';
          el.textContent = isAnon ? item.replacement : mt;
          fragment.appendChild(el);
          lastIdx = end;
          changed = true;
        }
        if (lastIdx < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
        node.parentNode.replaceChild(fragment, node);
      } else if (node.nodeType === 1 && !['mark', 'script', 'style'].includes(node.tagName.toLowerCase())) {
        Array.from(node.childNodes).forEach(tryAnnotate);
      }
    }
    Array.from(dom.childNodes).forEach(tryAnnotate);

    if (changed) {
      const newHtml = dom.innerHTML;
      setEditorHtml(newHtml);
      pushSnap({ html: newHtml, pd: pdRef.current, anon: anonRef.current });
    }
  }, []);

  // ── Export ────────────────────────────────────────────────────────────────────

  // Generate .docx by building the XML directly (no external library needed)
  const handleDownloadDocx = async () => {
    const html = editorDomRef.current?.innerHTML || editorHtml;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    // Convert HTML nodes to OOXML paragraphs
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const getAlign = (el) => {
      const t = el.style?.textAlign || '';
      const tag = el.tagName?.toUpperCase() || '';
      // Center: explicit style, heading tags, or strong-only short line (ПОСТАНОВЛЕНИЕ etc)
      if (t === 'center' || tag === 'H1' || tag === 'H2' || tag === 'H3') return 'center';
      if (t === 'right') return 'right';
      return 'both'; // justified by default
    };

    const nodeToRuns = (el) => {
      let runs = '';
      const walk = (node, bold = false, italic = false, underline = false) => {
        if (node.nodeType === 3) {
          // Collapse multiple spaces into one (removes OCR trailing space artifacts)
          const text = node.textContent.replace(/  +/g, ' ');
          if (!text || !text.trim()) return;
          // Always include Times New Roman 14pt (28 half-points) as base font
          const fontProps = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="28"/><w:szCs w:val="28"/>';
          const rPr = [
            fontProps,
            bold ? '<w:b/><w:bCs/>' : '',
            italic ? '<w:i/><w:iCs/>' : '',
            underline ? '<w:u w:val="single"/>' : '',
          ].join('');
          runs += `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
        } else if (node.nodeType === 1) {
          const tag = node.tagName?.toUpperCase() || '';
          const b = bold || tag === 'STRONG' || tag === 'B';
          const i = italic || tag === 'EM' || tag === 'I';
          const u = underline || tag === 'U';
          if (tag === 'BR') { runs += '<w:r><w:br/></w:r>'; return; }
          // Strip PD marks but keep text
          for (const child of node.childNodes) walk(child, b, i, u);
        }
      };
      walk(el);
      return runs || '<w:r><w:t></w:t></w:r>';
    };

    let paras = '';
    for (const node of tmp.childNodes) {
      if (node.nodeType !== 1) continue;
      const tag = node.tagName?.toUpperCase() || '';
      if (tag === 'HR') continue; // skip hr - page break artifact
      
      // lr-row: smart rendering — city+date on one line, signatures on separate lines
      if (node.classList && node.classList.contains('lr-row')) {
        const spans = node.querySelectorAll('span');
        const leftText = (spans[0] ? spans[0].textContent : '').trim().replace(/\s+/g, ' ');
        const rightText = (spans[1] ? spans[1].textContent : '').trim().replace(/\s+/g, ' ');
        const fontProps = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="28"/><w:szCs w:val="28"/>';

        // Detect city+date line: дата может быть слева или справа
        const monthRe = /января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря/;
        const yearRe = /\d{4}/;
        const hasDateLeft = yearRe.test(leftText) || monthRe.test(leftText);
        const hasDateRight = yearRe.test(rightText) || monthRe.test(rightText);
        // isCityDate = одна сторона содержит дату, другая — город/адрес
        const isCityDate = (hasDateLeft || hasDateRight) && (leftText.length > 0 && rightText.length > 0);

        if (isCityDate) {
          // City + date on one line via right-aligned tab stop
          paras += '<w:p>' +
            '<w:pPr><w:jc w:val="left"/><w:spacing w:after="0" w:before="0"/>' +
              '<w:tabs><w:tab w:val="right" w:pos="9072"/></w:tabs>' +
            '</w:pPr>' +
            '<w:r><w:rPr>' + fontProps + '</w:rPr><w:t xml:space="preserve">' + esc(leftText) + '</w:t></w:r>' +
            '<w:r><w:rPr>' + fontProps + '</w:rPr><w:tab/></w:r>' +
            '<w:r><w:rPr>' + fontProps + '</w:rPr><w:t xml:space="preserve">' + esc(rightText) + '</w:t></w:r>' +
          '</w:p>';
        } else {
          // Signatures/positions: two separate left-aligned lines (no justify stretching)
          if (leftText) {
            paras += '<w:p><w:pPr><w:jc w:val="left"/><w:spacing w:after="0" w:before="0"/></w:pPr>' +
              '<w:r><w:rPr>' + fontProps + '</w:rPr><w:t xml:space="preserve">' + esc(leftText) + '</w:t></w:r></w:p>';
          }
          if (rightText) {
            paras += '<w:p><w:pPr><w:jc w:val="left"/><w:spacing w:after="0" w:before="0"/></w:pPr>' +
              '<w:r><w:rPr>' + fontProps + '</w:rPr><w:t xml:space="preserve">' + esc(rightText) + '</w:t></w:r></w:p>';
          }
        }
        continue;
      }

      // Пропускаем разделители страниц
      if (node.classList && node.classList.contains('page-separator')) continue;

      // Шапка справа (right-block) — левый отступ 55% = ~5100 DXA от поля
      const isRightBlock = node.classList && node.classList.contains('right-block');
      // Абзацный отступ первой строки
      const hasTextIndent = node.style && node.style.textIndent;

      // Check for inline style center (from [CENTER] tags rendered as style="text-align:center")
      let align = getAlign(node);
      if (node.style && node.style.textAlign === 'center') align = 'center';
      if (node.tagName === 'H1' || node.tagName === 'H2') align = 'center';

      let pPr;
      if (isRightBlock) {
        // right-block: левый отступ ~5100 DXA (≈9см), выравнивание по ширине
        pPr = '<w:pPr><w:jc w:val="both"/><w:spacing w:after="0" w:before="0"/><w:ind w:left="5100"/></w:pPr>';
      } else if (hasTextIndent) {
        // text-indent: отступ первой строки ~709 DXA (≈1.25см)
        pPr = '<w:pPr><w:jc w:val="both"/><w:spacing w:after="0" w:before="0"/><w:ind w:firstLine="709"/></w:pPr>';
      } else {
        pPr = '<w:pPr><w:jc w:val="' + align + '"/><w:spacing w:after="0" w:before="0"/></w:pPr>';
      }

      let rStyle = '';
      if (tag === 'H1') rStyle = '<w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>';
      else if (tag === 'H2') rStyle = '<w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>';
      else if (tag === 'H3') rStyle = '<w:rPr><w:b/><w:bCs/></w:rPr>';

      const runs = nodeToRuns(node);
      const styledRuns = rStyle
        ? runs.replace(/<w:r>/g, '<w:r>' + rStyle)
        : runs;

      paras += '<w:p>' + pPr + styledRuns + '</w:p>';
    }

    // Build minimal .docx XML structure
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
${paras}
<w:sectPr>
  <w:pgSz w:w="11906" w:h="16838"/>
  <w:pgMar w:top="1134" w:right="1418" w:bottom="1134" w:left="1418"/>
</w:sectPr>
</w:body>
</w:document>`;

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const wordRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

    // Use JSZip from CDN to assemble the ZIP
    if (!window.JSZip) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    const zip = new window.JSZip();
    zip.file('[Content_Types].xml', contentTypesXml);
    zip.file('_rels/.rels', relsXml);
    zip.file('word/document.xml', docXml);
    zip.file('word/_rels/document.xml.rels', wordRelsXml);

    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseDocx = (docTitle || originalFileName || 'документ').replace(/\.pdf$/i, '').replace(/\.docx$/i, '').replace(/\.jpg$/i, '').replace(/\.png$/i, '').replace(/\.webp$/i, '');
    a.download = 'ЮрДок_' + baseDocx + '.docx';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Derived ───────────────────────────────────────────────────────────────────
  const privatePersons = personalData.persons?.filter(p => p.category === 'private') || [];
  const profPersons = personalData.persons?.filter(p => p.category === 'professional') || [];
  const otherPD = personalData.otherPD || [];
  const pdTypeGroups = otherPD.reduce((acc, it) => { (acc[it.type] = acc[it.type] || []).push(it); return acc; }, {});
  const pdTypeLabels = {
    address: 'Адреса',
    phone: 'Телефоны',
    passport: 'Паспорт РФ',
    zagranpassport: 'Загранпаспорт',
    inn: 'ИНН',
    snils: 'СНИЛС',
    card: 'Карты/счета',
    email: 'Email',
    dob: 'Даты рождения',
    birthplace: 'Место рождения',
    social_id: 'Аккаунты',
    vehicle_plate: 'Госномера ТС',
    vehicle_vin: 'VIN-номера',
    driver_license: 'Вод. удостоверения',
    military_id: 'Военные билеты',
    oms_policy: 'Полисы ОМС',
    birth_certificate: 'Св-ва о рождении',
    imei: 'IMEI устройств',
    org_link: 'Организации/ИП',
    other: 'Прочее',
  };
  const hasPD = privatePersons.length > 0 || profPersons.length > 0 || otherPD.length > 0;
  const currentEditingPd = editingPdId
    ? (personalData.persons?.find(p => p.id === editingPdId) || personalData.otherPD?.find(p => p.id === editingPdId) || null)
    : null;
  const currentEditingPdFragment = editingPdFragment
    ? {
        ...editingPdFragment,
        pdItem: personalData.persons?.find(p => p.id === editingPdFragment.id)
          || personalData.otherPD?.find(p => p.id === editingPdFragment.id)
          || null,
      }
    : null;
  const projectDocs = currentProject ? getProjectDocs() : [];
  const projectSummaryDoc = currentProject ? getProjectSummaryDoc() : null;

  // Check if a PD id has marks in the current document (for project context display)
  const pdInDoc = (id) => !pdIdsInDoc || pdIdsInDoc.has(id);

  const extractPdIdsFromHtml = (html) => {
    const ids = new Set();
    const re = /data-pd-id="([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) ids.add(m[1]);
    return ids;
  };

  if (isConfigured && authLoading) {
    return (
      <div className="app">
        <main className="main auth-main">
          <section className="card auth-card auth-loading-card">
            <h1 className="auth-title">Загрузка профиля</h1>
          </section>
        </main>
      </div>
    );
  }

  if (isConfigured && !user) {
    return (
      <div className="app">
        <AppHeader showNavigation={false} />
        <AuthScreen
          isConfigured={isConfigured}
          onSignIn={signInWithPassword}
          onSignUp={signUpWithPassword}
          loading={authLoading}
        />
      </div>
    );
  }

  if (dataLoading) {
    return (
      <div className="app">
        <AppHeader user={user} onSignOut={() => signOut()} showNavigation={false} />
        <main className="main auth-main">
          <section className="card auth-card auth-loading-card">
            <h1 className="auth-title">Загрузка данных</h1>
          </section>
        </main>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div className="app">
      <AppHeader
        view={view}
        currentProjectId={currentProjectId}
        user={user}
        onGoHome={goHome}
        onGoBackToProject={goBackToProject}
        onSignOut={() => signOut()}
        headerRef={headerRef}
      />

      {/* ── UNCERTAIN WARNING MODAL ── */}
      {showUncertainWarning && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-title">⚠️ Документ требует проверки</div>
            <div className="modal-body">
              {countUncertain() > 0 && (
                <div>Найдено <strong>{countUncertain()}</strong> {countUncertain() === 1 ? 'фрагмент' : 'фрагментов'} с неточным распознаванием — выделены двойным подчёркиванием.</div>
              )}
              {countPageSeparators() > 0 && (
                <div style={{marginTop: countUncertain() > 0 ? 8 : 0}}>Найдено <strong>{countPageSeparators()}</strong> {countPageSeparators() === 1 ? 'разделитель частей' : 'разделителей частей'} — они выделены и не должны оставаться в финальном документе.</div>
              )}
              <div style={{marginTop: 10, color: 'var(--text2)'}}>Рекомендуем проверить и исправить их перед сохранением.</div>
            </div>
            <div className="modal-actions">
              <button className="btn-tool" onClick={handleUncertainCancel}>Перейти к исправлению</button>
              <button className="btn-primary btn-sm" onClick={handleUncertainProceed}>Всё равно продолжить</button>
            </div>
          </div>
        </div>
      )}

      {/* ── SAVE TOAST ── */}
      {savedMsg && (
        <div className="save-toast">✓ Документ сохранён</div>
      )}

      {showUnsaved && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-title">Несохранённые изменения</div>
            <div className="modal-body">Документ «{docTitle}» изменён. Сохранить перед выходом?</div>
            <div className="modal-actions">
              <button className="btn-primary btn-sm" onClick={handleUnsavedSave}>Сохранить</button>
              <button className="btn-tool" onClick={handleUnsavedDiscard}>Не сохранять</button>
              <button className="btn-tool" onClick={() => setShowUnsaved(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      <main className={`main${view === VIEW_RESULT ? ' main-result' : ''}`}>

        {/* ════ HOME ════ */}
        {view === VIEW_HOME && (
          <HomeProjectsView
            projects={projects}
            onCreateProject={() => setShowCreateProject(true)}
            onOpenProject={openProject}
            onDeleteProject={handleDeleteProject}
            formatDate={formatDate}
          />
        )}

        {/* ════ CREATE PROJECT MODAL ════ */}
        {currentEditingPd && (
          <PdRecordEditorModal
            pdItem={currentEditingPd}
            onClose={() => setEditingPdId(null)}
            onSave={handleSavePdEdit}
          />
        )}
        {currentEditingPdFragment && (
          <PdFragmentEditorModal
            fragment={currentEditingPdFragment}
            onClose={() => setEditingPdFragment(null)}
            onSave={handleSavePdFragmentEdit}
          />
        )}

        {/* ════ CREATE PROJECT MODAL ════ */}
        {showCreateProject && (
          <div className="modal-overlay">
            <div className="modal">
              <div className="modal-title">Новый проект</div>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label className="modal-label">Название</label>
                  <input
                    className="modal-input"
                    placeholder="Например: Дело № 123/2026"
                    value={newProjectTitle}
                    onChange={e => setNewProjectTitle(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
                    autoFocus
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn-primary btn-sm" onClick={handleCreateProject} disabled={!newProjectTitle.trim()}>Создать</button>
                <button className="btn-tool" onClick={() => { setShowCreateProject(false); setNewProjectTitle(''); }}>Отмена</button>
              </div>
            </div>
          </div>
        )}

        {/* ════ REBUILD SUMMARY CONFIRM ════ */}
        {showRebuildConfirm && (
          <div className="modal-overlay">
            <div className="modal">
              <div className="modal-title">Пересобрать итоговый документ?</div>
              <div className="modal-body">Существующий итоговый документ будет заменён новым. Все изменения, внесённые в предыдущий итоговый документ, будут потеряны.</div>
              <div className="modal-actions">
                <button className="btn-primary btn-sm" onClick={handleConfirmRebuild}>Пересобрать</button>
                <button className="btn-tool" onClick={() => setShowRebuildConfirm(false)}>Отмена</button>
              </div>
            </div>
          </div>
        )}

        {/* ════ PROJECT VIEW ════ */}
        {view === VIEW_PROJECT && currentProject && (
          <ProjectWorkspaceView
            currentProject={currentProject}
            currentBatchSession={currentBatchSession}
            currentBatchDisplayState={currentBatchDisplayState}
            provider={provider}
            setProvider={setProvider}
            apiKey={apiKey}
            setApiKey={setApiKey}
            showApiKey={showApiKey}
            setShowApiKey={setShowApiKey}
            inputTab={inputTab}
            setInputTab={setInputTab}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            projectFileInputRef={projectFileInputRef}
            projectDocxInputRef={projectDocxInputRef}
            projectImportRef={projectImportRef}
            handleProjectDocumentDrop={handleProjectDocumentDrop}
            handleProjectDocumentFiles={handleProjectDocumentFiles}
            handleProjectDocxFiles={handleProjectDocxFiles}
            files={files}
            docxFiles={docxFiles}
            removeFile={removeFile}
            removeDocxFile={removeDocxFile}
            pastedText={pastedText}
            setPastedText={setPastedText}
            requestPauseActiveBatch={requestPauseActiveBatch}
            handleResetProjectBatchSession={handleResetProjectBatchSession}
            getBatchStatusTitle={getBatchStatusTitle}
            getBatchResumeText={getBatchResumeText}
            getBatchSourceSelectionHint={getBatchSourceSelectionHint}
            warningMessage={warningMessage}
            error={error}
            handleProjectRecognize={handleProjectRecognize}
            formatDate={formatDate}
            projectDocs={projectDocs}
            projectSummaryDoc={projectSummaryDoc}
            openDocFromProject={openDocFromProject}
            formatDocumentPageProgress={formatDocumentPageProgress}
            handleRemoveDocFromProject={handleRemoveDocFromProject}
            exportDocument={exportDocument}
            handleBuildSummary={handleBuildSummary}
            handleDeleteSummary={handleDeleteSummary}
            handleProjectImport={handleProjectImport}
            onImportClick={() => projectImportRef.current?.click()}
            onProjectTitleChange={(nextTitle) => {
              setProjects((prev) => prev.map((item) => (
                item.id === currentProject.id
                  ? { ...item, title: nextTitle, updatedAt: new Date().toISOString() }
                  : item
              )));
              void saveProjectRecord(user, { ...currentProject, title: nextTitle });
            }}
          />
        )}

        {/* ════ PROCESSING ════ */}
        {view === VIEW_PROCESSING && progress && (
          <ProcessingView
            progress={progress}
            activeBatchUiState={activeBatchUiState}
            onPause={() => requestPauseActiveBatch(VIEW_PROJECT)}
            onResume={handleProjectRecognize}
            onReturnToProject={() => setView(VIEW_PROJECT)}
          />
        )}

        {/* ════ RESULT ════ */}
        {view === VIEW_RESULT && (
          <ResultWorkspaceView
            showOriginal={showOriginal}
            originalImages={originalImages}
            hasPD={hasPD}
            pdWidth={pdWidth}
            setPdPanelRef={setPdPanelRef}
            startResize={startResize}
            privatePersons={privatePersons}
            profPersons={profPersons}
            pdTypeGroups={pdTypeGroups}
            pdTypeLabels={pdTypeLabels}
            anonymized={anonymized}
            pdInDoc={pdInDoc}
            handlePdClick={handlePdClick}
            initNavCounter={initNavCounter}
            navigateToPd={navigateToPd}
            openPdEditor={openPdEditor}
            handleDeletePdEntry={handleDeletePdEntry}
            anonymizeAllByCategory={anonymizeAllByCategory}
            pdNavState={pdNavState}
            docTitle={docTitle}
            setDocTitle={setDocTitle}
            titleRowRef={titleRowRef}
            handleToggleOriginalViewer={handleToggleOriginalViewer}
            handleLoadOriginalViewerImages={handleLoadOriginalViewerImages}
            triggerExport={triggerExport}
            showLongDocWarning={showLongDocWarning}
            setShowLongDocWarning={setShowLongDocWarning}
            editorHtml={editorHtml}
            handleEditorHtmlChange={handleEditorHtmlChange}
            personalData={personalData}
            editorDomRef={editorDomRef}
            highlightUncertain={highlightUncertain}
            editorTotalPages={editorTotalPages}
            editorCurrentPage={editorCurrentPage}
            editorPageInput={editorPageInput}
            editorPageInputRef={editorPageInputRef}
            setEditorPageInput={setEditorPageInput}
            handleEditorPageSubmit={handleEditorPageSubmit}
            handleEditorPageStep={handleEditorPageStep}
            handlePdClickFromEditor={handlePdClick}
            handleRemovePdMark={handleRemovePdMark}
            handleApplyPdCanonicalText={handleApplyPdCanonicalText}
            openPdFragmentEditor={openPdFragmentEditor}
            handleAttachPdMark={handleAttachPdMark}
            handleAddPdMark={handleAddPdMark}
            handleRemoveAmbiguousMark={handleRemoveAmbiguousMark}
            handleUncertainResolved={handleUncertainResolved}
            originalPage={originalPage}
            setOriginalPage={setOriginalPage}
            zoomActive={zoomActive}
            setZoomActive={setZoomActive}
            zoomScale={zoomScale}
            setZoomScale={setZoomScale}
            viewerWidth={viewerWidth}
            onCloseOriginal={() => setShowOriginal(false)}
          />
        )}

      </main>

      <footer className="footer">
        ЮрДок — обработка происходит только в вашем браузере, документы не сохраняются на серверах
      </footer>
    </div>
  );
}

function formatDate(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
