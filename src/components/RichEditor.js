import React, { useRef, useEffect, useCallback, useState } from 'react';
import './RichEditor.css';

// ── Toolbar config ────────────────────────────────────────────────────────────
const TOOLBAR = [
  {
    group: 'block',
    items: [
      { type: 'select', id: 'formatBlock', options: [
        { label: 'Обычный текст', value: 'div' },
        { label: 'Заголовок 1', value: 'h1' },
        { label: 'Заголовок 2', value: 'h2' },
        { label: 'Заголовок 3', value: 'h3' },
      ]},
      { type: 'select', id: 'fontSize', small: true, options: [
        { label: '10', value: '1' },
        { label: '12', value: '2' },
        { label: '14', value: '3' },
        { label: '16', value: '4' },
        { label: '18', value: '5' },
        { label: '24', value: '6' },
      ]},
    ],
  },
  { type: 'sep' },
  {
    group: 'inline',
    items: [
      { cmd: 'bold',      icon: 'B',  title: 'Жирный (Ctrl+B)',        style: { fontWeight: 700 } },
      { cmd: 'italic',    icon: 'I',  title: 'Курсив (Ctrl+I)',         style: { fontStyle: 'italic' } },
      { cmd: 'underline', icon: 'U',  title: 'Подчёркнутый (Ctrl+U)',   style: { textDecoration: 'underline' } },
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
      { cmd: 'insertOrderedList',   svg: 'list-ol',  title: 'Нумерованный список' },
      { cmd: 'insertUnorderedList', svg: 'list-ul',  title: 'Маркированный список' },
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

// SVG icons
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
  'outdent': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M3 8a.5.5 0 0 1 .5-.5h6.793L8.146 5.354a.5.5 0 1 1 .708-.708l3 3a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708-.708L10.293 8.5H3.5A.5.5 0 0 1 3 8z"/>
      <path fillRule="evenodd" d="M12.5 4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5zM2 4a.5.5 0 0 1 .5.5v3.248l1.303-1.303a.5.5 0 0 1 .707.708L2.354 9.096a.5.5 0 0 1-.708 0L-.001 7.15a.5.5 0 1 1 .707-.707l1.294 1.293V4.5A.5.5 0 0 1 2 4z"/>
    </svg>
  ),
  'indent': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M3 8a.5.5 0 0 1 .5-.5h6.793L8.146 5.354a.5.5 0 1 1 .708-.708l3 3a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708-.708L10.293 8.5H3.5A.5.5 0 0 1 3 8z"/>
      <path fillRule="evenodd" d="M12.5 4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5zM2 4a.5.5 0 0 1 .5.5v3.248l1.303-1.303a.5.5 0 0 1 .707.708L2.354 9.096a.5.5 0 0 1-.708 0L.001 7.15a.5.5 0 1 1 .707-.707L2 7.736V4.5A.5.5 0 0 1 2 4z"/>
    </svg>
  ),
  'clear-format': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M8.21 1.073a.5.5 0 0 1 .7-.077l5 4a.5.5 0 0 1-.626.782L8.977 2.06 2.825 8h2.656l.96 3.2.786-.393a.5.5 0 0 1 .448.894l-1.5.75a.5.5 0 0 1-.673-.227L3.6 8.8H.5a.5.5 0 0 1-.39-.811L8.21 1.073z"/>
      <path d="M10.854 9.146a.5.5 0 0 0-.707 0L9 10.293 7.854 9.146a.5.5 0 0 0-.707.707L8.293 11l-1.146 1.146a.5.5 0 0 0 .707.708L9 11.707l1.146 1.147a.5.5 0 0 0 .708-.708L9.707 11l1.147-1.146a.5.5 0 0 0 0-.708z"/>
    </svg>
  ),
};

// ── Convert markdown text → HTML ──────────────────────────────────────────────
export function markdownToHtml(text) {
  if (!text) return '';
  const lines = text.split('\n');
  let html = '';
  for (const line of lines) {
    if (line.startsWith('## ')) {
      html += `<h2>${esc(line.slice(3))}</h2>`;
    } else if (line.startsWith('### ')) {
      html += `<h3>${esc(line.slice(4))}</h3>`;
    } else if (line === '---') {
      html += '<hr/>';
    } else if (!line.trim()) {
      html += '<div><br/></div>';
    } else {
      const content = esc(line).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      html += `<div>${content}</div>`;
    }
  }
  return html;
}

