import React, { useState, useRef, useCallback, useEffect } from 'react';
import { pdfToImages, imageFileToBase64 } from './utils/pdfUtils';
import { recognizeDocument, analyzePastedText } from './utils/claudeApi';
import { DocumentRenderer } from './components/DocumentRenderer';
import { RichEditor, markdownToHtml, htmlToPlainText } from './components/RichEditor';
import { loadHistory, saveDocument, deleteDocument, generateId } from './utils/history';
import './App.css';

// Private persons: А, Б, В, Г...
const ALPHA_PRIVATE = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩ'.split('');
// Professional persons: [ФИО 1], [ФИО 2]...
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

// ─── VIEW CONSTANTS ───────────────────────────────────────────────────────────
const VIEW_HOME = 'home';
const VIEW_PROCESSING = 'processing';
const VIEW_RESULT = 'result';

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState(VIEW_HOME);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // Upload mode
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);

  // Paste mode
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedText, setPastedText] = useState('');

  // Processing
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  // Current document
  const [docId, setDocId] = useState(null);
  const [docTitle, setDocTitle] = useState('');
  const [rawText, setRawText] = useState('');           // original OCR text
  const [editedHtml, setEditedHtml] = useState('');     // editor HTML (may include pd marks)
  const [personalData, setPersonalData] = useState({ persons: [], otherPD: [] });
  const [anonymized, setAnonymized] = useState({});
  const [editMode, setEditMode] = useState(false);
  const [lastSavedState, setLastSavedState] = useState(null); // JSON snapshot for dirty check

  // History
  const [history, setHistory] = useState([]);
  const [copied, setCopied] = useState(false);
  const [showUnsaved, setShowUnsaved] = useState(false);
  const pendingNavRef = useRef(null);

  const fileInputRef = useRef();

  // Load history on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const refreshHistory = () => setHistory(loadHistory());

  // ── Dirty check ────────────────────────────────────────────────────────────
  const currentStateSnapshot = () => JSON.stringify({ editedHtml, anonymized });

  const isDirty = () => {
    if (!lastSavedState) return true;
    return currentStateSnapshot() !== lastSavedState;
  };

  // ── Navigation ─────────────────────────────────────────────────────────────
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

  // ── File handling ──────────────────────────────────────────────────────────
  const handleFiles = useCallback((newFiles) => {
    const valid = Array.from(newFiles).filter(
      f => f.type.startsWith('image/') || f.type === 'application/pdf'
    );
    if (valid.length !== newFiles.length) {
      setError('Поддерживаются только изображения (JPG, PNG, WEBP) и файлы PDF');
    }
    setFiles(prev => [...prev, ...valid]);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx));

  // ── Recognize ──────────────────────────────────────────────────────────────
  const handleRecognize = async () => {
    if (!apiKey.trim()) { setError('Введите API ключ Claude'); return; }
    if (!pasteMode && files.length === 0) { setError('Добавьте хотя бы один файл'); return; }
    if (pasteMode && !pastedText.trim()) { setError('Вставьте текст для обработки'); return; }

    setError(null);
    setView(VIEW_PROCESSING);

    try {
      let result;

      if (pasteMode) {
        setProgress({ percent: 10, message: 'Анализ вставленного текста...' });
        result = await analyzePastedText(pastedText, apiKey.trim(), (prog) => {
          setProgress({ percent: prog.stage === 'done' ? 100 : 60, message: prog.message });
        });
      } else {
        // Prepare images
        setProgress({ percent: 2, message: 'Подготовка файлов...' });
        const allImages = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file.type === 'application/pdf') {
            const pages = await pdfToImages(file, (page, total) => {
              setProgress({
                percent: Math.round(5 + (i / files.length) * 20),
                message: `PDF "${file.name}": страница ${page} из ${total}...`,
              });
            });
            allImages.push(...pages);
          } else {
            allImages.push(await imageFileToBase64(file));
            setProgress({ percent: Math.round(5 + (i / files.length) * 20), message: `Загрузка: ${file.name}...` });
          }
        }

        result = await recognizeDocument(allImages, apiKey.trim(), (prog) => {
          if (prog.stage === 'ocr') {
            setProgress({ percent: 25 + Math.round((prog.current / prog.total) * 60), message: prog.message });
          } else if (prog.stage === 'analysis') {
            setProgress({ percent: 90, message: prog.message });
          } else {
            setProgress({ percent: 100, message: 'Готово!' });
          }
        });
      }

      const pd = assignLetters(result.personalData);
      const html = markdownToHtml(result.text);
      const id = generateId();
      const title = pasteMode
        ? `Текст от ${formatDate(new Date())}`
        : (files[0]?.name || `Документ от ${formatDate(new Date())}`);

      setDocId(id);
      setDocTitle(title);
      setRawText(result.text);
      setEditedHtml(html);
      setPersonalData(pd);
      setAnonymized({});
      setEditMode(false);

      setTimeout(() => {
        setView(VIEW_RESULT);
        setProgress(null);
      }, 600);

    } catch (err) {
      setError(err.message || 'Произошла ошибка');
      setView(VIEW_HOME);
      setProgress(null);
    }
  };

  // ── Load from history ──────────────────────────────────────────────────────
  const loadDoc = (entry) => {
    setDocId(entry.id);
    setDocTitle(entry.title);
    setRawText(entry.text || '');
    setEditedHtml(entry.editedHtml || markdownToHtml(entry.text || ''));
    setPersonalData(entry.personalData || { persons: [], otherPD: [] });
    setAnonymized(entry.anonymized || {});
    setEditMode(false);
    const snap = JSON.stringify({ editedHtml: entry.editedHtml || '', anonymized: entry.anonymized || {} });
    setLastSavedState(snap);
    setView(VIEW_RESULT);
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = () => {
    const entry = saveDocument({
      id: docId,
      title: docTitle,
      text: rawText,
      editedHtml,
      personalData,
      anonymized,
      source: pasteMode ? 'paste' : 'ocr',
    });
    setLastSavedState(currentStateSnapshot());
    refreshHistory();
    return entry;
  };

  // ── Anonymize ──────────────────────────────────────────────────────────────
  const handleAnonymize = (id) => {
    setAnonymized(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const anonymizeAllByCategory = (category) => {
    const newAnon = { ...anonymized };
    const { persons = [], otherPD = [] } = personalData;
    if (category === 'private' || category === 'professional') {
      const items = persons.filter(p => p.category === category);
      const allAnon = items.every(p => newAnon[p.id]);
      items.forEach(p => { newAnon[p.id] = !allAnon; });
    } else {
      const items = otherPD.filter(p => p.type === category);
      const allAnon = items.every(p => newAnon[p.id]);
      items.forEach(p => { newAnon[p.id] = !allAnon; });
    }
    setAnonymized(newAnon);
  };

  // ── Export ─────────────────────────────────────────────────────────────────
  const getExportText = () => {
    let text = editMode ? htmlToPlainText(editedHtml) : rawText;
    text = text.replace(/⚠️\[НЕТОЧНО: ([^\]]*)\]/g, '$1').replace(/⚠️\[НЕЧИТАЕМО\]/g, '[НЕЧИТАЕМО]');
    const { persons = [], otherPD = [] } = personalData;
    for (const p of persons) {
      if (!anonymized[p.id]) continue;
      for (const m of (p.mentions || [p.fullName])) {
        if (m) text = text.split(m).join(p.letter);
      }
    }
    for (const it of otherPD) {
      if (anonymized[it.id]) text = text.split(it.value).join(it.replacement);
    }
    text = text.replace(/^## /gm, '').replace(/^### /gm, '').replace(/\*\*([^*]+)\*\*/g, '$1');
    return text;
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(getExportText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPdf = () => {
    const text = getExportText();
    const lines = text.split('\n').map(line => {
      if (!line.trim()) return '<div style="height:.5em"></div>';
      if (line.startsWith('## ')) return `<h2 style="text-align:center;font-size:16pt;margin:18pt 0 6pt">${esc(line.slice(3))}</h2>`;
      if (line.startsWith('### ')) return `<h3 style="font-size:13pt;margin:12pt 0 4pt">${esc(line.slice(4))}</h3>`;
      if (line === '---') return '<hr style="border:none;border-top:1px solid #ccc;margin:12pt 0"/>';
      return `<p style="margin:0;text-indent:1.5em;line-height:1.8">${esc(line).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>`;
    }).join('\n');
    const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>${esc(docTitle)}</title><style>@page{margin:20mm 25mm}body{font-family:'Times New Roman',serif;font-size:12pt;color:#000}</style></head><body>${lines}</body></html>`;
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { alert('Разрешите всплывающие окна для скачивания PDF'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ── Render helpers ─────────────────────────────────────────────────────────
  const isProcessing = view === VIEW_PROCESSING;
  const privatePersons = personalData.persons?.filter(p => p.category === 'private') || [];
  const profPersons = personalData.persons?.filter(p => p.category === 'professional') || [];
  const otherPD = personalData.otherPD || [];
  const pdTypeGroups = otherPD.reduce((acc, it) => { (acc[it.type] = acc[it.type] || []).push(it); return acc; }, {});
  const pdTypeLabels = { address: 'Адреса', phone: 'Телефоны', passport: 'Паспортные данные', inn: 'ИНН', snils: 'СНИЛС', card: 'Карты/счета', email: 'Email', dob: 'Даты рождения', other: 'Прочее' };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="app">
      {/* ── HEADER ── */}
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
            {view === VIEW_RESULT && (
              <button className="btn-tool" onClick={goHome}>← Главная</button>
            )}
            <div className="header-badge">Данные в браузере</div>
          </div>
        </div>
      </header>

      {/* ── UNSAVED MODAL ── */}
      {showUnsaved && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-title">Несохранённые изменения</div>
            <div className="modal-body">Документ «{docTitle}» был изменён. Сохранить текущую версию?</div>
            <div className="modal-actions">
              <button className="btn-primary btn-sm" onClick={handleUnsavedSave}>Сохранить</button>
              <button className="btn-tool" onClick={handleUnsavedDiscard}>Не сохранять</button>
              <button className="btn-tool" onClick={() => setShowUnsaved(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      <main className="main">

        {/* ════════════════════════════════════════
            HOME VIEW
        ════════════════════════════════════════ */}
        {view === VIEW_HOME && (
          <>
            {/* API Key */}
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
                <button className="api-toggle" onClick={() => setShowApiKey(v => !v)}>
                  {showApiKey ? '🙈' : '👁'}
                </button>
              </div>
              <div className="api-hint">
                Ключ не сохраняется.{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">Получить ключ →</a>
              </div>
            </section>

            {/* Mode tabs */}
            <section className="card upload-card">
              <div className="mode-tabs">
                <button
                  className={`mode-tab ${!pasteMode ? 'active' : ''}`}
                  onClick={() => { setPasteMode(false); setError(null); }}
                >📄 Загрузить файл</button>
                <button
                  className={`mode-tab ${pasteMode ? 'active' : ''}`}
                  onClick={() => { setPasteMode(true); setError(null); }}
                >📋 Вставить текст</button>
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
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf"
                      className="visually-hidden"
                      onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
                    />
                    <div className="dropzone-icon">📄</div>
                    <div className="dropzone-text">
                      <strong>Перетащите файлы сюда</strong><br />
                      <span>или нажмите для выбора</span>
                    </div>
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
                  <textarea
                    className="paste-textarea"
                    placeholder="Вставьте сюда текст документа для анализа и обезличивания персональных данных..."
                    value={pastedText}
                    onChange={e => setPastedText(e.target.value)}
                    rows={10}
                  />
                  <div className="paste-hint">Текст будет проанализирован — персональные данные будут выделены для обезличивания</div>
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

            {/* History */}
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
                          {entry.personalData?.persons?.filter(p => p.category === 'private').length > 0 && (
                            <span className="badge badge-private">
                              {entry.personalData.persons.filter(p => p.category === 'private').length} лиц
                            </span>
                          )}
                          {entry.personalData?.persons?.filter(p => p.category === 'professional').length > 0 && (
                            <span className="badge badge-prof">
                              {entry.personalData.persons.filter(p => p.category === 'professional').length} проф.
                            </span>
                          )}
                          {Object.values(entry.anonymized || {}).filter(Boolean).length > 0 && (
                            <span className="badge badge-anon">
                              🔒 {Object.values(entry.anonymized).filter(Boolean).length} скрыто
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        className="history-delete"
                        onClick={e => { e.stopPropagation(); deleteDocument(entry.id); refreshHistory(); }}
                        title="Удалить из истории"
                      >✕</button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ════════════════════════════════════════
            PROCESSING VIEW
        ════════════════════════════════════════ */}
        {view === VIEW_PROCESSING && progress && (
          <div className="progress-card">
            <div className="progress-msg">{progress.message}</div>
            <div className="progress-bar-wrap">
              <div className="progress-bar" style={{ width: `${progress.percent || 0}%` }} />
            </div>
            <div className="progress-pct">{progress.percent || 0}%</div>
          </div>
        )}

        {/* ════════════════════════════════════════
            RESULT VIEW
        ════════════════════════════════════════ */}
        {view === VIEW_RESULT && (
          <div className="result-area">

            {/* PD Panel */}
            {(privatePersons.length > 0 || profPersons.length > 0 || otherPD.length > 0) && (
              <aside className="pd-panel">
                <div className="pd-panel-title">Персональные данные</div>

                {privatePersons.length > 0 && (
                  <div className="pd-group">
                    <div className="pd-group-header">
                      <span className="pd-dot private" />
                      <span>Частные лица</span>
                      <button className="pd-group-btn" onClick={() => anonymizeAllByCategory('private')}>
                        {privatePersons.every(p => anonymized[p.id]) ? 'Показать всё' : 'Скрыть всё'}
                      </button>
                    </div>
                    {privatePersons.map(p => (
                      <div key={p.id} className={`pd-item ${anonymized[p.id] ? 'anon' : ''}`} onClick={() => handleAnonymize(p.id)}>
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
                      <span className="pd-dot professional" />
                      <span>Проф. участники</span>
                      <button className="pd-group-btn" onClick={() => anonymizeAllByCategory('professional')}>
                        {profPersons.every(p => anonymized[p.id]) ? 'Показать всё' : 'Скрыть всё'}
                      </button>
                    </div>
                    {profPersons.map(p => (
                      <div key={p.id} className={`pd-item prof ${anonymized[p.id] ? 'anon' : ''}`} onClick={() => handleAnonymize(p.id)}>
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
                      <span className="pd-dot other" />
                      <span>{pdTypeLabels[type] || type}</span>
                      <button className="pd-group-btn" onClick={() => anonymizeAllByCategory(type)}>
                        {items.every(p => anonymized[p.id]) ? 'Показать всё' : 'Скрыть всё'}
                      </button>
                    </div>
                    {items.map(item => (
                      <div key={item.id} className={`pd-item ${anonymized[item.id] ? 'anon' : ''}`} onClick={() => handleAnonymize(item.id)}>
                        <span className="pd-item-name">{item.value}</span>
                        <span className="pd-item-role">→ {item.replacement}</span>
                        <span className="pd-item-status">{anonymized[item.id] ? '🔒' : '👁'}</span>
                      </div>
                    ))}
                  </div>
                ))}

                <div className="pd-legend">
                  <div className="pd-legend-item"><mark className="pd-mark pd-person pd-cat-private">А</mark> — частное лицо</div>
                  <div className="pd-legend-item"><mark className="pd-mark pd-person pd-cat-professional">[ФИО 1]</mark> — проф. участник</div>
                  <div className="pd-legend-item"><span style={{ borderBottom: '2px dashed #f0c040', paddingBottom: '1px', fontSize: '12px' }}>текст</span> — неточное распознавание</div>
                </div>
              </aside>
            )}

            {/* Document Card */}
            <div className="doc-card">
              {/* Title row */}
              <div className="doc-title-row">
                <input
                  className="doc-title-input"
                  value={docTitle}
                  onChange={e => setDocTitle(e.target.value)}
                  placeholder="Название документа"
                />
                <div className="doc-title-actions">
                  <button
                    className={`btn-tool ${editMode ? 'btn-active' : ''}`}
                    onClick={() => setEditMode(v => !v)}
                    title={editMode ? 'Просмотр' : 'Редактировать текст'}
                  >
                    {editMode ? '👁 Просмотр' : '✏️ Редактировать'}
                  </button>
                  <button className="btn-tool btn-save" onClick={handleSave}>
                    💾 Сохранить
                  </button>
                </div>
              </div>

              {/* Toolbar */}
              <div className="doc-toolbar">
                <div className="doc-toolbar-right">
                  <button className="btn-tool" onClick={handleCopy}>
                    {copied ? '✓ Скопировано' : '📋 Копировать'}
                  </button>
                  <button className="btn-tool" onClick={handleDownloadPdf}>⬇ Скачать PDF</button>
                </div>
              </div>

              {/* Body */}
              <div className="doc-body">
                {editMode ? (
                  <RichEditor
                    initialHtml={editedHtml}
                    onChange={setEditedHtml}
                  />
                ) : (
                  <DocumentRenderer
                    text={rawText}
                    personalData={personalData}
                    anonymized={anonymized}
                    onAnonymize={handleAnonymize}
                  />
                )}
              </div>
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
