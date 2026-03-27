import React, { useRef, useEffect, useCallback } from 'react';
import './RichEditor.css';

// ── Toolbar config ─────────────────────────────────────────────────────────────
const TOOLBAR = [
  {
    group: 'inline',
    items: [
      { cmd: 'bold',      icon: 'B', title: 'Жирный (Ctrl+B)',       style: { fontWeight: 700 } },
      { cmd: 'italic',    icon: 'К', title: 'Курсив (Ctrl+I)',        style: { fontStyle: 'italic' } },
      { cmd: 'underline', icon: 'П', title: 'Подчёркнутый (Ctrl+U)', style: { textDecoration: 'underline' } },
    ],
  },
  { type: 'sep' },
  {
    group: 'align',
    items: [
      { cmd: 'justifyLeft',   svg: 'align-left',    title: 'По левому краю' },
      { cmd: 'justifyCenter', svg: 'align-center',  title: 'По центру' },
      { cmd: 'justifyRight',  svg: 'align-right',   title: 'По правому краю' },
      { cmd: 'justifyFull',   svg: 'align-justify', title: 'По ширине' },
    ],
  },
  { type: 'sep' },
  {
    group: 'lists',
    items: [
      { cmd: 'insertOrderedList',   svg: 'list-ol', title: 'Нумерованный список' },
      { cmd: 'insertUnorderedList', svg: 'list-ul', title: 'Маркированный список' },
    ],
  },
  { type: 'sep' },
  {
    group: 'indent',
    items: [
      { cmd: 'outdent', svg: 'outdent', title: 'Уменьшить отступ (Shift+Tab)' },
      { cmd: 'indent',  svg: 'indent',  title: 'Увеличить отступ (Tab)' },
    ],
  },
  { type: 'sep' },
  {
    group: 'clear',
    items: [
      { cmd: 'removeFormat', svg: 'clear-format', title: 'Убрать форматирование' },
    ],
  },
];