// Get plain text from editor HTML
export function htmlToPlainText(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.innerText || tmp.textContent || '';
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Build HTML with PD marks injected ─────────────────────────────────────────
export function buildAnnotatedHtml(rawText, personalData, anonymized) {
  if (!rawText) return '';

  const { persons = [], otherPD = [] } = personalData;

  // Build highlight list
  const marks = [];
  for (const p of persons) {
    for (const mention of (p.mentions || [p.fullName])) {
      if (mention && mention.length > 1) {
        marks.push({ txt: mention, type: 'person', cat: p.category, id: p.id, letter: p.letter });
      }
    }
  }
  for (const it of otherPD) {
    if (it.value) marks.push({ txt: it.value, type: 'other', id: it.id, replacement: it.replacement });
  }
  marks.sort((a, b) => b.txt.length - a.txt.length);

  // Convert line by line
  const lines = rawText.split('\n');
  let html = '';
  for (const line of lines) {
    if (line.startsWith('## ')) {
      html += `<h2>${annotLine(line.slice(3), marks, anonymized)}</h2>`;
    } else if (line.startsWith('### ')) {
      html += `<h3>${annotLine(line.slice(4), marks, anonymized)}</h3>`;
    } else if (line === '---') {
      html += '<hr/>';
    } else if (!line.trim()) {
      html += '<div><br/></div>';
    } else {
      html += `<div>${annotLine(line, marks, anonymized)}</div>`;
    }
  }
  return html;
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function annotLine(text, marks, anonymized) {
  const patterns = [
    '⚠️\\[(НЕТОЧНО: [^\\]]*|НЕЧИТАЕМО)\\]',
    ...marks.map(m => escRe(m.txt)),
  ];

  let re;
  try { re = new RegExp(patterns.join('|'), 'g'); }
  catch { return applyBold(esc(text)); }

  let out = '';
  let last = 0;
  let match;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out += applyBold(esc(text.slice(last, match.index)));
    const mt = match[0];

    if (mt.startsWith('⚠️[')) {
      const inner = mt.slice(3, -1);
      const isUnread = inner === 'НЕЧИТАЕМО';
      const tip = isUnread ? 'Текст не удалось распознать' : 'Возможно неточное распознавание — проверьте вручную';
      out += `<mark class="uncertain${isUnread ? ' unreadable' : ''}" title="${tip}">${isUnread ? '[НЕЧИТАЕМО]' : esc(inner.replace('НЕТОЧНО: ', ''))}</mark>`;
    } else {
      const hl = marks.find(m => m.txt === mt);
      if (hl) {
        const isAnon = !!anonymized[hl.id];
        const display = isAnon ? (hl.type === 'person' ? hl.letter : hl.replacement) : esc(mt);
        const cat = hl.type === 'person' ? (hl.cat === 'private' ? 'priv' : 'prof') : 'oth';
        const tip = isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить';
        out += `<mark class="pd ${cat}${isAnon ? ' anon' : ''}" data-pd-id="${hl.id}" title="${tip}">${display}</mark>`;
      } else {
        out += applyBold(esc(mt));
      }
    }
    last = match.index + mt.length;
  }
  if (last < text.length) out += applyBold(esc(text.slice(last)));
  return out;
}

function applyBold(html) {
  return html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

// ── RichEditor component ───────────────────────────────────────────────────────
export function RichEditor({ html, onHtmlChange, onPdClick }) {
  const editorRef = useRef(null);
  const lastHtml = useRef('');
  const isComposing = useRef(false);

  // Sync HTML into editor when it changes from outside (new doc loaded, anonymize click)
  useEffect(() => {
    if (!editorRef.current) return;
    if (html !== lastHtml.current) {
      // Save selection position
      const sel = window.getSelection();
      const hadFocus = editorRef.current.contains(document.activeElement) || document.activeElement === editorRef.current;

      editorRef.current.innerHTML = html || '';
      lastHtml.current = html || '';

      // Restore focus if editor was focused
      if (hadFocus) {
        editorRef.current.focus();
        try {
          const range = document.createRange();
          range.selectNodeContents(editorRef.current);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch {}
      }
    }
  }, [html]);

  const notifyChange = useCallback(() => {
    if (!editorRef.current) return;
    const current = editorRef.current.innerHTML;
    if (current !== lastHtml.current) {
      lastHtml.current = current;
      onHtmlChange?.(current);
    }
  }, [onHtmlChange]);

  const exec = useCallback((cmd, value = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    notifyChange();
  }, [notifyChange]);

  const handleClick = useCallback((e) => {
    const mark = e.target.closest('mark[data-pd-id]');
    if (mark) {
      e.preventDefault();
      onPdClick?.(mark.dataset.pdId);
    }
  }, [onPdClick]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      exec(e.shiftKey ? 'outdent' : 'indent');
    }
  }, [exec]);

  return (
    <div className="rich-editor-wrap">
      {/* Toolbar */}
      <div className="rich-toolbar" onMouseDown={e => e.preventDefault()}>
        {TOOLBAR.map((entry, i) => {
          if (entry.type === 'sep') return <div key={`sep-${i}`} className="rich-sep" />;
          return entry.items.map((item, j) => {
            if (item.type === 'select') {
              return (
                <select
                  key={`sel-${i}-${j}`}
                  className={`rich-select ${item.small ? 'rich-select-sm' : ''}`}
                  title={item.id === 'formatBlock' ? 'Стиль абзаца' : 'Размер шрифта'}
                  onChange={e => exec(item.id, e.target.value)}
                  defaultValue={item.id === 'fontSize' ? '3' : 'div'}
                >
                  {item.options.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              );
            }
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

      {/* Editor surface */}
      <div
        ref={editorRef}
        className="rich-content"
        contentEditable
        suppressContentEditableWarning
        spellCheck={true}
        lang="ru"
        onInput={() => { if (!isComposing.current) notifyChange(); }}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => { isComposing.current = false; notifyChange(); }}
        onBlur={notifyChange}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
      />
    </div>
  );
}
