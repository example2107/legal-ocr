import React, { useState, useRef, useCallback, useEffect } from 'react';
import { pdfToImages, imageFileToBase64 } from './utils/pdfUtils';
import { recognizeDocument, analyzePastedText, PROVIDERS } from './utils/claudeApi';
import { RichEditor, buildAnnotatedHtml, patchPdMarks } from './components/RichEditor';
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
  const [provider, setProvider] = useState('claude');

  const [files, setFiles] = useState([]);
  const [originalImages, setOriginalImages] = useState([]); // for file viewer
  const [showOriginal, setShowOriginal] = useState(false);
  const [originalPage, setOriginalPage] = useState(0);
  const [zoomActive, setZoomActive] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomOffset, setZoomOffset] = useState({ x: 0, y: 0 });
  const viewerBodyRef = useRef(null);
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedText, setPastedText] = useState('');

  const [progress, setProgress] = useState(null);
  const progressCreepRef = useRef(null);

  // Animate progress bar smoothly to a target integer value
  const animateTo = useCallback((target, message) => {
    if (progressCreepRef.current) clearInterval(progressCreepRef.current);
    progressCreepRef.current = setInterval(() => {
      setProgress(prev => {
        if (!prev) return prev;
        const cur = Math.round(prev.percent);
        if (cur >= target) {
          clearInterval(progressCreepRef.current);
          return { ...prev, percent: target, message: message || prev.message };
        }
        // Larger steps when far away, smaller when close — always integer
        const step = Math.max(1, Math.round((target - cur) / 5));
        return { ...prev, percent: Math.min(cur + step, target) };
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
  const [highlightUncertain, setHighlightUncertain] = useState(false);
  const [pendingExportAction, setPendingExportAction] = useState(null); // 'save'|'pdf'|'docx'
  const pendingNavRef = useRef(null);
  const fileInputRef = useRef();
  const viewerFileInputRef = useRef();

  // Direct ref to the editor DOM element — used for DOM patching
  const editorDomRef = useRef(null);

  // Wheel zoom — должен быть passive:false чтобы preventDefault работал
  useEffect(() => {
    const el = viewerBodyRef.current;
    if (!el) return;
    const handler = (e) => {
      if (!zoomActive) return;
      e.preventDefault();
      e.stopPropagation();
      setZoomScale(s => {
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        return Math.min(4, Math.max(0.5, +(s + delta).toFixed(2)));
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [zoomActive]);

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
    setOriginalImages([]);
    setShowOriginal(false);
    setOriginalPage(0);
    setZoomActive(false);
    setZoomScale(1);
    setZoomOffset({ x: 0, y: 0 });
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
        result = await analyzePastedText(pastedText, apiKey.trim(), provider, p => {
          const pct = p.percent != null ? Math.round(p.percent) : (p.stage === 'done' ? 100 : 50);
          setProgress({ percent: pct, message: p.message });
          if (p.stage !== 'done') {
            animateTo(Math.min(pct + 10, 98), null);
          } else {
            stopProgressCreep();
          }
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
        setOriginalImages(allImages); // save for viewer
        result = await recognizeDocument(allImages, apiKey.trim(), provider, p => {
          // Use integer percentages only — no decimal fractions
          const pct = p.percent != null ? Math.round(p.percent) : (p.stage === 'done' ? 100 : 50);
          setProgress({ percent: pct, message: p.message });
          if (p.stage === 'ocr') {
            // While waiting for next page API call — slowly creep toward next milestone
            animateTo(Math.min(pct + 12, 69), null);
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
    setRawText(entry.text || '');
    setEditorHtml(entry.editedHtml || html);
    setPersonalData(pd);
    setAnonymized(anon);
    setLastSavedState(JSON.stringify(anon));
    setView(VIEW_RESULT);
  };

  // ── Save ──────────────────────────────────────────────────────────────────────
  const countUncertain = () => {
    if (!editorDomRef.current) return 0;
    return editorDomRef.current.querySelectorAll('mark.uncertain').length;
  };

  const triggerExport = (action) => {
    const count = countUncertain();
    if (count > 0) {
      setPendingExportAction(action);
      setShowUncertainWarning(true);
      setHighlightUncertain(true);
    } else {
      if (action === 'save') handleSave();
      else if (action === 'pdf') handleDownloadPdf();
      else if (action === 'docx') handleDownloadDocx();
    }
  };

  const handleUncertainProceed = () => {
    setShowUncertainWarning(false);
    setHighlightUncertain(false); // stop animation when user chooses to proceed
    if (pendingExportAction === 'save') handleSave();
    else if (pendingExportAction === 'pdf') handleDownloadPdf();
    else if (pendingExportAction === 'docx') handleDownloadDocx();
    setPendingExportAction(null);
  };

  const handleUncertainCancel = () => {
    setShowUncertainWarning(false);
    // Animation stays ON so user sees the highlights
    setPendingExportAction(null);
    // Scroll to first uncertain mark
    if (editorDomRef.current) {
      const first = editorDomRef.current.querySelector('mark.uncertain');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

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

        // Detect city+date: short left text AND right contains year or month name
        const hasDate = /\d{4}/.test(rightText) ||
          /января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря/.test(rightText);
        const isCityDate = leftText.length < 30 && hasDate;

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

      // Check for inline style center (from [CENTER] tags rendered as style="text-align:center")
      let align = getAlign(node);
      if (node.style && node.style.textAlign === 'center') align = 'center';
      if (node.tagName === 'H1' || node.tagName === 'H2') align = 'center';
      const pPr = '<w:pPr><w:jc w:val="' + align + '"/><w:spacing w:after="0" w:before="0"/></w:pPr>';

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
    const baseDocx = (docTitle || 'документ').replace(/\.pdf$/i, '').replace(/\.docx$/i, '');
    a.download = 'ЮрДок_' + baseDocx + '.docx';
    a.click();
    URL.revokeObjectURL(url);
  };

    const handleDownloadPdf = () => {
    const content = (editorDomRef.current?.innerHTML || editorHtml)
      .replace(/<mark class="pd[^"]*"[^>]*>/g, '<span class="pd-export">')
      .replace(/<mark class="uncertain[^"]*"[^>]*>/g, '<span class="uncertain-export">')
      .replace(/<\/mark>/g, '</span>');

    const pdfTitle = 'ЮрДок_' + (docTitle || 'документ').replace(/\.pdf$/i, '');
    const printHtml = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"/><title>${pdfTitle}</title>
<style>
  /* A4: 210mm wide, margins 25mm each side → text = 160mm */
  /* Times New Roman 14pt matches editor (14px) so line breaks are identical */
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
  .lr-row { display: flex; justify-content: space-between; align-items: baseline; text-align: left; }
  .lr-row span:last-child { text-align: right; }
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

      {/* ── UNCERTAIN WARNING MODAL ── */}
      {showUncertainWarning && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-title">⚠️ Есть непроверенные фрагменты</div>
            <div className="modal-body">
              В документе остались места с неточным распознаванием (выделены двойным подчёркиванием).
              Рекомендуем проверить и исправить их перед сохранением.
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

      <main className="main">

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
              <div className="progress-bar" style={{ width: `${Math.round(progress.percent || 0)}%` }} />
            </div>
            <div className="progress-pct">{Math.round(progress.percent || 0)}%</div>
          </div>
        )}

        {/* ════ RESULT ════ */}
        {view === VIEW_RESULT && (
          <div className="result-outer">
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
                  <div className="pd-legend-item"><span style={{ borderBottom: '3px double #f57c00', paddingBottom: '1px', fontSize: '12px', color: '#4a3000' }}>текст</span> — неточное распознавание</div>
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

              <RichEditor
                html={editorHtml}
                onHtmlChange={handleEditorHtmlChange}
                onPdClick={handlePdClick}
                editorRef={editorDomRef}
                highlightUncertain={highlightUncertain}
              />
            </div>

            {showOriginal && originalImages.length > 0 && (
              <div className="viewer-panel">
                <div className="viewer-header">
                  <span className="viewer-title">Оригинальный файл</span>
                  <div className="viewer-nav">
                    <button
                      className="viewer-nav-btn"
                      disabled={originalPage === 0}
                      onClick={() => { setOriginalPage(p => Math.max(0, p - 1)); setZoomScale(1); setZoomActive(false); }}
                    >←</button>
                    <span className="viewer-page-info">{originalPage + 1} / {originalImages.length}</span>
                    <button
                      className="viewer-nav-btn"
                      disabled={originalPage === originalImages.length - 1}
                      onClick={() => { setOriginalPage(p => Math.min(originalImages.length - 1, p + 1)); setZoomScale(1); setZoomActive(false); }}
                    >→</button>
                  </div>
                  <div className="viewer-zoom-controls">
                    <button className="viewer-nav-btn" onClick={() => setZoomScale(s => Math.max(0.5, +(s - 0.25).toFixed(2)))} title="Отдалить">−</button>
                    <span className="viewer-page-info" style={{minWidth: 40}}>{Math.round(zoomScale * 100)}%</span>
                    <button className="viewer-nav-btn" onClick={() => setZoomScale(s => Math.min(4, +(s + 0.25).toFixed(2)))} title="Приблизить">+</button>
                    <button className="viewer-nav-btn" onClick={() => setZoomScale(1)} title="Сбросить масштаб" style={{fontSize:11}}>↺</button>
                  </div>
                  <button className="viewer-close" onClick={() => { setShowOriginal(false); setZoomActive(false); setZoomScale(1); }}>✕ Скрыть</button>
                </div>
                <div
                  ref={viewerBodyRef}
                  className={"viewer-body" + (zoomActive ? " zoom-active" : "")}
                  onMouseDown={zoomActive ? (e) => {
                    if (e.button !== 0) return;
                    const el = viewerBodyRef.current;
                    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
                    e.preventDefault();
                  } : undefined}
                  onMouseMove={zoomActive ? (e) => {
                    const d = dragRef.current;
                    if (!d.dragging) return;
                    const el = viewerBodyRef.current;
                    el.scrollLeft = d.scrollLeft - (e.clientX - d.startX);
                    el.scrollTop  = d.scrollTop  - (e.clientY - d.startY);
                  } : undefined}
                  onMouseUp={() => { dragRef.current.dragging = false; }}
                  onMouseLeave={() => { dragRef.current.dragging = false; }}
                >
                  <img
                    src={'data:' + (originalImages[originalPage]?.mediaType || 'image/jpeg') + ';base64,' + originalImages[originalPage]?.base64}
                    alt={'Страница ' + (originalPage + 1)}
                    className="viewer-img"
                    style={{
                      transform: `scale(${zoomScale})`,
                      transformOrigin: 'top center',
                      cursor: zoomActive ? (dragRef.current?.dragging ? 'grabbing' : 'grab') : 'pointer',
                      userSelect: 'none',
                    }}
                    onClick={(e) => {
                      // Не переключать режим если это был drag
                      if (Math.abs(e.clientX - dragRef.current.startX) > 3 || Math.abs(e.clientY - dragRef.current.startY) > 3) return;
                      setZoomActive(v => !v);
                      if (zoomActive) setZoomScale(1);
                    }}
                    draggable={false}
                    title={zoomActive ? 'Кликните чтобы выйти из режима зума' : 'Кликните для приближения колесиком мыши'}
                  />
                </div>
              </div>
            )}

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