// ── SVG icons ──────────────────────────────────────────────────────────────────
const ICONS = {
  'align-left': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
    </svg>
  ),
  'align-center': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm2-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
    </svg>
  ),
  'align-right': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-4-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm4-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-4-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
    </svg>
  ),
  'align-justify': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 12.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
    </svg>
  ),
  'list-ol': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5z"/>
      <path d="M1.713 11.865v-.474H2c.217 0 .363-.137.363-.317 0-.185-.158-.31-.361-.31-.223 0-.367.152-.373.31h-.59c.016-.467.373-.787.986-.787.588-.002.954.291.957.703a.595.595 0 0 1-.492.594v.033a.615.615 0 0 1 .569.631c.003.533-.502.8-1.051.8-.656 0-1-.37-1.008-.794h.582c.008.178.186.306.422.309.254 0 .424-.145.422-.35-.002-.195-.155-.348-.414-.348h-.3zm-.004-4.699h-.604v-.035c0-.408.295-.844.958-.844.583 0 .96.326.96.756 0 .389-.257.617-.476.848l-.537.572v.03h1.054V9H1.143v-.395l.957-.99c.138-.142.293-.304.293-.508 0-.18-.147-.32-.342-.32a.33.33 0 0 0-.342.338v.041zM2.564 5h-.563v-2.5h-.018l-.51.317v-.51L1.978 2h.586V5z"/>
    </svg>
  ),
  'list-ul': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5z"/>
      <path d="M2 13.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0-4a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0-4a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
    </svg>
  ),
  // New clean indent icons: lines + arrow direction
  'outdent': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 2h12v1.5H2V2zm0 10.5h12V14H2v-1.5zm4-5.25h8V8.75H6V7.25zM4.5 8 2 5.5v5L4.5 8z"/>
    </svg>
  ),
  'indent': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 2h12v1.5H2V2zm0 10.5h12V14H2v-1.5zm4-5.25h8V8.75H6V7.25zM2 5.5 4.5 8 2 10.5v-5z"/>
    </svg>
  ),
  'clear-format': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M8.21 1.073a.5.5 0 0 1 .7-.077l5 4a.5.5 0 0 1-.626.782L8.977 2.06 2.825 8h2.656l.96 3.2.786-.393a.5.5 0 0 1 .448.894l-1.5.75a.5.5 0 0 1-.673-.227L3.6 8.8H.5a.5.5 0 0 1-.39-.811L8.21 1.073z"/>
      <path d="M10.854 9.146a.5.5 0 0 0-.707 0L9 10.293 7.854 9.146a.5.5 0 0 0-.707.707L8.293 11l-1.146 1.146a.5.5 0 0 0 .707.708L9 11.707l1.146 1.147a.5.5 0 0 0 .708-.708L9.707 11l1.147-1.146a.5.5 0 0 0 0-.708z"/>
    </svg>
  ),
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function applyBold(html) {
  return html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function annotLine(text, marks, anonymized) {
  const patterns = [
    '⚠️\\[(НЕТОЧНО: [^\\]]*|НЕЧИТАЕМО)\\]',
    ...marks.map(m => escRe(m.txt)),
  ];
  let re;
  try { re = new RegExp(patterns.join('|'), 'g'); } catch { return applyBold(esc(text)); }

  let out = '', last = 0, match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out += applyBold(esc(text.slice(last, match.index)));
    const mt = match[0];
    if (mt.startsWith('⚠️[')) {
      const inner = mt.slice(3, -1);
      const isUnread = inner === 'НЕЧИТАЕМО';
      out += `<mark class="uncertain${isUnread ? ' unreadable' : ''}" data-tooltip="${isUnread ? 'Нечитаемый фрагмент · ПКМ — снять выделение' : 'Возможно неточное распознавание · ПКМ — снять выделение'}">${isUnread ? '[НЕЧИТАЕМО]' : esc(inner.replace('НЕТОЧНО: ', ''))}</mark>`;
    } else {
      const hl = marks.find(m => m.txt === mt);
      if (hl) {
        const isAnon = !!anonymized[hl.id];
        const display = isAnon ? (hl.type === 'person' ? hl.letter : hl.replacement) : esc(mt);
        const cat = hl.type === 'person' ? (hl.cat === 'private' ? 'priv' : 'prof') : 'oth';
        out += `<mark class="pd ${cat}${isAnon ? ' anon' : ''}" data-pd-id="${hl.id}" title="${isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить'}">${display}</mark>`;
      } else {
        out += applyBold(esc(mt));
      }
    }
    last = match.index + mt.length;
  }
  if (last < text.length) out += applyBold(esc(text.slice(last)));
  return out;
}

