import React, { useState, useRef, useCallback, useEffect } from 'react';
import { pdfToImages, imageFileToBase64 } from './utils/pdfUtils';
import { recognizeDocument, analyzePD, analyzePastedText, PD_ANALYSIS_CHAR_LIMIT, PROVIDERS } from './utils/claudeApi';
import { parseDocx } from './utils/docxParser';
import AuthScreen from './components/AuthScreen';
import DocumentPatchList from './components/DocumentPatchList';
import DocumentTitleActions from './components/DocumentTitleActions';
import OriginalViewerPanel from './components/OriginalViewerPanel';
import PdFragmentEditorModal from './components/PdFragmentEditorModal';
import PdfPatchExportPreviewModal from './components/PdfPatchExportPreviewModal';
import { RichEditor, buildAnnotatedHtml, buildPdMatchPattern, patchPdMarks, initPdMarkOriginals } from './components/RichEditor';
import { useAuth } from './context/AuthContext';
import { usePdfExportFlow } from './hooks/usePdfExportFlow';
import { usePatchedViewerPages } from './hooks/usePatchedViewerPages';
import { useStoredData } from './hooks/useStoredData';
import { buildDocumentCoordinateLayer } from './utils/documentCoordinateLayer';
import { findBestCoordinateMatch } from './utils/documentCoordinateMatcher';
import { normalizeDocumentPatchLayer, upsertDocumentPatch } from './utils/documentPatchLayer';
import { buildLoadedDocumentState, getClearedWorkspaceState } from './utils/documentViewState';
import { buildDocumentPageMetadata } from './utils/documentPageMetadata';
import { generateId, exportDocument, importDocument } from './utils/history';
import { getOriginalImageForPage, getOriginalImageIndexForPage } from './utils/originalImagePages';
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
  uploadSourceFile,
} from './utils/dataStore';
import { formatProjectChunkPageRange, getProjectPdfChunkEnd } from './utils/projectBatch';
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

function getPreferredPdfPageForMark(editorEl, markEl, pageMetadata, coordinateLayer) {
  if (!editorEl || !markEl?.isConnected) return null;

  const separators = Array.from(editorEl.querySelectorAll('.page-separator[data-page]'));
  let relativePage = 1;
  for (const separator of separators) {
    if (separator === markEl) continue;
    if (separator.compareDocumentPosition(markEl) & Node.DOCUMENT_POSITION_FOLLOWING) {
      relativePage = Number(separator.dataset.page || relativePage);
    } else {
      break;
    }
  }

  const absoluteStartPage = pageMetadata?.sources?.[0]?.pageFrom
    || coordinateLayer?.pages?.[0]?.pageNumber
    || 1;

  return absoluteStartPage + relativePage - 1;
}

