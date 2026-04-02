import React, { useState, useRef, useCallback, useEffect } from 'react';
import { pdfToImages, imageFileToBase64 } from './utils/pdfUtils';
import { recognizeDocument, analyzePD, PROVIDERS } from './utils/claudeApi';
import { parseDocx } from './utils/docxParser';
import { RichEditor, buildAnnotatedHtml, patchPdMarks } from './components/RichEditor';
import { loadHistory, saveDocument, deleteDocument, generateId } from './utils/history';
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

function assignLetters(personalData) {
  let pi = 0, pf = 0;
  return {
    ...personalData,
    persons: (personalData.persons || []).map(p => ({
      ...p,
      letter: p.category === 'private'
        ? (ALPHA_PRIVATE[pi] !== undefined ? ALPHA_PRIVATE[pi++] : `Л-${++pi}`)
        : makeProfletter(++pf),
    })),
  };
}

const VIEW_HOME = 'home';
const VIEW_PROCESSING = 'processing';
const VIEW_RESULT = 'result';

export default function App() {
  const [view, setView] = useState(VIEW_HOME);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [provider, setProvider] = useState('claude');

  const [files, setFiles] = useState([]);
  const [originalImages, setOriginalImages] = useState([]); // for file viewer
  const [showOriginal, setShowOriginal] = useState(false);
  const [originalPage, setOriginalPage] = useState(0);
  const [zoomActive, setZoomActive] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [viewerTip, setViewerTip] = useState(null); // null или {x, y}
  const viewerBodyRef = useRef(null);
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const zoomActiveRef = useRef(false);
  const tipTimerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);


  const [progress, setProgress] = useState(null);
  const progressCreepRef = useRef(null);

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

  const [docId, setDocId] = useState(null);
  const [docTitle, setDocTitle] = useState('');
  const [originalFileName, setOriginalFileName] = useState('');
  const [rawText, setRawText] = useState('');
  // editorHtml is only used for initial load and save/export — NOT rebuilt on every anonymize
  const [editorHtml, setEditorHtml] = useState('');
  const [personalData, setPersonalData] = useState({ persons: [], otherPD: [] });
  // anonymized: { [id]: bool }
  const [anonymized, setAnonymized] = useState({});
  const [lastSavedState, setLastSavedState] = useState(null);

  const [history, setHistory] = useState([]);
  const [showUnsaved, setShowUnsaved] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [showUncertainWarning, setShowUncertainWarning] = useState(false);
  const [showLongDocWarning, setShowLongDocWarning] = useState(false);
  const [highlightUncertain, setHighlightUncertain] = useState(false);
  const [pendingExportAction, setPendingExportAction] = useState(null); // 'save'|'pdf'|'docx'
  const pendingNavRef = useRef(null);
  const fileInputRef = useRef();
  const viewerFileInputRef = useRef();
  const dragFileIdx = useRef(null);

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
  // Timer ref for deferred PD cleanup after editing
  const pdCleanupTimerRef = useRef(null);
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
      const { scrollTop, scrollHeight, clientHeight } = el;
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

    // Check if target is already visible — if so, flash immediately
    const rect = target.getBoundingClientRect();
    const alreadyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;

    if (alreadyVisible) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('pd-flash');
      setTimeout(() => target.classList.remove('pd-flash'), 700);
    } else {
      // Flash only after element enters viewport (scroll finished)
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const observer = new IntersectionObserver((entries, obs) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          obs.disconnect();
          target.classList.add('pd-flash');
          setTimeout(() => target.classList.remove('pd-flash'), 700);
        }
      }, { threshold: 0.5 }); // fire when at least half of mark is visible
      observer.observe(target);
      // Safety fallback: disconnect after 2s in case scroll never finishes
      setTimeout(() => observer.disconnect(), 2000);
    }
  }, []);

  // Keep --titlerow-h CSS variable in sync with actual title-row height
  // This fixes toolbar sticky top when title row wraps onto two lines
  useEffect(() => {
    const el = titleRowRef.current;
    if (!el) return;
    const update = () => {
      document.documentElement.style.setProperty('--titlerow-h', el.offsetHeight + 'px');
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel вешаем через callback-ref на viewer-body — срабатывает когда элемент реально появился
  const setViewerBodyRef = useCallback((el) => {
    if (viewerBodyRef.current) {
      viewerBodyRef.current.removeEventListener('wheel', viewerBodyRef._wheelHandler);
    }
    viewerBodyRef.current = el;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (zoomActiveRef.current) {
        setZoomScale(s => {
          const delta = e.deltaY > 0 ? -0.1 : 0.1;
          return Math.min(4, Math.max(0.5, +(s + delta).toFixed(2)));
        });
      } else {
        el.scrollTop += e.deltaY;
        el.scrollLeft += e.deltaX;
      }
    };
    viewerBodyRef._wheelHandler = handler;
    el.addEventListener('wheel', handler, { passive: false });
  }, []);

  useEffect(() => { setHistory(loadHistory()); }, []);

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
  const refreshHistory = () => setHistory(loadHistory());

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
    if (view === VIEW_RESULT && isDirty()) {
      setShowUnsaved(true);
      pendingNavRef.current = 'home';
    } else {
      doGoHome();
    }
  };

  const doGoHome = () => {
    setView(VIEW_HOME);
    setFiles([]);
    setOriginalImages([]);
    setShowOriginal(false);
    setOriginalPage(0);
    setZoomActive(false);
    setZoomScale(1);
    setZoomOffset({ x: 0, y: 0 });
    setOriginalFileName('');
    setError(null);
    setProgress(null);
    setShowUnsaved(false);
    refreshHistory();
  };

  const handleUnsavedSave = () => {
    handleSave();
    setShowUnsaved(false);
    if (pendingNavRef.current === 'home') doGoHome();
    pendingNavRef.current = null;
  };

  const handleUnsavedDiscard = () => {
    setShowUnsaved(false);
    if (pendingNavRef.current === 'home') doGoHome();
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
    if (files.length === 0) { setError('Добавьте хотя бы один файл'); return; }

    setError(null);
    setView(VIEW_PROCESSING);

    try {
      let result;
      const isDocx = files.length === 1 && files[0].name.toLowerCase().endsWith('.docx');

      if (isDocx) {
        // DOCX — читаем XML напрямую через JSZip, пропускаем OCR и quality check
        setProgress({ percent: 10, message: 'Чтение документа DOCX...' });
        const docxText = await parseDocx(files[0]);
        setProgress({ percent: 40, message: 'Анализ персональных данных...' });
        animateTo(90, null);
        const personalData = await analyzePD(docxText, apiKey.trim(), provider, p => {
          const pct = p.percent != null ? Math.round(p.percent) : 97;
          setProgress(prev => prev && prev.percent > pct
            ? { ...prev, message: p.message }
            : { percent: pct, message: p.message }
          );
        });
        stopProgressCreep();
        result = { text: docxText, personalData };
      } else {
        setProgress({ percent: 2, message: 'Подготовка файлов...' });
        const allImages = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file.type === 'application/pdf') {
            const pages = await pdfToImages(file, (page, total) => {
              setProgress({ percent: Math.round(5 + (i / files.length) * 20), message: `PDF: страница ${page} из ${total}...` });
            });
            allImages.push(...pages);
          } else {
            allImages.push(await imageFileToBase64(file));
          }
        }
        setOriginalImages(allImages);
        result = await recognizeDocument(allImages, apiKey.trim(), provider, p => {
          const pct = p.percent != null ? Math.round(p.percent) : (p.stage === 'done' ? 100 : 50);
          setProgress(prev => prev && prev.percent > pct
            ? { ...prev, message: p.message }
            : { percent: pct, message: p.message }
          );
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
      const title = files[0]?.name || `Документ от ${formatDate(new Date())}`;
      const origName = files[0]?.name || '';

      setDocId(generateId());
      setDocTitle(title);
      setOriginalFileName(origName);
      setRawText(result.text);
      setEditorHtml(html);
      setPersonalData(pd);
      setAnonymized(initialAnon);
      setLastSavedState(null);
      setShowLongDocWarning(result.text.length > 50000);

      stopProgressCreep();
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
    const pd = entry.personalData || { persons: [], otherPD: [] };
    const anon = entry.anonymized || {};
    const html = buildAnnotatedHtml(entry.text || '', pd, anon);

    setDocId(entry.id);
    setDocTitle(entry.title);
    setOriginalFileName(entry.originalFileName || entry.title || '');
    setRawText(entry.text || '');
    setEditorHtml(entry.editedHtml || html);
    setPersonalData(pd);
    setAnonymized(anon);
    setLastSavedState(JSON.stringify({ anonymized: JSON.stringify(anon), html: entry.editedHtml || html }));
    setView(VIEW_RESULT);
  };

  // ── Save ──────────────────────────────────────────────────────────────────────
  const countUncertain = () => {
    if (!editorDomRef.current) return 0;
    return editorDomRef.current.querySelectorAll('mark.uncertain').length;
  };

  const countPageSeparators = () => {
    if (!editorDomRef.current) return 0;
    return editorDomRef.current.querySelectorAll('.page-separator').length;
  };

  const triggerExport = (action) => {
    const uncertainCount = countUncertain();
    const separatorCount = countPageSeparators();
    if (uncertainCount > 0 || separatorCount > 0) {
      setPendingExportAction(action);
      setShowUncertainWarning(true);
      setHighlightUncertain(true);
      // Подсвечиваем разделители страниц анимацией
      if (editorDomRef.current) {
        editorDomRef.current.querySelectorAll('.page-separator').forEach(el => {
          el.classList.add('page-separator-highlight');
        });
      }
    } else {
      if (action === 'save') handleSave();
      else if (action === 'pdf') handleDownloadPdf();
      else if (action === 'docx') handleDownloadDocx();
    }
  };

  const handleUncertainProceed = () => {
    setShowUncertainWarning(false);
    setHighlightUncertain(false);
    // Убираем подсветку разделителей
    if (editorDomRef.current) {
      editorDomRef.current.querySelectorAll('.page-separator').forEach(el => {
        el.classList.remove('page-separator-highlight');
      });
    }
    if (pendingExportAction === 'save') handleSave();
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

  const handleSave = () => {
    const currentHtml = editorDomRef.current?.innerHTML || editorHtml;
    saveDocument({
      id: docId,
      title: docTitle,
      originalFileName,
      text: rawText,
      editedHtml: currentHtml,
      personalData,
      anonymized,
      source: files[0]?.name?.toLowerCase().endsWith('.docx') ? 'docx' : 'ocr',
    });
    setLastSavedState(JSON.stringify({ anonymized: JSON.stringify(anonymized), html: currentHtml }));
    refreshHistory();
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  };

  // ── Anonymize — KEY FIX: patch DOM directly, don't rebuild HTML ───────────────
  const handlePdClick = useCallback((id) => {
    setAnonymized(prev => {
      const next = { ...prev, [id]: !prev[id] };
      const isAnon = next[id];

      // Find what letter/replacement to use
      const person = personalData.persons?.find(p => p.id === id);
      const otherItem = personalData.otherPD?.find(it => it.id === id);
      const letter = person?.letter;
      const replacement = otherItem?.replacement;

      // Patch DOM without rebuilding — preserves all user edits
      patchPdMarks(editorDomRef.current, id, isAnon, letter, replacement);

      // Sync state for save/export
      if (editorDomRef.current) {
        setEditorHtml(editorDomRef.current.innerHTML);
      }

      return next;
    });
  }, [personalData]);

  const anonymizeAllByCategory = useCallback((category) => {
    setAnonymized(prev => {
      const { persons = [], otherPD = [] } = personalData;
      const newAnon = { ...prev };

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
        patchPdMarks(
          editorDomRef.current,
          item.id,
          targetState,
          person?.letter,
          otherItem?.replacement
        );
      });

      if (editorDomRef.current) {
        setEditorHtml(editorDomRef.current.innerHTML);
      }

      return newAnon;
    });
  }, [personalData]);

  // After editor renders with new html, store originals for de-anonymize
  const handleEditorHtmlChange = useCallback((html) => {
    setEditorHtml(html);

    // Deferred cleanup: remove PD entries whose <mark> tags are gone from the editor
    if (pdCleanupTimerRef.current) clearTimeout(pdCleanupTimerRef.current);
    pdCleanupTimerRef.current = setTimeout(() => {
      if (!editorDomRef.current) return;
      setPersonalData(prev => {
        const dom = editorDomRef.current;

        // Count marks per id
        const markCounts = {};
        dom.querySelectorAll("mark[data-pd-id]").forEach(el => {
          const id = el.dataset.pdId;
          markCounts[id] = (markCounts[id] || 0) + 1;
        });

        // Remove entries with 0 remaining marks in the editor
        const persons = prev.persons.filter(p => markCounts[p.id] > 0);
        const otherPD = prev.otherPD.filter(p => markCounts[p.id] > 0);

        if (persons.length === prev.persons.length && otherPD.length === prev.otherPD.length) {
          return prev; // nothing changed, skip re-render
        }
        return { ...prev, persons, otherPD };
      });
    }, 1000);
  }, []);

  // Called from RichEditor when user right-clicks a mark and picks "Не является ПД"
  const handleRemovePdMark = useCallback((id) => {
    setPersonalData(prev => {
      // Count remaining marks for this id in the editor DOM
      const remaining = editorDomRef.current
        ? editorDomRef.current.querySelectorAll(`mark[data-pd-id="${id}"]`).length
        : 0;
      if (remaining > 0) return prev; // other marks still exist, just leave state as-is
      // No marks left — remove entry from panel
      return {
        ...prev,
        persons: prev.persons.filter(p => p.id !== id),
        otherPD: prev.otherPD.filter(p => p.id !== id),
      };
    });
  }, []);

  // Called from RichEditor when user attaches selection to existing PD
  const handleAttachPdMark = useCallback((id, markEl) => {
    setPersonalData(prev => {
      const person = prev.persons.find(p => p.id === id);
      const other = prev.otherPD.find(p => p.id === id);
      if (markEl) {
        const cat = person
          ? (person.category === 'professional' ? 'prof' : 'priv')
          : 'oth';
        // Save original text before any possible replacement
        if (!markEl.dataset.original) {
          markEl.dataset.original = person?.fullName || other?.value || markEl.textContent;
        }
        markEl.className = `pd ${cat}`;
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
      return prev; // state unchanged, only DOM updated
    });
  }, [anonymized]);

  // Called from RichEditor when user adds a brand new PD entry
  const handleAddPdMark = useCallback((pdData, selectedText, markEl) => {
    setPersonalData(prev => {
      const newId = `manual_${Date.now()}`;
      let newPersons = prev.persons;
      let newOtherPD = prev.otherPD;

      if (pdData.category === 'private' || pdData.category === 'professional') {
        const privateCount = prev.persons.filter(p => p.category === 'private').length;
        const profCount = prev.persons.filter(p => p.category === 'professional').length;
        const letter = pdData.category === 'private'
          ? (ALPHA_PRIVATE[privateCount] !== undefined ? ALPHA_PRIVATE[privateCount] : `Л-${privateCount + 1}`)
          : `[ФИО ${profCount + 1}]`;
        const newPerson = {
          id: newId,
          fullName: pdData.fullName,
          role: pdData.role || '',
          category: pdData.category,
          letter,
          mentions: [pdData.fullName, selectedText].filter(Boolean),
        };
        newPersons = [...prev.persons, newPerson];
        if (markEl) {
          const cat = pdData.category === 'professional' ? 'prof' : 'priv';
          markEl.className = `pd ${cat}`;
          markEl.dataset.pdId = newId;
          // Keep data-original as the selected text (what was in the document),
          // NOT fullName — so show/hide restores what was actually written
          if (!markEl.dataset.original) markEl.dataset.original = selectedText;
        }
      } else {
        const typeLabel = OTHER_PD_TYPES_MAP[pdData.type] || pdData.type;
        const newOther = {
          id: newId,
          type: pdData.type,
          value: selectedText,
          replacement: `[${typeLabel}]`,
        };
        newOtherPD = [...prev.otherPD, newOther];
        if (markEl) {
          markEl.className = 'pd oth';
          markEl.dataset.pdId = newId;
          markEl.dataset.original = selectedText;
        }
      }

      return { ...prev, persons: newPersons, otherPD: newOtherPD };
    });
  }, [anonymized]);

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

    const handleDownloadPdf = () => {
    const content = (editorDomRef.current?.innerHTML || editorHtml)
      .replace(/<mark class="pd[^"]*"[^>]*>/g, '<span class="pd-export">')
      .replace(/<mark class="uncertain[^"]*"[^>]*>/g, '<span class="uncertain-export">')
      .replace(/<\/mark>/g, '</span>');

    const pdfTitle = 'ЮрДок_' + (docTitle || originalFileName || 'документ').replace(/\.pdf$/i, '').replace(/\.docx$/i, '').replace(/\.jpg$/i, '').replace(/\.png$/i, '').replace(/\.webp$/i, '');
    const printHtml = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"/><title>${pdfTitle}</title>
<style>
  @page { size: A4; margin: 20mm 25mm; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 14pt;
    line-height: 1.7;
    color: #000;
    margin: 0;
    width: 160mm;
  }
  h1 { font-size: 14pt; font-weight: 700; text-align: center; margin: 0; line-height: 1.7; }
  h2 { font-size: 14pt; font-weight: 600; text-align: center; margin: 0; line-height: 1.7; }
  h3 { font-size: 14pt; font-weight: 600; margin: 0; }
  div { min-height: 1.7em; margin: 0; padding: 0; text-align: justify; }
  p { text-indent: 1.5em; margin: 0; padding: 0; text-align: justify; }
  .right-block { margin-left: 55%; text-align: justify; min-height: 1.7em; }
  .page-separator { display: none; }
  .lr-row { display: flex; justify-content: space-between; align-items: baseline; text-align: left; }
  .lr-row span:last-child { text-align: right; }
  hr { border: none; border-top: 1px solid #ccc; margin: 6pt 0; }
  ol, ul { padding-left: 2em; }
  .pd-export { font-weight: bold; }
  .uncertain-export { text-decoration: underline dotted; }

</style></head>
<body>
${content}
</body></html>`;

    const w = window.open('', '_blank', 'width=850,height=950');
    if (!w) { alert('Разрешите всплывающие окна для скачивания PDF'); return; }
    w.document.write(printHtml);
    w.document.close();
    setTimeout(() => {
      w.print();
      // afterprint не срабатывает в Chrome при сохранении PDF
      // закрываем окно через 3 секунды — диалог к этому моменту уже открылся
      setTimeout(() => w.close(), 1000);
    }, 500);
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

  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div className="app">

      <header className="header">
        <div className="header-inner">
          <div className="header-left" />
          <div className="header-center">
            {view === VIEW_RESULT && (
              <button className="btn-tool header-home-btn" onClick={goHome}>← Главная</button>
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
          <div className="header-right" />
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
                <div style={{marginTop: countUncertain() > 0 ? 8 : 0}}>Найдено <strong>{countPageSeparators()}</strong> {countPageSeparators() === 1 ? 'разделитель страниц' : 'разделителей страниц'} — они выделены и не должны оставаться в финальном документе.</div>
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
                    <div className="dropzone-hint">JPG, PNG, WEBP, PDF, DOCX · Рекомендуем до 20–25 страниц</div>
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
                            // Убираем over-класс со всех элементов
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
            </section>

            {error && <div className="error-block">⚠️ {error}</div>}

            <div className="home-btn-wrap">
              <button
                className="btn-primary"
                onClick={handleRecognize}
                disabled={!apiKey.trim() || files.length === 0}
              >
                {files.length > 0 && files[0].name.toLowerCase().endsWith('.docx') ? '🔒 Обезличить документ' : '🔍 Распознать и обезличить'}
              </button>
            </div>

            {history.length > 0 && (
              <section className="history-section">
                <div className="history-header">
                  <div className="card-label" style={{ margin: 0 }}>История документов</div>
                </div>
                <div className="history-grid">
                  {history.map(entry => (
                    <div key={entry.id} className="history-card" onClick={() => loadDoc(entry)}>
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
                      <button className="history-delete" onClick={e => { e.stopPropagation(); deleteDocument(entry.id); refreshHistory(); }} title="Удалить">✕</button>
                    </div>
                  ))}
                </div>
              </section>
            )}
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
                      <div key={p.id} className={`pd-item ${anonymized[p.id] ? 'anon' : ''}`} onClick={() => handlePdClick(p.id)} onMouseEnter={() => initNavCounter(p.id)}>
                        <span className="pd-item-letter">{p.letter}</span>
                        <span className="pd-item-body">
                          <span className="pd-item-row1">
                            <span className="pd-item-name">{p.fullName}</span>
                            <span className="pd-item-nav">
                              <button className="pd-nav-btn" title="Предыдущее упоминание" onClick={e => navigateToPd(p.id, 'up', e)}>↑</button>
                              <span className="pd-nav-counter">{pdNavState[p.id] ? `${pdNavState[p.id].cur === -1 ? pdNavState[p.id].total : `${pdNavState[p.id].cur + 1}/${pdNavState[p.id].total}`}` : ''}</span>
                              <button className="pd-nav-btn" title="Следующее упоминание" onClick={e => navigateToPd(p.id, 'down', e)}>↓</button>
                            </span>
                            <span className="pd-item-status">{anonymized[p.id] ? '🔒' : '👁'}</span>
                          </span>
                          {p.role && <span className="pd-item-role">{p.role}</span>}
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
                      <div key={p.id} className={`pd-item prof ${anonymized[p.id] ? 'anon' : ''}`} onClick={() => handlePdClick(p.id)} onMouseEnter={() => initNavCounter(p.id)}>
                        <span className="pd-item-letter prof-letter">{p.letter}</span>
                        <span className="pd-item-body">
                          <span className="pd-item-row1">
                            <span className="pd-item-name">{p.fullName}</span>
                            <span className="pd-item-nav">
                              <button className="pd-nav-btn" title="Предыдущее упоминание" onClick={e => navigateToPd(p.id, 'up', e)}>↑</button>
                              <span className="pd-nav-counter">{pdNavState[p.id] ? `${pdNavState[p.id].cur === -1 ? pdNavState[p.id].total : `${pdNavState[p.id].cur + 1}/${pdNavState[p.id].total}`}` : ''}</span>
                              <button className="pd-nav-btn" title="Следующее упоминание" onClick={e => navigateToPd(p.id, 'down', e)}>↓</button>
                            </span>
                            <span className="pd-item-status">{anonymized[p.id] ? '🔒' : '👁'}</span>
                          </span>
                          {p.role && <span className="pd-item-role">{p.role}</span>}
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
                      <div key={item.id} className={`pd-item oth ${anonymized[item.id] ? 'anon' : ''}`} onClick={() => handlePdClick(item.id)} onMouseEnter={() => initNavCounter(item.id)}>
                        <span className="pd-item-body">
                          <span className="pd-item-row1">
                            <span className="pd-item-name">{item.value}</span>
                            <span className="pd-item-nav">
                              <button className="pd-nav-btn" title="Предыдущее упоминание" onClick={e => navigateToPd(item.id, 'up', e)}>↑</button>
                              <span className="pd-nav-counter">{pdNavState[item.id] ? `${pdNavState[item.id].cur === -1 ? pdNavState[item.id].total : `${pdNavState[item.id].cur + 1}/${pdNavState[item.id].total}`}` : ''}</span>
                              <button className="pd-nav-btn" title="Следующее упоминание" onClick={e => navigateToPd(item.id, 'down', e)}>↓</button>
                            </span>
                            <span className="pd-item-status">{anonymized[item.id] ? '🔒' : '👁'}</span>
                          </span>
                          <span className="pd-item-role">→ {item.replacement}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ))}

                <div className="pd-legend">
                  <div className="pd-legend-item"><mark className="pd-mark pd-cat-private" style={{ cursor: 'default' }}>А</mark> — частное лицо</div>
                  <div className="pd-legend-item"><mark className="pd-mark pd-cat-professional" style={{ cursor: 'default', fontSize: '11px' }}>[ФИО 1]</mark> — проф. участник</div>
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
                <div className="doc-title-actions">
                  {originalImages.length > 0 && (
                    <button
                      className={'btn-tool btn-original' + (showOriginal ? ' active' : '')}
                      onClick={() => { setShowOriginal(v => !v); setOriginalPage(0); }}
                    >👁 Оригинал</button>
                  )}
                  {originalImages.length === 0 && (
                    <button
                      className="btn-tool btn-original"
                      onClick={() => viewerFileInputRef.current?.click()}
                      title="Загрузите оригинал для просмотра рядом с текстом"
                    >👁 Загрузить оригинал</button>
                  )}
                  <input
                    ref={viewerFileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf"
                    className="visually-hidden"
                    onChange={async (e) => {
                      const newFiles = Array.from(e.target.files);
                      e.target.value = '';
                      if (!newFiles.length) return;
                      const allImages = [];
                      for (const file of newFiles) {
                        if (file.type === 'application/pdf') {
                          const { pdfToImages } = await import('./utils/pdfUtils');
                          const pages = await pdfToImages(file, () => {});
                          allImages.push(...pages);
                        } else {
                          const { imageFileToBase64 } = await import('./utils/pdfUtils');
                          allImages.push(await imageFileToBase64(file));
                        }
                      }
                      setOriginalImages(allImages);
                      setShowOriginal(true);
                      setOriginalPage(0);
                    }}
                  />
                  <button className="btn-tool btn-save" onClick={() => triggerExport('save')}>💾 Сохранить</button>
                  <button className="btn-tool" onClick={() => triggerExport('docx')}>⬇ DOCX</button>
                  <button className="btn-tool" onClick={() => triggerExport('pdf')}>⬇ PDF</button>
                </div>
              </div>

              {showLongDocWarning && (
                <div className="long-doc-warning">
                  ⚠️ Документ содержит более 50 000 символов (~30+ страниц) — часть персональных данных могла быть пропущена при анализе. Рекомендуем разбить документ на части и загружать отдельно.
                  <button className="long-doc-close" onClick={() => setShowLongDocWarning(false)}>✕</button>
                </div>
              )}

              <RichEditor
                html={editorHtml}
                onHtmlChange={handleEditorHtmlChange}
                onPdClick={handlePdClick}
                onRemovePdMark={handleRemovePdMark}
                onAttachPdMark={handleAttachPdMark}
                onAddPdMark={handleAddPdMark}
                existingPD={personalData}
                editorRef={editorDomRef}
                highlightUncertain={highlightUncertain}
              />
            </div>


            {showOriginal && originalImages.length > 0 && (
              <div className="panel-resizer" onMouseDown={startResize('viewer')}><span className="panel-resizer-icon">‹<br/>›</span></div>
            )}
            {showOriginal && originalImages.length > 0 && (
              <div className={"viewer-panel" + (zoomActive ? " viewer-zoom-mode" : "")} style={{ width: viewerWidth, flexShrink: 0 }}>
                <div className="viewer-header">
                  <span className="viewer-title">Оригинальный файл</span>
                  <div className="viewer-nav">
                    <button
                      className="viewer-nav-btn"
                      disabled={originalPage === 0}
                      onClick={() => { setOriginalPage(p => Math.max(0, p - 1)); setZoomScale(1); zoomActiveRef.current = false; setZoomActive(false); }}
                    >←</button>
                    <span className="viewer-page-info">{originalPage + 1} / {originalImages.length}</span>
                    <button
                      className="viewer-nav-btn"
                      disabled={originalPage === originalImages.length - 1}
                      onClick={() => { setOriginalPage(p => Math.min(originalImages.length - 1, p + 1)); setZoomScale(1); zoomActiveRef.current = false; setZoomActive(false); }}
                    >→</button>
                  </div>
                  <div className="viewer-zoom-controls">
                    <button className="viewer-nav-btn" onClick={() => setZoomScale(s => Math.max(0.5, +(s - 0.25).toFixed(2)))} title="Отдалить">−</button>
                    <span className="viewer-page-info" style={{minWidth: 40}}>{Math.round(zoomScale * 100)}%</span>
                    <button className="viewer-nav-btn" onClick={() => setZoomScale(s => Math.min(4, +(s + 0.25).toFixed(2)))} title="Приблизить">+</button>
                    <button className="viewer-nav-btn" onClick={() => { setZoomScale(1); zoomActiveRef.current = false; setZoomActive(false); }} title="Сбросить">↺</button>
                  </div>
                  <button className="viewer-close" onClick={() => { setShowOriginal(false); zoomActiveRef.current = false; setZoomActive(false); setZoomScale(1); }}>✕ Скрыть</button>
                </div>
                <div
                  ref={setViewerBodyRef}
                  className={"viewer-body" + (zoomActive ? " zoom-active" : "")}
                  onMouseUp={() => { dragRef.current.dragging = false; }}
                  onMouseLeave={() => {
                    dragRef.current.dragging = false;
                    setViewerTip(null);
                    if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
                  }}
                >
                  <img
                    src={'data:' + (originalImages[originalPage]?.mediaType || 'image/jpeg') + ';base64,' + originalImages[originalPage]?.base64}
                    alt={'Страница ' + (originalPage + 1)}
                    className="viewer-img"
                    style={{
                      transform: `scale(${zoomScale})`,
                      transformOrigin: 'top left',
                      cursor: zoomActive ? 'grab' : 'default',
                      userSelect: 'none',
                      transition: 'transform 0.15s ease',
                    }}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      dragRef.current = { dragging: false, startX: e.clientX, startY: e.clientY, scrollLeft: viewerBodyRef.current?.scrollLeft || 0, scrollTop: viewerBodyRef.current?.scrollTop || 0 };
                    }}
                    onMouseMove={(e) => {
                      // Tooltip — сбрасываем и перезапускаем таймер
                      setViewerTip(null);
                      if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
                      tipTimerRef.current = setTimeout(() => setViewerTip({ x: e.clientX, y: e.clientY }), 600);
                      // Drag — только в активном режиме с зажатой кнопкой
                      if (!zoomActive || e.buttons !== 1) return;
                      const d = dragRef.current;
                      if (!d.dragging && (Math.abs(e.clientX - d.startX) > 5 || Math.abs(e.clientY - d.startY) > 5)) {
                        d.dragging = true;
                      }
                      if (!d.dragging) return;
                      const el = viewerBodyRef.current;
                      el.scrollLeft = d.scrollLeft - (e.clientX - d.startX);
                      el.scrollTop  = d.scrollTop  - (e.clientY - d.startY);
                    }}
                    onDoubleClick={() => {
                      if (dragRef.current?.dragging) return;
                      const next = !zoomActive;
                      zoomActiveRef.current = next;
                      setZoomActive(next);
                    }}
                    onMouseLeave={() => {
                      setViewerTip(null);
                      if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
                    }}
                    draggable={false}
                  />
                  {viewerTip && (
                    <div className="viewer-tooltip" style={{
                      left: Math.min(viewerTip.x + 16, window.innerWidth - 276),
                      top: viewerTip.y + 16,
                    }}>
                      {zoomActive
                        ? <><span>🖱 Колесико — зум</span><span>✊ Зажать и тянуть — переместить</span><span>🔍 Двойной клик — выйти из зума</span></>
                        : <span>🔍 Двойной клик — включить зум и перетаскивание</span>}
                    </div>
                  )}
                </div>
              </div>
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