// ── Build full annotated HTML from rawText (used only on first load) ───────────
export function buildAnnotatedHtml(rawText, personalData, anonymized) {
  if (!rawText) return '';
  const { persons = [], otherPD = [] } = personalData;
  const marks = [];
  for (const p of persons) {
    for (const mention of (p.mentions || [p.fullName])) {
      if (mention && mention.length > 1)
        marks.push({ txt: mention, type: 'person', cat: p.category, id: p.id, letter: p.letter });
    }
  }
  for (const it of otherPD) {
    if (it.value) marks.push({ txt: it.value, type: 'other', id: it.id, replacement: it.replacement });
  }
  marks.sort((a, b) => b.txt.length - a.txt.length);

  // Post-process: remove word duplication before ⚠️ markers
  // Claude sometimes writes: "слово ⚠️[НЕТОЧНО: слово]" — remove the duplicate before marker
  const deduped = rawText.replace(
    /([\wА-яЁё]+)\s+⚠️\[НЕТОЧНО:\s*\1\]/gi,
    '⚠️[НЕТОЧНО: $1]'
  );
  const processText = deduped;

  // Auto-center patterns for typical legal document sections
  // Strip ** markdown wrapping before testing, since Claude often writes **УСТАНОВИЛ:**
  const LEGAL_CENTER_RE = /(УСТАНОВИЛ|ПОСТАНОВИЛ|РЕШИЛ|ОПРЕДЕЛИЛ|ПРИГОВОРИЛ|УСТАНОВИЛА|ПОСТАНОВИЛА|РЕШИЛА|ОПРЕДЕЛИЛА|ПРИГОВОРИЛА|УСТАНОВИЛО|ПОСТАНОВИЛО)[:\s]/i;
  const isLegalCenter = (line) => {
    const stripped = line.replace(/\*\*/g, '').trim();
    return LEGAL_CENTER_RE.test(stripped) && stripped.length < 60;
  };

  return processText.split('\n').map(line => {
    if (line.startsWith('## ')) return `<h2 style="text-align:center">${annotLine(line.slice(3), marks, anonymized)}</h2>`;
    if (line.startsWith('### ')) return `<h3 style="text-align:center">${annotLine(line.slice(4), marks, anonymized)}</h3>`;
    // Skip --- (page break artifact)
    if (line === '---') return '<div><br/></div>';
    if (!line.trim()) return '<div><br/></div>';
    // [CENTER]text[/CENTER] tag from OCR prompt
    const centerMatch = line.match(/^\[CENTER\](.+?)\[\/CENTER\]$/);
    if (centerMatch) {
      return `<div style="text-align:center">${annotLine(centerMatch[1], marks, anonymized)}</div>`;
    }
    // LEFTRIGHT: left text | right text
    const lrMatch = line.match(/^\[LEFTRIGHT:\s*(.+?)\s*\|\s*(.+?)\s*\]$/);
    if (lrMatch) {
      return `<div class="lr-row"><span>${annotLine(lrMatch[1], marks, anonymized)}</span><span>${annotLine(lrMatch[2], marks, anonymized)}</span></div>`;
    }
    // Auto-center legal section headers (handles ** wrapping too)
    if (isLegalCenter(line)) {
      // Strip ** from display, keep bold via <strong>
      const clean = line.replace(/\*\*/g, '').trim();
      return `<div style="text-align:center"><strong>${annotLine(clean, marks, anonymized)}</strong></div>`;
    }
    return `<div>${annotLine(line, marks, anonymized)}</div>`;
  }).join('');
}

export function htmlToPlainText(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.innerText || tmp.textContent || '';
}

// ── Patch existing PD marks in DOM without rebuilding entire HTML ──────────────
// This is the key fix: instead of replacing innerHTML, we surgically update
// only the <mark data-pd-id="..."> elements that changed.
export function patchPdMarks(editorEl, id, isAnon, letter, replacement) {
  if (!editorEl) return;
  const marks = editorEl.querySelectorAll(`mark[data-pd-id="${id}"]`);
  marks.forEach(mark => {
    const wasAnon = mark.classList.contains('anon');
    if (isAnon && !wasAnon) {
      mark.textContent = letter || replacement || '?';
      mark.classList.add('anon');
      mark.title = 'Нажмите, чтобы показать';
      // Add space after mark if next text starts with a letter (not punctuation)
      const next = mark.nextSibling;
      if (next && next.nodeType === 3) {
        const txt = next.textContent;
        if (txt && /^[а-яёА-ЯЁa-zA-Z]/.test(txt)) {
          next.textContent = ' ' + txt;
        }
      }
    } else if (!isAnon && wasAnon) {
      mark.textContent = mark.dataset.original || mark.textContent;
      mark.classList.remove('anon');
      mark.title = 'Нажмите, чтобы обезличить';
      // Remove extra space that was added during anonymization
      const next = mark.nextSibling;
      if (next && next.nodeType === 3) {
        const txt = next.textContent;
        if (txt && txt.startsWith(' ') && /^[а-яёА-ЯЁa-zA-Z]/.test(txt.slice(1))) {
          next.textContent = txt.slice(1);
        }
      }
    }
  });
}

// Store original text on marks when editor is initialized
export function initPdMarkOriginals(editorEl) {
  if (!editorEl) return;
  editorEl.querySelectorAll('mark[data-pd-id]').forEach(mark => {
    if (!mark.dataset.original) {
      mark.dataset.original = mark.textContent;
    }
  });
}