function truncatePatchText(value, maxLength = 72) {
  const text = normalizePdText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
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

function getBatchStatusTitle(status) {
  if (status === 'failed') return 'Обработка большого PDF остановлена';
  if (status === 'paused') return 'Обработка PDF приостановлена';
  if (status === 'pausing') return 'Приостанавливаем обработку PDF';
  if (status === 'running') return 'Идёт обработка PDF';
  return 'Есть незавершённая обработка PDF';
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
  const [showAddFromHistory, setShowAddFromHistory] = useState(false);
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);
  const [editingPdId, setEditingPdId] = useState(null);
  const [editingPdFragment, setEditingPdFragment] = useState(null);
  const [homeTab, setHomeTab] = useState('projects'); // 'projects' | 'history'
  const [inputTab, setInputTab] = useState('documents'); // 'documents' | 'text'
  const [pdIdsInDoc, setPdIdsInDoc] = useState(null); // Set of PD ids present in current doc, or null if not in project

  const [files, setFiles] = useState([]);
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
  const [coordinateLayer, setCoordinateLayer] = useState(null);
  const [patchLayer, setPatchLayer] = useState(null);
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
  const fileInputRef = useRef();
  const importInputRef = useRef();
  const projectFileInputRef = useRef();
  const projectImportRef = useRef();
  const editorPageInputRef = useRef(null);
  const editorNavigatingPageRef = useRef(null);
  const editorPageNavigationTimerRef = useRef(null);
  const dragFileIdx = useRef(null);
  const uploadedFilesRef = useRef(new Map());

  const handleStoredDataError = useCallback((message) => {
    setError(message);
  }, []);

  const handleStoredDataSignedOut = useCallback(() => {
    setCurrentProjectId(null);
    uploadedFilesRef.current.clear();
  }, []);

  const resetOriginalViewerTransform = useCallback(() => {
    setZoomScale(1);
    setZoomActive(false);
  }, []);

  const handleOpenOriginalPageNumber = useCallback((pageNumber) => {
    const imageIndex = getOriginalImageIndexForPage(originalImages, pageNumber);
    if (imageIndex < 0) return;
    setShowOriginal(true);
    setOriginalPage(imageIndex);
    resetOriginalViewerTransform();
  }, [originalImages, resetOriginalViewerTransform]);

  const syncOriginalViewerToDocumentPage = useCallback((pageNumber) => {
    const imageIndex = getOriginalImageIndexForPage(originalImages, pageNumber);
    if (imageIndex < 0) return;
    setOriginalPage(imageIndex);
  }, [originalImages]);

  const handleToggleOriginalViewer = useCallback(() => {
    setShowOriginal((visible) => !visible);
    setOriginalPage(0);
  }, []);

  const {
    clearPatchedViewerPages,
    handleApplyPdFragmentPreview,
    handleRemovePatchEntry,
    patchedViewerPageCount,
    viewerImages,
  } = usePatchedViewerPages({
    originalImages,
    patchLayer,
    setPatchLayer,
    onOpenOriginalPageNumber: handleOpenOriginalPageNumber,
  });

  const handleLoadOriginalViewerImages = useCallback((allImages) => {
    setOriginalImages(allImages);
    clearPatchedViewerPages();
    setShowOriginal(true);
    setOriginalPage(0);
  }, [clearPatchedViewerPages]);

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

  const {
    activePatchEntries,
    canProceedPdfPatchExport,
    exportReadyPatchEntries,
    handleClosePdfPatchPreview,
    handleConfirmPdfPatchExport,
    handleDownloadPdf,
    nonExportablePatchEntries,
    showPdfPatchPreview,
  } = usePdfExportFlow({
    patchLayer,
    anonymized,
    coordinateLayer,
    pageMetadata,
    originalImages,
    docTitle,
    originalFileName,
    editorHtml,
    editorDomRef,
  });

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
      if (headerEl) {
        const headerBottom = Math.round(headerEl.getBoundingClientRect().bottom);
        document.documentElement.style.setProperty('--header-h', `${headerHeight}px`);
        document.documentElement.style.setProperty('--header-offset', `${headerBottom}px`);
      }
      if (titleEl) {
        const height = titleEl.offsetHeight;
        const titleBottom = Math.round(titleEl.getBoundingClientRect().bottom);
        document.documentElement.style.setProperty('--titlerow-h', `${height}px`);
        document.documentElement.style.setProperty('--toolbar-top', `${titleBottom}px`);
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
        setLastSavedState(JSON.stringify({
          anonymized: JSON.stringify(anonymized),
          html: realHtml,
          patchLayer: JSON.stringify(normalizeDocumentPatchLayer({ patchLayer })),
        }));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [view]); // only re-run when view changes

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
  const homeBatchProject = projects.find((project) => getProjectBatchDisplayState(project)) || null;
  const homeBatchDisplayState = homeBatchProject ? getProjectBatchDisplayState(homeBatchProject) : null;

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
            message: 'Приостанавливаем обработку после текущей страницы...',
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

  const getProjectDocs = () => {
    if (!currentProject) return [];
    return currentProject.documentIds
      .map(id => history.find(h => h.id === id))
      .filter(Boolean);
  };

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

  const getProjectExistingPD = () => {
    if (currentProject?.sharedPD && ((currentProject.sharedPD.persons || []).length > 0 || (currentProject.sharedPD.otherPD || []).length > 0)) {
      return currentProject.sharedPD;
    }
    const projectDocs = getProjectDocs();
    if (projectDocs.length === 0) return null;
    const lastDoc = projectDocs[projectDocs.length - 1];
    return lastDoc.personalData || null;
  };

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

  const handleAddDocFromHistory = async (docId) => {
    if (!currentProjectId) return;
    const doc = history.find(h => h.id === docId);
    if (!doc) return;
    await mergeDocIntoProject(doc);
    setShowAddFromHistory(false);
  };

  const handleProjectImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const entry = await importDocument(file);
      await saveDocumentRecord(user, entry);
      await refreshHistory();
      await mergeDocIntoProject(entry);
    } catch (err) {
      setError(err.message || 'Ошибка импорта');
    }
  };

  // ── Project summary document ────────────────────────────────────────────────
  const getProjectSummaryDoc = () => {
    if (!currentProject) return null;
    return getProjectSummaryDocEntry(history, currentProjectId);
  };

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

  const handleProjectFiles = useCallback((newFiles) => {
    const valid = Array.from(newFiles).filter(f => f.type === 'application/pdf');
    if (valid.length !== newFiles.length) setError('В проект можно загружать только PDF-файлы');
    setFiles(prev => [...prev, ...valid]);
  }, []);

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
      setWarningMessage(`Не удалось загрузить исходный PDF "${file.name}" в облако. Распознавание продолжено без облачной копии исходника.`);
      return null;
    }
  }, [user]);

  const handleProjectRecognize = async () => {
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
        setActiveBatchUiState(nextState || null);
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

  // ── Import .юрдок file ──────────────────────────────────────────────────────
  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const entry = await importDocument(file);
      await saveDocumentRecord(user, entry);
      await refreshHistory();
      setCurrentProjectId(null);
      loadDoc(entry);
    } catch (err) {
      setError(err.message || 'Ошибка импорта');
    }
  };

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
    setCoordinateLayer(nextState.coordinateLayer);
    setPatchLayer(nextState.patchLayer);
    setRawText(nextState.rawText);
    setEditorHtml(nextState.editorHtml);
    setOriginalImages(nextState.originalImages);
    clearPatchedViewerPages();
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
  }, [clearPatchedViewerPages, currentProjectId, shouldShowLongDocWarningForEntry]);

  // ── Dirty check ──────────────────────────────────────────────────────────────
  const isDirty = () => {
    const currentHtml = editorDomRef.current?.innerHTML || '';
    if (!lastSavedState) return !!currentHtml;
    const saved = JSON.parse(lastSavedState);
    if (JSON.stringify(anonymized) !== saved.anonymized) return true;
    if (currentHtml !== saved.html) return true;
    if (JSON.stringify(normalizeDocumentPatchLayer({ patchLayer })) !== (saved.patchLayer || 'null')) return true;
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
    setPastedText(cleared.pastedText);
    setOriginalImages(cleared.originalImages);
    clearPatchedViewerPages();
    setShowOriginal(cleared.showOriginal);
    setOriginalPage(cleared.originalPage);
    setZoomActive(cleared.zoomActive);
    setZoomScale(cleared.zoomScale);
    setZoomOffset(cleared.zoomOffset);
    setOriginalFileName(cleared.originalFileName);
    setSourceFiles(cleared.sourceFiles);
    setPageMetadata(cleared.pageMetadata);
    setCoordinateLayer(cleared.coordinateLayer);
    setPatchLayer(cleared.patchLayer);
    setError(cleared.error);
    setWarningMessage(null);
    setProgress(cleared.progress);
    setShowUnsaved(cleared.showUnsaved);
  }, [clearPatchedViewerPages]);

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

  // ── Files ─────────────────────────────────────────────────────────────────────
  const handleFiles = useCallback((newFiles) => {
    const valid = Array.from(newFiles).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.docx'));
    if (valid.length !== newFiles.length) setError('Поддерживаются JPG, PNG, WEBP, PDF и DOCX');
    setFiles(prev => [...prev, ...valid]);
  }, []);

  const handleDrop = useCallback((e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }, [handleFiles]);
  const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx));

  // ── Recognize ─────────────────────────────────────────────────────────────────
  const handleRecognize = async () => {
    if (!apiKey.trim()) { setError('Введите API ключ Claude'); return; }
    if (files.length === 0 && !pastedText.trim()) { setError('Добавьте хотя бы один файл или вставьте текст'); return; }

    setCurrentProjectId(null);
    setPdIdsInDoc(null);
    setError(null);
    setWarningMessage(null);
    setView(VIEW_PROCESSING);

    try {
      let result;
      let renderedInputPages = [];
      const hasPastedText = !!pastedText.trim();
      const isDocx = files.length === 1 && files[0].name.toLowerCase().endsWith('.docx');

      if (hasPastedText) {
        setOriginalImages([]);
        clearPatchedViewerPages();
        setNonDecreasingProgress({ percent: 10, message: 'Подготовка текста...' });
        animateTo(85, null);
        result = await analyzePastedText(pastedText.trim(), apiKey.trim(), provider, p => {
          const pct = p.percent != null ? Math.round(p.percent) : (p.stage === 'done' ? 100 : 50);
          setNonDecreasingProgress({ percent: pct, message: p.message });
        });
        stopProgressCreep();
      } else if (isDocx) {
        setNonDecreasingProgress({ percent: 10, message: 'Чтение документа DOCX...' });
        const docxText = await parseDocx(files[0]);
        setNonDecreasingProgress({ percent: 40, message: 'Анализ персональных данных...' });
        animateTo(90, null);
        const personalData = await analyzePD(docxText, apiKey.trim(), provider, p => {
          const pct = p.percent != null ? Math.round(p.percent) : 97;
          setNonDecreasingProgress({ percent: pct, message: p.message });
        });
        stopProgressCreep();
        result = { text: docxText, personalData };
      } else {
        setNonDecreasingProgress({ percent: 2, message: 'Подготовка файлов...' });
        const allImages = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file.type === 'application/pdf') {
            const pages = await pdfToImages(file, (page, total) => {
              const fileBase = 4 + Math.round((i / files.length) * 16);
              const fileSpan = Math.max(4, Math.round(16 / files.length));
              const renderPercent = Math.min(22, fileBase + Math.round((page / Math.max(1, total)) * fileSpan));
              setNonDecreasingProgress({
                percent: renderPercent,
                message: total > 1
                  ? `Подготовка PDF: страница ${page} из ${total}...`
                  : 'Подготовка PDF: рендер страницы...',
              });
            });
            if (pages.length > 0) {
              setNonDecreasingProgress({
                percent: Math.min(24, 8 + Math.round(((i + 1) / files.length) * 16)),
                message: pages.length > 1
                  ? `PDF подготовлен: ${pages.length} стр.`
                  : 'PDF подготовлен',
              });
            } else {
              setNonDecreasingProgress({
                percent: Math.min(24, 8 + Math.round(((i + 1) / files.length) * 16)),
                message: 'PDF подготовлен',
              });
            }
            allImages.push(...pages);
          } else {
            setNonDecreasingProgress({
              percent: Math.min(18, 6 + Math.round((i / Math.max(1, files.length)) * 10)),
              message: `Подготовка изображения: ${file.name}...`,
            });
            allImages.push(await imageFileToBase64(file));
            setNonDecreasingProgress({
              percent: Math.min(24, 10 + Math.round(((i + 1) / Math.max(1, files.length)) * 14)),
              message: `Изображение подготовлено: ${file.name}`,
            });
          }
        }
        renderedInputPages = allImages;
        setOriginalImages(allImages);
        clearPatchedViewerPages();
        result = await recognizeDocument(allImages, apiKey.trim(), provider, p => {
          const pct = p.percent != null ? Math.round(p.percent) : (p.stage === 'done' ? 100 : 50);
          setNonDecreasingProgress({ percent: pct, message: p.message });
          if (p.stage === 'ocr') {
            animateTo(Math.min(pct + 12, 74), null);
          } else if (p.stage === 'analysis') {
            animateTo(Math.min(pct + 8, 98), null);
          } else {
            stopProgressCreep();
          }
        });
      }

      const pd = assignLetters(result.personalData);
      const initialAnon = {};
      const html = buildAnnotatedHtml(result.text, pd, initialAnon);
      const title = hasPastedText
        ? `Текст от ${formatDate(new Date())}`
        : (files[0]?.name || `Документ от ${formatDate(new Date())}`);
      const origName = hasPastedText ? '' : (files[0]?.name || '');
      const newDocId = generateId();
      const uploadedSourceFiles = hasPastedText
        ? []
        : (await Promise.all(files.map(file => ensureUploadedSourceFile(file)))).filter(Boolean);
      const nextPageMetadata = !hasPastedText
        && !isDocx
        && files.length === 1
        && files[0].type === 'application/pdf'
        && renderedInputPages.length > 0
        ? buildDocumentPageMetadata({
            sourceFile: uploadedSourceFiles[0] || null,
            batchFileName: files[0].name,
            pageFrom: renderedInputPages[0]?.pageNum || 1,
            pageTo: renderedInputPages[renderedInputPages.length - 1]?.pageNum || renderedInputPages.length,
            totalPages: renderedInputPages[0]?.totalPages || renderedInputPages.length,
            pages: renderedInputPages,
          })
        : null;
      const nextCoordinateLayer = !hasPastedText
        && !isDocx
        && files.length === 1
        && files[0].type === 'application/pdf'
        && renderedInputPages.length > 0
        ? buildDocumentCoordinateLayer({
            pages: renderedInputPages,
          })
        : null;

      // Auto-save immediately after recognition
      await saveDocumentRecord(user, {
        id: newDocId,
        title,
        originalFileName: origName,
        text: result.text,
        editedHtml: html,
        personalData: pd,
        anonymized: initialAnon,
        source: hasPastedText ? 'paste' : (files.length === 1 && files[0].name.toLowerCase().endsWith('.docx') ? 'docx' : 'ocr'),
        sourceFiles: uploadedSourceFiles,
        pageMetadata: nextPageMetadata,
        coordinateLayer: nextCoordinateLayer,
      });

      setDocId(newDocId);
      setDocTitle(title);
      setOriginalFileName(origName);
      setSourceFiles(uploadedSourceFiles);
      setPageMetadata(nextPageMetadata);
      setCoordinateLayer(nextCoordinateLayer);
      setPatchLayer(null);
      setRawText(result.text);
      setEditorHtml(html);
      pdRef.current   = pd;
      anonRef.current = initialAnon;
      setPersonalData(pd);
      setAnonymized(initialAnon);
      setLastSavedState(JSON.stringify({
        anonymized: JSON.stringify(initialAnon),
        html,
        patchLayer: 'null',
      }));
      undoStackRef.current = [{ html, pd, anon: initialAnon }];
      undoIndexRef.current = 0;
      setShowLongDocWarning(result.text.replace(/\[PAGE:\d+\]/g, '').length > PD_ANALYSIS_CHAR_LIMIT);

      stopProgressCreep();
      await refreshHistory();
      setTimeout(() => { setView(VIEW_RESULT); setProgress(null); }, 400);
    } catch (err) {
      stopProgressCreep();
      setError(err.message || 'Произошла ошибка');
      setView(VIEW_HOME);
      setProgress(null);
    }
  };

  // ── Load from history ─────────────────────────────────────────────────────────
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

  const formatPatchEntryText = useCallback((patchEntry) => (
    truncatePatchText(
      patchEntry?.patchPlan?.replacementText
      || patchEntry?.patchPlan?.region?.replacementText
      || patchEntry?.patchPlan?.originalText
      || ''
    )
  ), []);

  const canOpenOriginalPatchPage = useCallback((pageNumber) => (
    getOriginalImageIndexForPage(originalImages, pageNumber) >= 0
  ), [originalImages]);

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
    const currentHtml = editorDomRef.current?.innerHTML || editorHtml;
    const docData = {
      id: docId,
      title: docTitle,
      originalFileName,
      sourceFiles,
      pageMetadata,
      coordinateLayer,
      patchLayer,
      text: rawText,
      editedHtml: currentHtml,
      personalData,
      anonymized,
      source: files[0]?.name?.toLowerCase().endsWith('.docx') ? 'docx' : 'ocr',
    };
    // Если работаем в контексте проекта — помечаем документ и добавляем в проект
    if (currentProjectId) {
      docData.projectId = currentProjectId;
      await saveDocumentRecord(user, docData);
      await addDocumentToProjectRecord(user, currentProjectId, docId);
      await refreshProjects();
    } else {
      await saveDocumentRecord(user, docData);
    }
    setLastSavedState(JSON.stringify({
      anonymized: JSON.stringify(anonymized),
      html: currentHtml,
      patchLayer: JSON.stringify(normalizeDocumentPatchLayer({ patchLayer })),
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
    const preferredPageNumber = getPreferredPdfPageForMark(editorDomRef.current, markEl, pageMetadata, coordinateLayer);
    const coordinateMatch = fragmentText && coordinateLayer
      ? findBestCoordinateMatch({
          fragmentText,
          coordinateLayer,
          preferredPageNumber,
        })
      : null;

    setEditingPdFragment({
      id,
      text: fragmentText,
      markEl,
      preferredPageNumber,
      coordinateMatch,
      hasCoordinateLayer: !!coordinateLayer,
      pageMetadataSource: pageMetadata?.sources?.[0] || null,
    });
  }, [coordinateLayer, pageMetadata]);

  const handleRevealPdFragmentMatch = useCallback((match) => {
    if (!match) return;
    const imageIndex = getOriginalImageIndexForPage(originalImages, match.pageNumber);
    if (imageIndex < 0) return;
    setShowOriginal(true);
    setOriginalPage(imageIndex);
    resetOriginalViewerTransform();
  }, [originalImages, resetOriginalViewerTransform]);

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
    setPatchLayer((prev) => upsertDocumentPatch({
      patchLayer: prev,
      fragmentId: payload.id,
      patchPlan: payload.patchPlan || null,
    }));
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

  // Documents not belonging to any project — shown on main page history
  const freeHistory = history.filter(h => !h.projectId);

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
        <header className="header">
          <div className="header-inner">
            <div className="header-left" />
            <div className="header-center">
              <div className="logo">
                <span className="logo-icon">⚖</span>
                <div>
                  <div className="logo-title">ЮрДок</div>
                  <div className="logo-sub">Распознавание документов</div>
                </div>
              </div>
            </div>
            <div className="header-right" />
          </div>
        </header>
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
        <header className="header">
          <div className="header-inner">
            <div className="header-left" />
            <div className="header-center">
              <div className="logo">
                <span className="logo-icon">⚖</span>
                <div>
                  <div className="logo-title">ЮрДок</div>
                  <div className="logo-sub">Распознавание документов</div>
                </div>
              </div>
            </div>
            <div className="header-right">
              {user && (
                <div className="header-user">
                  <div className="header-user-meta">
                    <span className="header-user-label">Аккаунт</span>
                    <span className="header-user-email">{user.email}</span>
                  </div>
                  <button className="header-user-logout" onClick={() => signOut()}>Выйти</button>
                </div>
              )}
            </div>
          </div>
        </header>
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

      <header className="header" ref={headerRef}>
        <div className="header-inner">
          <div className="header-left" />
          <div className="header-center">
            {view === VIEW_RESULT && currentProjectId && (
              <button className="btn-tool header-home-btn" onClick={goBackToProject}>← Проект</button>
            )}
            {view === VIEW_RESULT && !currentProjectId && (
              <button className="btn-tool header-home-btn" onClick={goHome}>← На главную</button>
            )}
            {view === VIEW_PROJECT && (
              <button className="btn-tool header-home-btn" onClick={goHome}>← На главную</button>
            )}
            <div
              className="logo"
              onClick={view !== VIEW_HOME ? goHome : undefined}
              style={view !== VIEW_HOME ? { cursor: 'pointer' } : {}}
            >
              <span className="logo-icon">⚖</span>
              <div>
                <div className="logo-title">ЮрДок</div>
                <div className="logo-sub">Распознавание документов</div>
              </div>
            </div>
          </div>
          <div className="header-right">
            {user && (
              <div className="header-user">
                <div className="header-user-meta">
                  <span className="header-user-label">Аккаунт</span>
                  <span className="header-user-email">{user.email}</span>
                </div>
                <button className="header-user-logout" onClick={() => signOut()}>Выйти</button>
              </div>
            )}
          </div>
        </div>
      </header>

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

      <PdfPatchExportPreviewModal
        open={showPdfPatchPreview}
        exportReadyPatchEntries={exportReadyPatchEntries}
        nonExportablePatchEntries={nonExportablePatchEntries}
        hasOriginalImages={originalImages.length > 0}
        canProceed={canProceedPdfPatchExport}
        onClose={handleClosePdfPatchPreview}
        onConfirm={handleConfirmPdfPatchExport}
        onOpenPage={handleOpenOriginalPageNumber}
        canOpenPage={(pageNumber) => getOriginalImageIndexForPage(originalImages, pageNumber) >= 0}
        formatPatchText={truncatePatchText}
      />

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
          <>
            <section className="card api-card">
              <div className="provider-select-wrap">
                <label className="provider-label">Провайдер ИИ</label>
                <div className="provider-tabs">
                  {Object.entries(PROVIDERS).map(([key, p]) => (
                    <button
                      key={key}
                      className={'provider-tab' + (provider === key ? ' active' : '')}
                      onClick={() => { setProvider(key); setApiKey(''); }}
                      type="button"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="api-input-wrap" style={{ marginTop: 8 }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  className="api-input"
                  placeholder={PROVIDERS[provider].placeholder}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="api-toggle" onClick={() => setShowApiKey(v => !v)}>{showApiKey ? '🙈' : '👁'}</button>
              </div>
              <div className="api-hint">
                Ключ не сохраняется.{' '}
                {provider === 'claude' && <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">Получить ключ →</a>}
                {provider === 'openai' && <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">Получить ключ →</a>}
                {provider === 'gemini' && <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Получить ключ →</a>}
              </div>
            </section>

            <section className="card upload-card">
              <div className="input-tabs">
                <button
                  className={`input-tab${inputTab === 'documents' ? ' active' : ''}`}
                  onClick={() => setInputTab('documents')}
                  type="button"
                >
                  Документы
                </button>
                <button
                  className={`input-tab${inputTab === 'text' ? ' active' : ''}`}
                  onClick={() => setInputTab('text')}
                  type="button"
                >
                  Текст
                </button>
              </div>

              {inputTab === 'documents' && (
                <>
                  <div
                    className={`dropzone ${isDragging ? 'dragging' : ''}`}
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="visually-hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
                    <div className="dropzone-icon">📄</div>
                    <div className="dropzone-text"><strong>Перетащите файлы сюда</strong><br /><span>или нажмите для выбора</span></div>
                    <div className="dropzone-hint">JPG, PNG, WEBP, PDF, DOCX · Рекомендуем до 10 страниц. Если страниц больше, воспользуйтесь функцией "создать проект".</div>
                  </div>
                  {files.length > 0 && (
                    <div className="file-list">
                      {files.map((file, idx) => (
                        <div
                          key={idx}
                          className="file-item"
                          draggable
                          onDragStart={(e) => {
                            dragFileIdx.current = idx;
                            e.currentTarget.classList.add('dragging');
                          }}
                          onDragEnd={(e) => {
                            e.currentTarget.classList.remove('dragging');
                            dragFileIdx.current = null;
                            document.querySelectorAll('.file-item').forEach(el => el.classList.remove('drag-over'));
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.add('drag-over');
                          }}
                          onDragLeave={(e) => {
                            e.currentTarget.classList.remove('drag-over');
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove('drag-over');
                            const from = dragFileIdx.current;
                            const to = idx;
                            if (from === null || from === to) return;
                            setFiles(prev => {
                              const next = [...prev];
                              const [moved] = next.splice(from, 1);
                              next.splice(to, 0, moved);
                              return next;
                            });
                          }}
                        >
                          <span className="file-drag-handle" title="Перетащите для изменения порядка">⠿</span>
                          <span className="file-icon">{file.type === 'application/pdf' ? '📑' : file.name.toLowerCase().endsWith('.docx') ? '📝' : '🖼'}</span>
                          <span className="file-name">{file.name}</span>
                          <span className="file-size">{(file.size / 1024 / 1024).toFixed(1)} МБ</span>
                          <button className="file-remove" onClick={e => { e.stopPropagation(); removeFile(idx); }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {inputTab === 'text' && (
                <>
                  <textarea
                    className="paste-textarea"
                    placeholder="Вставьте цифровой текст документа для быстрого обезличивания и ручной проверки"
                    value={pastedText}
                    onChange={e => setPastedText(e.target.value)}
                    spellCheck={false}
                  />
                  <div className="paste-hint">
                    Этот режим работает без загрузки файлов и подходит для быстрых ручных проверок.
                  </div>
                </>
              )}
            </section>

            {warningMessage && <div className="warning-block">⚠️ {warningMessage}</div>}
            {error && <div className="error-block">⚠️ {error}</div>}

            {homeBatchProject && homeBatchDisplayState && (
              <div className={`project-batch-status home-batch-status ${homeBatchDisplayState.status === 'failed' ? 'failed' : ''}`}>
                <div className="project-batch-status-title">
                  {getBatchStatusTitle(homeBatchDisplayState.status)}
                </div>
                <div className="project-batch-status-body">
                  <strong>{homeBatchProject.title}</strong>
                  <span>{homeBatchDisplayState.fileName}</span>
                  <span>
                    Следующий запуск начнётся с {formatProjectChunkPageRange(
                      homeBatchDisplayState.nextPage,
                      getProjectPdfChunkEnd(homeBatchDisplayState.nextPage, homeBatchDisplayState.totalPages, 1),
                      homeBatchDisplayState.totalPages
                    )}.
                  </span>
                  {homeBatchDisplayState.message && <span>{homeBatchDisplayState.message}</span>}
                  {homeBatchDisplayState.error && <span>Последняя ошибка: {homeBatchDisplayState.error}</span>}
                </div>
                {Number.isFinite(homeBatchDisplayState.progressPercent) && (
                  <div className="project-batch-progress">
                    <div className="project-batch-progress-bar" style={{ width: `${Math.max(0, Math.min(100, Math.round(homeBatchDisplayState.progressPercent)))}%` }} />
                  </div>
                )}
                <div className="project-batch-actions">
                  <button className="btn-tool" onClick={() => openProject(homeBatchProject.id)}>
                    Открыть проект
                  </button>
                </div>
              </div>
            )}

            <div className="home-btn-wrap">
              <button
                className="btn-primary"
                onClick={handleRecognize}
                disabled={!apiKey.trim() || (files.length === 0 && !pastedText.trim())}
              >
                {pastedText.trim()
                  ? '🔒 Обезличить'
                  : (files.length > 0 && files[0].name.toLowerCase().endsWith('.docx') ? '🔒 Обезличить документ' : '🔍 Распознать и обезличить')}
              </button>
            </div>

            <input ref={importInputRef} type="file" accept=".юрдок,.yurdok" className="visually-hidden" onChange={handleImport} />

            {/* ── Unified bottom section with tabs ── */}
            <section className="card home-bottom-card">
              <div className="home-tabs">
                <button className={`home-tab${homeTab === 'projects' ? ' active' : ''}`} onClick={() => setHomeTab('projects')}>
                  📁 Проекты {projects.length > 0 && <span className="home-tab-count">{projects.length}</span>}
                </button>
                <button className={`home-tab${homeTab === 'history' ? ' active' : ''}`} onClick={() => setHomeTab('history')}>
                  📄 История {freeHistory.length > 0 && <span className="home-tab-count">{freeHistory.length}</span>}
                </button>
              </div>

              {homeTab === 'projects' && (
                <div className="home-tab-content">
                  <div className="home-tab-actions">
                    <button className="btn-tool" onClick={() => setShowCreateProject(true)}>+ Создать проект</button>
                  </div>
                  {projects.length > 0 ? (
                    <div className="projects-grid">
                      {projects.map(proj => (
                        <div key={proj.id} className="project-card" onClick={() => openProject(proj.id)}>
                          <div className="project-card-icon">📁</div>
                          <div className="project-card-body">
                            <div className="project-card-title">{proj.title}</div>
                            <div className="project-card-meta">
                              {proj.documentIds.length} {proj.documentIds.length === 1 ? 'документ' : proj.documentIds.length < 5 ? 'документа' : 'документов'} · {formatDate(new Date(proj.updatedAt || proj.createdAt))}
                            </div>
                          </div>
                          <button className="project-delete" onClick={e => handleDeleteProject(proj.id, e)} title="Удалить проект">✕</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="home-tab-empty">Создайте проект для объединения документов с общей базой персональных данных</div>
                  )}
                </div>
              )}

              {homeTab === 'history' && (
                <div className="home-tab-content">
                  <div className="home-tab-actions">
                    <button className="btn-tool btn-import" onClick={() => importInputRef.current?.click()}>📂 Загрузить .юрдок</button>
                  </div>
                  {freeHistory.length > 0 ? (
                    <div className="history-grid">
                      {freeHistory.map(entry => (
                        <div key={entry.id} className="history-card" onClick={() => { setCurrentProjectId(null); loadDoc(entry); }}>
                          <div className="history-card-icon">{entry.source === 'paste' ? '📋' : '📄'}</div>
                          <div className="history-card-body">
                            <div className="history-card-title">{entry.title}</div>
                            <div className="history-card-meta">{formatDate(new Date(entry.savedAt))}</div>
                            <div className="history-card-stats">
                              {(entry.personalData?.persons?.filter(p => p.category === 'private').length || 0) > 0 && (
                                <span className="badge badge-private">{entry.personalData.persons.filter(p => p.category === 'private').length} лиц</span>
                              )}
                              {(entry.personalData?.persons?.filter(p => p.category === 'professional').length || 0) > 0 && (
                                <span className="badge badge-prof">{entry.personalData.persons.filter(p => p.category === 'professional').length} проф.</span>
                              )}
                              {Object.values(entry.anonymized || {}).filter(Boolean).length > 0 && (
                                <span className="badge badge-anon">🔒 {Object.values(entry.anonymized).filter(Boolean).length} скрыто</span>
                              )}
                            </div>
                          </div>
                          <button className="history-export" onClick={e => { e.stopPropagation(); exportDocument(entry); }} title="Скачать .юрдок">⬇</button>
                          <button className="history-delete" onClick={async e => { e.stopPropagation(); await deleteDocumentRecord(user, entry.id); await refreshHistory(); }} title="Удалить">✕</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="home-tab-empty">Документов пока нет. Распознайте файл или загрузите .юрдок</div>
                  )}
                </div>
              )}
            </section>
          </>
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
            onRevealMatch={handleRevealPdFragmentMatch}
            canRevealMatch={getOriginalImageIndexForPage(originalImages, currentEditingPdFragment.coordinateMatch?.pageNumber) >= 0}
            previewPageImage={getOriginalImageForPage(viewerImages, currentEditingPdFragment.coordinateMatch?.pageNumber)}
            onApplyPreview={handleApplyPdFragmentPreview}
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

        {/* ════ ADD FROM HISTORY MODAL (project) ════ */}
        {showAddFromHistory && currentProject && (
          <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: 520 }}>
              <div className="modal-title">Перенести документ из истории в проект</div>
              <div className="modal-body" style={{ maxHeight: 400, overflowY: 'auto' }}>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
                  Документ будет перемещён в проект. Персональные данные будут объединены с базой ПД проекта.
                </div>
                {freeHistory.length === 0 ? (
                  <div style={{ color: 'var(--text3)' }}>Нет документов для переноса</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {freeHistory.map(entry => (
                      <div key={entry.id} className="history-card" style={{ cursor: 'pointer' }} onClick={() => handleAddDocFromHistory(entry.id)}>
                        <div className="history-card-icon">📄</div>
                        <div className="history-card-body">
                          <div className="history-card-title">{entry.title}</div>
                          <div className="history-card-meta">{formatDate(new Date(entry.savedAt))}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button className="btn-tool" onClick={() => setShowAddFromHistory(false)}>Закрыть</button>
              </div>
            </div>
          </div>
        )}

        {/* ════ PROJECT VIEW ════ */}
        {view === VIEW_PROJECT && currentProject && (
          <>
            {/* Project banner — visual indicator */}
            <div className="project-banner">
              <span className="project-banner-icon">📁</span>
              <span className="project-banner-label">Проект</span>
            </div>

            <section className="card api-card">
              <div className="provider-select-wrap">
                <label className="provider-label">Провайдер ИИ</label>
                <div className="provider-tabs">
                  {Object.entries(PROVIDERS).map(([key, p]) => (
                    <button
                      key={key}
                      className={'provider-tab' + (provider === key ? ' active' : '')}
                      onClick={() => { setProvider(key); setApiKey(''); }}
                      type="button"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="api-input-wrap" style={{ marginTop: 8 }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  className="api-input"
                  placeholder={PROVIDERS[provider].placeholder}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="api-toggle" onClick={() => setShowApiKey(v => !v)}>{showApiKey ? '🙈' : '👁'}</button>
              </div>
              <div className="api-hint">
                Ключ не сохраняется.{' '}
                {provider === 'claude' && <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">Получить ключ →</a>}
                {provider === 'openai' && <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">Получить ключ →</a>}
                {provider === 'gemini' && <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Получить ключ →</a>}
              </div>
            </section>

            <section className="card upload-card">
              <div
                className={`dropzone ${isDragging ? 'dragging' : ''}`}
                onDrop={e => { e.preventDefault(); setIsDragging(false); handleProjectFiles(e.dataTransfer.files); }}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => projectFileInputRef.current?.click()}
              >
                <input ref={projectFileInputRef} type="file" multiple accept=".pdf,application/pdf" className="visually-hidden" onChange={e => { handleProjectFiles(e.target.files); e.target.value = ''; }} />
                <div className="dropzone-icon">📄</div>
                <div className="dropzone-text"><strong>Перетащите PDF-файлы сюда</strong><br /><span>или нажмите для выбора</span></div>
                <div className="dropzone-hint">PDF · Большие файлы автоматически обрабатываются постранично.</div>
              </div>
              {files.length > 0 && (
                <div className="file-list">
                  {files.map((file, idx) => (
                    <div key={idx} className="file-item">
                      <span className="file-icon">📑</span>
                      <span className="file-name">{file.name}</span>
                      <span className="file-size">{(file.size / 1024 / 1024).toFixed(1)} МБ</span>
                      <button className="file-remove" onClick={e => { e.stopPropagation(); removeFile(idx); }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {currentBatchDisplayState && currentBatchDisplayState.status !== 'completed' && (
              <div className={`project-batch-status ${currentBatchDisplayState.status === 'failed' ? 'failed' : ''}`}>
                <div className="project-batch-status-title">
                  {getBatchStatusTitle(currentBatchDisplayState.status)}
                </div>
                <div className="project-batch-status-body">
                  <strong>{currentBatchDisplayState.fileName}</strong>
                  <span>Следующий запуск начнётся с {formatProjectChunkPageRange(currentBatchDisplayState.nextPage, getProjectPdfChunkEnd(currentBatchDisplayState.nextPage, currentBatchDisplayState.totalPages, currentBatchSession?.chunkSize || 1), currentBatchDisplayState.totalPages)}.</span>
                  {currentBatchDisplayState.message && <span>{currentBatchDisplayState.message}</span>}
                  <span>Для продолжения выберите тот же PDF-файл заново.</span>
                  {currentBatchDisplayState.error && <span>Последняя ошибка: {currentBatchDisplayState.error}</span>}
                </div>
                {Number.isFinite(currentBatchDisplayState.progressPercent) && (
                  <div className="project-batch-progress">
                    <div className="project-batch-progress-bar" style={{ width: `${Math.max(0, Math.min(100, Math.round(currentBatchDisplayState.progressPercent)))}%` }} />
                  </div>
                )}
                <div className="project-batch-actions">
                  {currentBatchDisplayState.status === 'running' && (
                    <button className="btn-tool" onClick={() => requestPauseActiveBatch(VIEW_PROJECT)}>
                      Пауза
                    </button>
                  )}
                  {currentBatchDisplayState.status === 'pausing' && (
                    <button className="btn-tool" type="button" disabled>
                      Пауза запрошена
                    </button>
                  )}
                  <button className="btn-tool" onClick={handleResetProjectBatchSession}>Сбросить незавершённую обработку</button>
                </div>
                {currentBatchDisplayState.status === 'pausing' && (
                  <div className="project-batch-pending-note">
                    Пауза будет поставлена сразу после завершения обработки текущей страницы.
                  </div>
                )}
              </div>
            )}

            {warningMessage && <div className="warning-block">⚠️ {warningMessage}</div>}
            {error && <div className="error-block">⚠️ {error}</div>}

            <div className="home-btn-wrap">
              <button
                className="btn-primary"
                onClick={handleProjectRecognize}
                disabled={!apiKey.trim() || files.length === 0}
              >
                {currentBatchSession && currentBatchSession.status !== 'completed'
                  ? '▶ Продолжить обработку PDF'
                  : '🔍 Распознать и обезличить'}
              </button>
            </div>

            {/* Project details card — name, extra actions, documents */}
            <section className="card home-bottom-card project-details-card">
              <div className="project-details-header">
                <input
                  className="project-title-input"
                  value={currentProject.title}
                  onChange={e => {
                    const nextTitle = e.target.value;
                    setProjects(prev => prev.map(item => (
                      item.id === currentProject.id
                        ? { ...item, title: nextTitle, updatedAt: new Date().toISOString() }
                        : item
                    )));
                    void saveProjectRecord(user, { ...currentProject, title: nextTitle });
                  }}
                  placeholder="Название проекта"
                  spellCheck={false}
                />
              </div>

              <div className="project-details-actions">
                {freeHistory.length > 0 && (
                  <button className="btn-tool" onClick={() => setShowAddFromHistory(true)}>📋 Перенести из истории</button>
                )}
                <button className="btn-tool" onClick={() => projectImportRef.current?.click()}>📂 Загрузить .юрдок</button>
                <input ref={projectImportRef} type="file" accept=".юрдок,.yurdok" className="visually-hidden" onChange={handleProjectImport} />
              </div>

              {getProjectDocs().length > 0 ? (
                <div className="project-docs">
                  <div className="card-label">Документы проекта ({getProjectDocs().length})</div>
                  <div className="project-docs-list">
                    {getProjectDocs().map((doc, idx) => (
                      <div key={doc.id} className="project-doc-item" onClick={() => openDocFromProject(doc)}>
                        <span className="project-doc-num">{idx + 1}</span>
                        <div className="project-doc-body">
                          <div className="project-doc-title">{doc.title}</div>
                          <div className="project-doc-meta">
                            {formatDate(new Date(doc.savedAt))}
                            {doc.pageFrom && doc.pageTo && (
                              <span className="project-doc-range">{formatDocumentPageProgress(doc)}</span>
                            )}
                            {(doc.personalData?.persons?.length || 0) > 0 && (
                              <span className="badge badge-private" style={{ marginLeft: 8 }}>{doc.personalData.persons.filter(p => p.category === 'private').length} лиц</span>
                            )}
                            {(doc.personalData?.persons?.filter(p => p.category === 'professional').length || 0) > 0 && (
                              <span className="badge badge-prof" style={{ marginLeft: 4 }}>{doc.personalData.persons.filter(p => p.category === 'professional').length} проф.</span>
                            )}
                            {(doc.personalData?.otherPD?.length || 0) > 0 && (
                              <span className="badge badge-anon" style={{ marginLeft: 4 }}>{doc.personalData.otherPD.length} др. ПД</span>
                            )}
                          </div>
                        </div>
                        <button className="project-doc-export" onClick={e => { e.stopPropagation(); exportDocument(doc); }} title="Скачать .юрдок">⬇</button>
                        <button className="project-doc-remove" onClick={e => { e.stopPropagation(); handleRemoveDocFromProject(doc.id); }} title="Убрать из проекта">✕</button>
                      </div>
                    ))}
                  </div>

                  {/* Build summary button */}
                  {getProjectDocs().length >= 2 && (
                    <div className="project-summary-actions">
                      <button className="btn-primary btn-sm" onClick={handleBuildSummary}>📋 Собрать итоговый документ</button>
                    </div>
                  )}

                  {/* Summary document */}
                  {getProjectSummaryDoc() && (
                    <div className="project-summary-section">
                      <div className="card-label">Итоговый документ</div>
                      <div className="project-doc-item project-summary-item" onClick={() => openDocFromProject(getProjectSummaryDoc())}>
                        <span className="project-summary-icon">📋</span>
                        <div className="project-doc-body">
                          <div className="project-doc-title">{getProjectSummaryDoc().title}</div>
                          <div className="project-doc-meta">
                            {formatDate(new Date(getProjectSummaryDoc().savedAt))}
                            <span className="badge badge-summary" style={{ marginLeft: 8 }}>итоговый</span>
                          </div>
                        </div>
                        <button className="project-doc-export" onClick={e => { e.stopPropagation(); exportDocument(getProjectSummaryDoc()); }} title="Скачать .юрдок">⬇</button>
                        <button className="project-doc-remove" onClick={e => handleDeleteSummary(e)} title="Удалить итоговый документ">✕</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="home-tab-empty">Загрузите PDF для распознавания, перенесите документ из истории или загрузите .юрдок</div>
              )}
            </section>
          </>
        )}

        {/* ════ PROCESSING ════ */}
        {view === VIEW_PROCESSING && progress && (
          <div className="progress-card">
            <div className="progress-msg">{progress.message}</div>
            <div className="progress-bar-wrap">
              <div className="progress-bar" style={{ width: `${Math.round(progress.percent || 0)}%` }} />
            </div>
            <div className="progress-pct">{Math.round(progress.percent || 0)}%</div>
            <div className="project-batch-actions" style={{ marginTop: 12 }}>
              {activeBatchUiState?.status === 'pausing' ? (
                <button className="btn-tool" type="button" disabled>
                  Пауза запрошена
                </button>
              ) : (
                <button className="btn-tool" onClick={() => requestPauseActiveBatch(VIEW_PROJECT)}>
                  Пауза
                </button>
              )}
            </div>
            {activeBatchUiState?.status === 'pausing' && (
              <div className="project-batch-pending-note" style={{ marginTop: 10 }}>
                Пауза будет поставлена сразу после завершения обработки текущей страницы.
              </div>
            )}
          </div>
        )}

        {/* ════ RESULT ════ */}
        {view === VIEW_RESULT && (
          <div className={"result-area" + (showOriginal && originalImages.length > 0 ? " viewer-open" : "")}>

            {hasPD && (
              <aside className="pd-panel" ref={setPdPanelRef} style={{ width: pdWidth, flexShrink: 0 }}>
                <div className="pd-panel-title">Персональные данные</div>
                <div className="pd-hint">Нажмите на метку в тексте или на строку ниже</div>

                {privatePersons.length > 0 && (
                  <div className="pd-group">
                    <div className="pd-group-header">
                      <span className="pd-dot private" /><span>Частные лица</span>
                      <button className="pd-group-btn" onClick={() => anonymizeAllByCategory('private')}>
                        {privatePersons.every(p => anonymized[p.id]) ? 'Показать всё' : 'Скрыть всё'}
                      </button>
                    </div>
                    {privatePersons.map(p => (
                      <div key={p.id} className={`pd-item ${anonymized[p.id] ? 'anon' : ''}${!pdInDoc(p.id) ? ' pd-absent' : ''}`} onClick={() => pdInDoc(p.id) ? handlePdClick(p.id) : null} onMouseEnter={() => pdInDoc(p.id) && initNavCounter(p.id)}>
                        <span className="pd-item-letter">{p.letter}</span>
                        <span className="pd-item-body">
                          <span className="pd-item-row1">
                            <span className="pd-item-name">{p.fullName}</span>
                            {pdInDoc(p.id) && (
                              <span className="pd-item-nav">
                                <button className="pd-nav-btn" title="Предыдущее упоминание" onClick={e => navigateToPd(p.id, 'up', e)}>↑</button>
                                <span className="pd-nav-counter">{pdNavState[p.id] ? `${pdNavState[p.id].cur === -1 ? pdNavState[p.id].total : `${pdNavState[p.id].cur + 1}/${pdNavState[p.id].total}`}` : ''}</span>
                                <button className="pd-nav-btn" title="Следующее упоминание" onClick={e => navigateToPd(p.id, 'down', e)}>↓</button>
                              </span>
                            )}
                            <button className="pd-item-edit" onClick={e => { e.stopPropagation(); openPdEditor(p.id); }} title="Редактировать запись ПД">Изм.</button>
                            <button className="pd-item-delete" onClick={e => { e.stopPropagation(); handleDeletePdEntry(p.id); }} title="Удалить запись ПД">✕</button>
                            <span className="pd-item-status">{anonymized[p.id] ? '🔒' : '👁'}</span>
                          </span>
                          {p.role && <span className="pd-item-role">{p.role}</span>}
                          {!pdInDoc(p.id) && <span className="pd-absent-label">нет в документе</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {profPersons.length > 0 && (
                  <div className="pd-group">
                    <div className="pd-group-header">
                      <span className="pd-dot professional" /><span>Проф. участники</span>
                      <button className="pd-group-btn" onClick={() => anonymizeAllByCategory('professional')}>
                        {profPersons.every(p => anonymized[p.id]) ? 'Показать всё' : 'Скрыть всё'}
                      </button>
                    </div>
                    {profPersons.map(p => (
                      <div key={p.id} className={`pd-item prof ${anonymized[p.id] ? 'anon' : ''}${!pdInDoc(p.id) ? ' pd-absent' : ''}`} onClick={() => pdInDoc(p.id) ? handlePdClick(p.id) : null} onMouseEnter={() => pdInDoc(p.id) && initNavCounter(p.id)}>
                        <span className="pd-item-letter prof-letter">{p.letter}</span>
                        <span className="pd-item-body">
                          <span className="pd-item-row1">
                            <span className="pd-item-name">{p.fullName}</span>
                            {pdInDoc(p.id) && (
                              <span className="pd-item-nav">
                                <button className="pd-nav-btn" title="Предыдущее упоминание" onClick={e => navigateToPd(p.id, 'up', e)}>↑</button>
                                <span className="pd-nav-counter">{pdNavState[p.id] ? `${pdNavState[p.id].cur === -1 ? pdNavState[p.id].total : `${pdNavState[p.id].cur + 1}/${pdNavState[p.id].total}`}` : ''}</span>
                                <button className="pd-nav-btn" title="Следующее упоминание" onClick={e => navigateToPd(p.id, 'down', e)}>↓</button>
                              </span>
                            )}
                            <button className="pd-item-edit" onClick={e => { e.stopPropagation(); openPdEditor(p.id); }} title="Редактировать запись ПД">Изм.</button>
                            <button className="pd-item-delete" onClick={e => { e.stopPropagation(); handleDeletePdEntry(p.id); }} title="Удалить запись ПД">✕</button>
                            <span className="pd-item-status">{anonymized[p.id] ? '🔒' : '👁'}</span>
                          </span>
                          {p.role && <span className="pd-item-role">{p.role}</span>}
                          {!pdInDoc(p.id) && <span className="pd-absent-label">нет в документе</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {Object.entries(pdTypeGroups).map(([type, items]) => (
                  <div key={type} className="pd-group">
                    <div className="pd-group-header">
                      <span className="pd-dot other" /><span>{pdTypeLabels[type] || type}</span>
                      <button className="pd-group-btn" onClick={() => anonymizeAllByCategory(type)}>
                        {items.every(p => anonymized[p.id]) ? 'Показать всё' : 'Скрыть всё'}
                      </button>
                    </div>
                    {items.map(item => (
                      <div key={item.id} className={`pd-item oth ${anonymized[item.id] ? 'anon' : ''}${!pdInDoc(item.id) ? ' pd-absent' : ''}`} onClick={() => pdInDoc(item.id) ? handlePdClick(item.id) : null} onMouseEnter={() => pdInDoc(item.id) && initNavCounter(item.id)}>
                        <span className="pd-item-body">
                          <span className="pd-item-row1">
                            <span className="pd-item-name">{item.value}</span>
                            {pdInDoc(item.id) && (
                              <span className="pd-item-nav">
                                <button className="pd-nav-btn" title="Предыдущее упоминание" onClick={e => navigateToPd(item.id, 'up', e)}>↑</button>
                                <span className="pd-nav-counter">{pdNavState[item.id] ? `${pdNavState[item.id].cur === -1 ? pdNavState[item.id].total : `${pdNavState[item.id].cur + 1}/${pdNavState[item.id].total}`}` : ''}</span>
                                <button className="pd-nav-btn" title="Следующее упоминание" onClick={e => navigateToPd(item.id, 'down', e)}>↓</button>
                              </span>
                            )}
                            <button className="pd-item-edit" onClick={e => { e.stopPropagation(); openPdEditor(item.id); }} title="Редактировать запись ПД">Изм.</button>
                            <button className="pd-item-delete" onClick={e => { e.stopPropagation(); handleDeletePdEntry(item.id); }} title="Удалить запись ПД">✕</button>
                            <span className="pd-item-status">{anonymized[item.id] ? '🔒' : '👁'}</span>
                          </span>
                          <span className="pd-item-role">→ {item.replacement}</span>
                          {!pdInDoc(item.id) && <span className="pd-absent-label">нет в документе</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}

                <div className="pd-legend">
                  <div className="pd-legend-item"><mark className="pd-mark pd-cat-private" style={{ cursor: 'default' }}>А</mark> — частное лицо</div>
                  <div className="pd-legend-item"><mark className="pd-mark pd-cat-professional" style={{ cursor: 'default', fontSize: '11px' }}>[ФИО 1]</mark> — проф. участник</div>
                  <div className="pd-legend-item"><mark className="pd-mark pd-cat-other" style={{ cursor: 'default' }}>ПД</mark> — другие перс. данные</div>
                  <div className="pd-legend-item"><span style={{ borderBottom: '2px dashed #2196f3', background: 'rgba(33, 150, 243, 0.10)', padding: '0 2px', fontSize: '12px', color: '#0d3b66' }}>имя</span> — неоднозначное упоминание лица</div>
                  <div className="pd-legend-item"><span style={{ borderBottom: '3px double #f57c00', paddingBottom: '1px', fontSize: '12px', color: '#4a3000' }}>текст</span> — неточное распознавание</div>
                </div>
              </aside>
            )}

            {hasPD && (
              <div className="panel-resizer" onMouseDown={startResize('pd')}><span className="panel-resizer-icon">‹<br/>›</span></div>
            )}

            <div className="doc-card">
              <div className="doc-title-row" ref={titleRowRef}>
                <input
                  className="doc-title-input"
                  value={docTitle}
                  onChange={e => setDocTitle(e.target.value)}
                  placeholder="Название документа"
                  spellCheck={false}
                />
                <DocumentTitleActions
                  hasOriginalImages={originalImages.length > 0}
                  showOriginal={showOriginal}
                  onToggleOriginal={handleToggleOriginalViewer}
                  onOriginalImagesLoaded={handleLoadOriginalViewerImages}
                  onSave={() => triggerExport('save')}
                  onExportDocx={() => triggerExport('docx')}
                  onExportPdf={() => triggerExport('pdf')}
                />
              </div>

              {showLongDocWarning && (
                <div className="long-doc-warning">
                  ⚠️ Для анализа персональных данных сейчас используется только первые {PD_ANALYSIS_CHAR_LIMIT.toLocaleString('ru-RU')} символов документа. Если текст длиннее, часть персональных данных после этого лимита могла быть пропущена. Рекомендуем разбить документ на части и загружать отдельно.
                  <button className="long-doc-close" onClick={() => setShowLongDocWarning(false)}>✕</button>
                </div>
              )}

              <DocumentPatchList
                activePatchEntries={activePatchEntries}
                canOpenPage={canOpenOriginalPatchPage}
                onOpenPage={handleOpenOriginalPageNumber}
                onRemovePatch={handleRemovePatchEntry}
                onClearAll={() => clearPatchedViewerPages({ clearPatchLayer: true })}
                formatPatchText={formatPatchEntryText}
              />

              <RichEditor
                html={editorHtml}
                onHtmlChange={handleEditorHtmlChange}
                onPdClick={handlePdClick}
                onRemovePdMark={handleRemovePdMark}
                onApplyPdCanonicalText={handleApplyPdCanonicalText}
                onEditPdMark={openPdEditor}
                onEditPdTextMark={openPdFragmentEditor}
                onAttachPdMark={handleAttachPdMark}
                onAddPdMark={handleAddPdMark}
                onRemoveAmbiguousMark={handleRemoveAmbiguousMark}
                onUncertainResolved={handleUncertainResolved}
                existingPD={personalData}
                editorRef={editorDomRef}
                highlightUncertain={highlightUncertain}
                pageNavigation={editorTotalPages > 1 ? {
                  currentPage: editorCurrentPage || 1,
                  totalPages: editorTotalPages,
                  inputValue: editorPageInput,
                  inputRef: editorPageInputRef,
                  onInputChange: (value) => setEditorPageInput(String(value || '').replace(/[^\d]/g, '')),
                  onSubmit: handleEditorPageSubmit,
                  onStepBack: () => handleEditorPageStep(-1),
                  onStepForward: () => handleEditorPageStep(1),
                } : null}
              />
            </div>


            {showOriginal && originalImages.length > 0 && (
              <OriginalViewerPanel
                images={viewerImages}
                currentPage={originalPage}
                setCurrentPage={setOriginalPage}
                zoomActive={zoomActive}
                setZoomActive={setZoomActive}
                zoomScale={zoomScale}
                setZoomScale={setZoomScale}
                width={viewerWidth}
                patchedViewerPageCount={patchedViewerPageCount}
                onResizeStart={startResize('viewer')}
                onClearPatches={() => clearPatchedViewerPages({ clearPatchLayer: true })}
                onClose={() => setShowOriginal(false)}
              />
            )}

          </div>
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

function PdRecordEditorModal({ pdItem, onClose, onSave }) {
  const isPerson = Object.prototype.hasOwnProperty.call(pdItem || {}, 'fullName');
  const [fullName, setFullName] = useState(pdItem?.fullName || '');
  const [role, setRole] = useState(pdItem?.role || '');
  const [value, setValue] = useState(pdItem?.value || '');

  const handleSave = () => {
    if (isPerson) {
      const nextFullName = normalizePdText(fullName);
      if (!nextFullName) return;
      onSave({
        id: pdItem.id,
        fullName: nextFullName,
        role,
      });
      return;
    }

    const nextValue = normalizePdText(value);
    if (!nextValue) return;
    onSave({
      id: pdItem.id,
      value: nextValue,
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-title">Редактирование ПД</div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {isPerson ? (
            <>
              <div>
                <label className="modal-label">ФИО</label>
                <input className="modal-input" value={fullName} onChange={e => setFullName(e.target.value)} />
              </div>
              <div>
                <label className="modal-label">Роль</label>
                <input className="modal-input" value={role} onChange={e => setRole(e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="modal-label">Основное значение</label>
                <input className="modal-input" value={value} onChange={e => setValue(e.target.value)} />
              </div>
            </>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-primary btn-sm" onClick={handleSave}>Сохранить</button>
          <button className="btn-tool" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
