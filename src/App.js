import React, { useState, useRef, useCallback, useEffect } from 'react';
import { pdfToImages, imageFileToBase64 } from './utils/pdfUtils';
import { recognizeDocument, analyzePastedText } from './utils/claudeApi';
import { RichEditor, buildAnnotatedHtml, htmlToPlainText, patchPdMarks, initPdMarkOriginals } from './components/RichEditor';
import { loadHistory, saveDocument, deleteDocument, generateId } from './utils/history';
import './App.css';

const ALPHA_PRIVATE = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩ'.split('').map(l => l + '.');
const makeProfletter = (n) => `[ФИО ${n}]`;

function assignLetters(personalData) {
  let pi = 0, pf = 0;
  return {
    ...personalData,
    persons: (personalData.persons || []).map(p => ({
      ...p,
      letter: p.category === 'private'
        ? (ALPHA_PRIVATE[pi++] || `Л${pi}`)
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

  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedText, setPastedText] = useState('');

  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const [docId, setDocId] = useState(null);
  const [docTitle, setDocTitle] = useState('');
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
  const pendingNavRef = useRef(null);
  const fileInputRef = useRef();

  // Direct ref to the editor DOM element — used for DOM patching
  const editorDomRef = useRef(null);

  useEffect(() => { setHistory(loadHistory()); }, []);
  const refreshHistory = () => setHistory(loadHistory());

  // ── Dirty check ──────────────────────────────────────────────────────────────
  const isDirty = () => {
    if (!lastSavedState) return !!editorDomRef.current?.innerHTML;
    return JSON.stringify(anonymized) !== lastSavedState;
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
    setPastedText('');
    setPasteMode(false);
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
    const valid = Array.from(newFiles).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (valid.length !== newFiles.length) setError('Поддерживаются только изображения (JPG, PNG, WEBP) и PDF');
    setFiles(prev => [...prev, ...valid]);
  }, []);

  const handleDrop = useCallback((e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }, [handleFiles]);
  const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx));

  // ── Recognize ─────────────────────────────────────────────────────────────────
  const handleRecognize = async () => {
    if (!apiKey.trim()) { setError('Введите API ключ Claude'); return; }
    if (!pasteMode && files.length === 0) { setError('Добавьте хотя бы один файл'); return; }
    if (pasteMode && !pastedText.trim()) { setError('Вставьте текст для обработки'); return; }

    setError(null);
    setView(VIEW_PROCESSING);

    try {
      let result;
      if (pasteMode) {
        setProgress({ percent: 10, message: 'Анализ текста...' });
        result = await analyzePastedText(pastedText, apiKey.trim(), p => {
          setProgress({ percent: p.stage === 'done' ? 100 : 60, message: p.message });
        });
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
        result = await recognizeDocument(allImages, apiKey.trim(), p => {
          if (p.stage === 'ocr') setProgress({ percent: 25 + Math.round((p.current / p.total) * 60), message: p.message });
          else if (p.stage === 'analysis') setProgress({ percent: 90, message: p.message });
          else setProgress({ percent: 100, message: 'Готово!' });
        });
      }

      const pd = assignLetters(result.personalData);
      const initialAnon = {};
      const html = buildAnnotatedHtml(result.text, pd, initialAnon);
      const title = pasteMode
        ? `Текст от ${formatDate(new Date())}`
        : (files[0]?.name || `Документ от ${formatDate(new Date())}`);

      setDocId(generateId());
      setDocTitle(title);
      setRawText(result.text);
      setEditorHtml(html);
      setPersonalData(pd);
      setAnonymized(initialAnon);
      setLastSavedState(null);

      setTimeout(() => { setView(VIEW_RESULT); setProgress(null); }, 400);
    } catch (err) {
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
    setRawText(entry.text || '');
    setEditorHtml(entry.editedHtml || html);
    setPersonalData(pd);
    setAnonymized(anon);
    setLastSavedState(JSON.stringify(anon));
    setView(VIEW_RESULT);
  };

  // ── Save ──────────────────────────────────────────────────────────────────────
  const handleSave = () => {
    const currentHtml = editorDomRef.current?.innerHTML || editorHtml;
    saveDocument({
      id: docId,
      title: docTitle,
      text: rawText,
      editedHtml: currentHtml,
      personalData,
      anonymized,
      source: pasteMode ? 'paste' : 'ocr',
    });
    setLastSavedState(JSON.stringify(anonymized));
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
  }, []);

  // ── Export ────────────────────────────────────────────────────────────────────
  const getExportText = () => {
    const html = editorDomRef.current?.innerHTML || editorHtml;
    return htmlToPlainText(html);
  };


  // Generate and download .docx using docx library loaded from CDN
  const handleDownloadDocx = async () => {
    // Load docx library dynamically from CDN if not already loaded
    if (!window.docx) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/docx/8.5.0/docx.umd.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    const { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Packer } = window.docx;

    const html = editorDomRef.current?.innerHTML || editorHtml;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    const paragraphs = [];
    const nodes = tmp.childNodes;

    const getAlignment = (el) => {
      const style = el.style?.textAlign || '';
      if (style === 'center' || el.tagName === 'H1' || el.tagName === 'H2') return AlignmentType.CENTER;
      if (style === 'right') return AlignmentType.RIGHT;
      if (style === 'justify') return AlignmentType.JUSTIFIED;
      return AlignmentType.JUSTIFIED;
    };

    const nodeToRuns = (el) => {
      const runs = [];
      const walk = (node) => {
        if (node.nodeType === 3) {
          if (node.textContent) runs.push(new TextRun({ text: node.textContent }));
        } else if (node.nodeType === 1) {
          const tag = node.tagName?.toUpperCase();
          const isBold = tag === 'STRONG' || tag === 'B';
          const isItalic = tag === 'EM' || tag === 'I';
          const isUnder = tag === 'U';
          const isMark = tag === 'MARK';
          for (const child of node.childNodes) {
            if (child.nodeType === 3 && child.textContent) {
              runs.push(new TextRun({
                text: child.textContent,
                bold: isBold,
                italics: isItalic,
                underline: isUnder ? {} : undefined,
              }));
            } else {
              walk(child);
            }
          }
        }
      };
      walk(el);
      return runs.length ? runs : [new TextRun({ text: '' })];
    };

    for (const node of nodes) {
      if (node.nodeType !== 1) continue;
      const tag = node.tagName?.toUpperCase();
      if (tag === 'HR') {
        paragraphs.push(new Paragraph({ text: '─'.repeat(40), alignment: AlignmentType.CENTER }));
        continue;
      }
      if (tag === 'H1') {
        paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: nodeToRuns(node) }));
        continue;
      }
      if (tag === 'H2') {
        paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER, children: nodeToRuns(node) }));
        continue;
      }
      if (tag === 'H3') {
        paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: nodeToRuns(node) }));
        continue;
      }
      const text = node.innerText || '';
      if (!text.trim() && !node.innerHTML.includes('<br')) {
        paragraphs.push(new Paragraph({ text: '' }));
        continue;
      }
      paragraphs.push(new Paragraph({
        alignment: getAlignment(node),
        children: nodeToRuns(node),
        spacing: { after: 0, before: 0 },
      }));
    }

    const doc = new Document({
      sections: [{
        properties: {
          page: { margin: { top: 1134, bottom: 1134, left: 1418, right: 1418 } }, // 20mm top/bottom, 25mm left/right
        },
        children: paragraphs,
      }],
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (docTitle || 'документ').replace(/\.pdf$/, '') + '.docx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = () => {
    const content = (editorDomRef.current?.innerHTML || editorHtml)
      .replace(/<mark class="pd[^"]*"[^>]*>/g, '<span class="pd-export">')
      .replace(/<mark class="uncertain[^"]*"[^>]*>/g, '<span class="uncertain-export">')
      .replace(/<\/mark>/g, '</span>');

    const printHtml = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"/><title>${docTitle}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Literata:ital,wght@0,300;0,400;0,600;1,400&display=swap" rel="stylesheet"/>
<style>
  /* A4: 210mm wide, margins 25mm each side → text = 160mm */
  @page { size: A4; margin: 20mm 25mm; }
  body {
    font-family: 'Literata', Georgia, serif;
    font-size: 11.25pt; /* 15px at 96dpi = 11.25pt */
    line-height: 1.7;
    color: #000;
    margin: 0;
    /* Exactly 160mm wide = same as editor 605px at 96dpi */
    width: 160mm;
  }
  h1 { font-size: 13.5pt; font-weight: 700; text-align: center; margin: 0; line-height: 1.7; }
  h2 { font-size: 12pt; font-weight: 600; text-align: center; margin: 0; line-height: 1.7; }
  h3 { font-size: 11.25pt; font-weight: 600; margin: 0; }
  div { min-height: 1.7em; margin: 0; padding: 0; }
  p { text-indent: 1.5em; margin: 0; padding: 0; }
  hr { border: none; border-top: 1px solid #ccc; margin: 6pt 0; }
  ol, ul { padding-left: 2em; }
  .pd-export { font-weight: bold; }
  .uncertain-export { text-decoration: underline dotted; }
</style></head>
<body>${content}</body></html>`;

    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { alert('Разрешите всплывающие окна для скачивания PDF'); return; }
    w.document.write(printHtml);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  // ── Derived ───────────────────────────────────────────────────────────────────
  const privatePersons = personalData.persons?.filter(p => p.category === 'private') || [];
  const profPersons = personalData.persons?.filter(p => p.category === 'professional') || [];
  const otherPD = personalData.otherPD || [];
  const pdTypeGroups = otherPD.reduce((acc, it) => { (acc[it.type] = acc[it.type] || []).push(it); return acc; }, {});
  const pdTypeLabels = { address: 'Адреса', phone: 'Телефоны', passport: 'Паспортные данные', inn: 'ИНН', snils: 'СНИЛС', card: 'Карты/счета', email: 'Email', dob: 'Даты рождения', other: 'Прочее' };
  const hasPD = privatePersons.length > 0 || profPersons.length > 0 || otherPD.length > 0;

  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div className="app">

      <header className="header">
        <div className="header-inner">
          <div className="logo" onClick={view !== VIEW_HOME ? goHome : undefined} style={view !== VIEW_HOME ? { cursor: 'pointer' } : {}}>
            <span className="logo-icon">⚖</span>
            <div>
              <div className="logo-title">ЮрДок</div>
              <div className="logo-sub">Распознавание документов</div>
            </div>
          </div>
          <div className="header-right">
            {view === VIEW_RESULT && <button className="btn-tool" onClick={goHome}>← Главная</button>}
            <div className="header-badge">Данные в браузере</div>
          </div>
        </div>
      </header>

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

      <main className="main">

        {/* ════ HOME ════ */}
        {view === VIEW_HOME && (
          <>
            <section className="card api-card">
              <div className="card-label">API ключ Claude</div>
              <div className="api-input-wrap">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  className="api-input"
                  placeholder="sk-ant-..."
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="api-toggle" onClick={() => setShowApiKey(v => !v)}>{showApiKey ? '🙈' : '👁'}</button>
              </div>
              <div className="api-hint">
                Ключ не сохраняется.{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">Получить ключ →</a>
              </div>
            </section>

            <section className="card upload-card">
              <div className="mode-tabs">
                <button className={`mode-tab ${!pasteMode ? 'active' : ''}`} onClick={() => { setPasteMode(false); setError(null); }}>📄 Загрузить файл</button>
                <button className={`mode-tab ${pasteMode ? 'active' : ''}`} onClick={() => { setPasteMode(true); setError(null); }}>📋 Вставить текст</button>
              </div>

              {!pasteMode ? (
                <>
                  <div
                    className={`dropzone ${isDragging ? 'dragging' : ''}`}
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf" className="visually-hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
                    <div className="dropzone-icon">📄</div>
                    <div className="dropzone-text"><strong>Перетащите файлы сюда</strong><br /><span>или нажмите для выбора</span></div>
                    <div className="dropzone-hint">JPG, PNG, WEBP, PDF — любой размер</div>
                  </div>
                  {files.length > 0 && (
                    <div className="file-list">
                      {files.map((file, idx) => (
                        <div key={idx} className="file-item">
                          <span className="file-icon">{file.type === 'application/pdf' ? '📑' : '🖼'}</span>
                          <span className="file-name">{file.name}</span>
                          <span className="file-size">{(file.size / 1024 / 1024).toFixed(1)} МБ</span>
                          <button className="file-remove" onClick={e => { e.stopPropagation(); removeFile(idx); }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="paste-area">
                  <div className="card-label" style={{ marginBottom: 8 }}>Вставьте готовый текст документа</div>
                  <textarea className="paste-textarea" placeholder="Вставьте текст для анализа и обезличивания..." value={pastedText} onChange={e => setPastedText(e.target.value)} rows={10} />
                  <div className="paste-hint">Персональные данные будут найдены и выделены автоматически</div>
                </div>
              )}
            </section>

            {error && <div className="error-block">⚠️ {error}</div>}

            <button
              className="btn-primary"
              onClick={handleRecognize}
              disabled={!apiKey.trim() || (!pasteMode && files.length === 0) || (pasteMode && !pastedText.trim())}
            >
              {pasteMode ? 'Анализировать текст' : 'Распознать документ'}
            </button>

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
              <div className="progress-bar" style={{ width: `${progress.percent || 0}%` }} />
            </div>
            <div className="progress-pct">{progress.percent || 0}%</div>
          </div>
        )}

        {/* ════ RESULT ════ */}
        {view === VIEW_RESULT && (
          <div className="result-area">

            {hasPD && (
              <aside className="pd-panel">
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
                      <div key={p.id} className={`pd-item ${anonymized[p.id] ? 'anon' : ''}`} onClick={() => handlePdClick(p.id)}>
                        <span className="pd-item-letter">{p.letter}</span>
                        <span className="pd-item-name">{p.fullName}</span>
                        <span className="pd-item-role">{p.role}</span>
                        <span className="pd-item-status">{anonymized[p.id] ? '🔒' : '👁'}</span>
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
                      <div key={p.id} className={`pd-item prof ${anonymized[p.id] ? 'anon' : ''}`} onClick={() => handlePdClick(p.id)}>
                        <span className="pd-item-letter prof-letter">{p.letter}</span>
                        <span className="pd-item-name">{p.fullName}</span>
                        <span className="pd-item-role">{p.role}</span>
                        <span className="pd-item-status">{anonymized[p.id] ? '🔒' : '👁'}</span>
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
                      <div key={item.id} className={`pd-item ${anonymized[item.id] ? 'anon' : ''}`} onClick={() => handlePdClick(item.id)}>
                        <span className="pd-item-name">{item.value}</span>
                        <span className="pd-item-role">→ {item.replacement}</span>
                        <span className="pd-item-status">{anonymized[item.id] ? '🔒' : '👁'}</span>
                      </div>
                    ))}
                  </div>
                ))}

                <div className="pd-legend">
                  <div className="pd-legend-item"><mark className="pd-mark pd-cat-private" style={{ cursor: 'default' }}>А</mark> — частное лицо</div>
                  <div className="pd-legend-item"><mark className="pd-mark pd-cat-professional" style={{ cursor: 'default', fontSize: '11px' }}>[ФИО 1]</mark> — проф. участник</div>
                  <div className="pd-legend-item"><span style={{ borderBottom: '2px dashed #f0c040', paddingBottom: '1px', fontSize: '12px' }}>текст</span> — неточное распознавание</div>
                </div>
              </aside>
            )}

            <div className="doc-card">
              <div className="doc-title-row">
                <input
                  className="doc-title-input"
                  value={docTitle}
                  onChange={e => setDocTitle(e.target.value)}
                  placeholder="Название документа"
                  spellCheck={false}
                />
                <div className="doc-title-actions">
                  <button className="btn-tool btn-save" onClick={handleSave}>💾 Сохранить</button>
                  <button className="btn-tool" onClick={handleDownloadDocx}>⬇ DOCX</button>
                  <button className="btn-tool" onClick={handleDownloadPdf}>⬇ PDF</button>
                </div>
              </div>

              <RichEditor
                html={editorHtml}
                onHtmlChange={handleEditorHtmlChange}
                onPdClick={handlePdClick}
                editorRef={editorDomRef}
              />
            </div>

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