// ── RichEditor component ───────────────────────────────────────────────────────
// ── Context menu for uncertain marks ─────────────────────────────────────────
function UncertainContextMenu({ x, y, onRemove, onClose }) {
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    const handler = () => onClose();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [onClose]);

  // После рендера корректируем если выходит за правый/нижний край
  React.useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8)
      el.style.left = Math.max(8, window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight - 8)
      el.style.top = Math.max(8, y - rect.height - 8) + 'px';
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="uncertain-menu"
      style={{ position: 'fixed', top: y, left: x, zIndex: 9999 }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="uncertain-menu-item" onClick={onRemove}>
        ✓ Исправлено — снять выделение
      </div>
    </div>
  );
}

export function RichEditor({ html, onHtmlChange, onPdClick, editorRef: externalRef, highlightUncertain }) {
  const internalRef = useRef(null);
  const editorRef = externalRef || internalRef;
  const lastHtml = useRef('');
  const isComposing = useRef(false);
  const [ctxMenu, setCtxMenu] = React.useState(null); // {x, y, mark}

  // Only set innerHTML when html prop changes from OUTSIDE (new doc, not user typing)
  useEffect(() => {
    if (!editorRef.current) return;
    // Only update DOM if content truly differs (avoids cursor jump on every keystroke)
    if (html !== lastHtml.current) {
      editorRef.current.innerHTML = html || '';
      lastHtml.current = html || '';
      // Store originals for de-anonymization
      initPdMarkOriginals(editorRef.current);
    }
  }, [html, editorRef]);

  const notifyChange = useCallback(() => {
    if (!editorRef.current) return;
    const current = editorRef.current.innerHTML;
    if (current !== lastHtml.current) {
      lastHtml.current = current;
      onHtmlChange?.(current);
    }
  }, [onHtmlChange, editorRef]);

  const exec = useCallback((cmd, value = null) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    // If nothing is selected and command needs a selection (formatBlock, fontSize),
    // select all content in the current block so the command applies
    const sel = window.getSelection();
    if (sel && sel.rangeCount === 0) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    document.execCommand(cmd, false, value);
    notifyChange();
  }, [notifyChange, editorRef]);

  const handleClick = useCallback((e) => {
    const mark = e.target.closest('mark[data-pd-id]');
    if (mark) {
      e.preventDefault();
      e.stopPropagation();
      onPdClick?.(mark.dataset.pdId);
    }
  }, [onPdClick]);

  const handleContextMenu = useCallback((e) => {
    const mark = e.target.closest('mark.uncertain');
    if (mark) {
      e.preventDefault();
      // Берём координаты из e.target — именно тот элемент по которому кликнули
      const rect = e.target.getBoundingClientRect();
      setCtxMenu({ x: rect.left, y: rect.bottom + 4, mark });
    }
  }, []);

  const removeUncertainMark = useCallback(() => {
    if (!ctxMenu?.mark) return;
    const mark = ctxMenu.mark;
    // Replace the mark with its plain text content
    const text = document.createTextNode(mark.textContent);
    mark.parentNode.replaceChild(text, mark);
    notifyChange();
    setCtxMenu(null);
  }, [ctxMenu, notifyChange]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      exec(e.shiftKey ? 'outdent' : 'indent');
    }
  }, [exec]);

  return (
    <div className="rich-editor-wrap">
      <div className="rich-toolbar" onMouseDown={e => e.preventDefault()}>
        {TOOLBAR.map((entry, i) => {
          if (entry.type === 'sep') return <div key={`sep-${i}`} className="rich-sep" />;
          return entry.items.map((item, j) => {
            if (item.type === 'select') return null; // selects removed
            return (
              <button
                key={`btn-${i}-${j}`}
                className="rich-btn"
                title={item.title}
                onMouseDown={e => { e.preventDefault(); exec(item.cmd); }}
              >
                {item.svg
                  ? <span className="rich-icon">{ICONS[item.svg]}</span>
                  : <span style={item.style}>{item.icon}</span>
                }
              </button>
            );
          });
        })}
      </div>

      <div
        ref={editorRef}
        className={"rich-content" + (highlightUncertain ? " uncertain-highlight-active" : "")}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={() => { if (!isComposing.current) notifyChange(); }}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => { isComposing.current = false; notifyChange(); }}
        onBlur={notifyChange}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />
      {ctxMenu && (
        <UncertainContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onRemove={removeUncertainMark}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
