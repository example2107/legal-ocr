import React, { useRef, useEffect, useCallback } from 'react';
import './RichEditor.css';

const TOOLS = [
  { cmd: 'bold', icon: '<b>Б</b>', title: 'Жирный (Ctrl+B)' },
  { cmd: 'italic', icon: '<i>К</i>', title: 'Курсив (Ctrl+I)' },
  { cmd: 'underline', icon: '<u>П</u>', title: 'Подчёркнутый (Ctrl+U)' },
  { type: 'sep' },
  { cmd: 'justifyLeft', icon: '⬛▭▭', title: 'По левому краю' },
  { cmd: 'justifyCenter', icon: '▭⬛▭', title: 'По центру' },
  { cmd: 'justifyRight', icon: '▭▭⬛', title: 'По правому краю' },
  { cmd: 'justifyFull', icon: '▬▬▬', title: 'По ширине' },
  { type: 'sep' },
  { cmd: 'insertOrderedList', icon: '1.', title: 'Нумерованный список' },
  { cmd: 'insertUnorderedList', icon: '•', title: 'Маркированный список' },
  { type: 'sep' },
  { cmd: 'outdent', icon: '⇤', title: 'Уменьшить отступ' },
  { cmd: 'indent', icon: '⇥', title: 'Увеличить отступ' },
  { type: 'sep' },
  { cmd: 'removeFormat', icon: '✕', title: 'Убрать форматирование' },
];

const FONT_SIZES = [
  { label: '10', value: '1' },
  { label: '12', value: '2' },
  { label: '14', value: '3' },
  { label: '16', value: '4' },
  { label: '18', value: '5' },
  { label: '24', value: '6' },
];

const HEADINGS = [
  { label: 'Обычный текст', value: 'div' },
  { label: 'Заголовок 1', value: 'h1' },
  { label: 'Заголовок 2', value: 'h2' },
  { label: 'Заголовок 3', value: 'h3' },
];

export function RichEditor({ initialHtml, onChange, readOnly }) {
  const editorRef = useRef(null);
  const lastHtml = useRef(initialHtml || '');

  // Init content
  useEffect(() => {
    if (editorRef.current && initialHtml !== undefined) {
      if (editorRef.current.innerHTML !== initialHtml) {
        editorRef.current.innerHTML = initialHtml || '';
        lastHtml.current = initialHtml || '';
      }
    }
  }, [initialHtml]);

  const exec = useCallback((cmd, value = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    handleChange();
  }, []);

  const handleChange = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    if (html !== lastHtml.current) {
      lastHtml.current = html;
      onChange?.(html);
    }
  }, [onChange]);

  const handleKeyDown = useCallback((e) => {
    // Tab → indent
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        document.execCommand('outdent', false, null);
      } else {
        document.execCommand('indent', false, null);
      }
      handleChange();
    }
  }, [handleChange]);

  return (
    <div className="rich-editor-wrap">
      {!readOnly && (
        <div className="rich-toolbar" onMouseDown={e => e.preventDefault()}>
          <select
            className="rich-select"
            title="Стиль абзаца"
            onChange={e => exec('formatBlock', e.target.value)}
            defaultValue="div"
          >
            {HEADINGS.map(h => (
              <option key={h.value} value={h.value}>{h.label}</option>
            ))}
          </select>

          <select
            className="rich-select rich-select-sm"
            title="Размер шрифта"
            onChange={e => exec('fontSize', e.target.value)}
            defaultValue="3"
          >
            {FONT_SIZES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          <div className="rich-sep" />

          {TOOLS.map((tool, i) => {
            if (tool.type === 'sep') return <div key={`sep-${i}`} className="rich-sep" />;
            return (
              <button
                key={tool.cmd}
                className="rich-btn"
                title={tool.title}
                onMouseDown={e => { e.preventDefault(); exec(tool.cmd); }}
                dangerouslySetInnerHTML={{ __html: tool.icon }}
              />
            );
          })}
        </div>
      )}

      <div
        ref={editorRef}
        className={`rich-content ${readOnly ? 'read-only' : ''}`}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onInput={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleChange}
        spellCheck={false}
      />
    </div>
  );
}

// Convert markdown-style text to HTML for the editor
export function markdownToHtml(text) {
  const lines = text.split('\n');
  let html = '';
  for (const line of lines) {
    if (line.startsWith('## ')) {
      html += `<h2>${escHtml(line.slice(3))}</h2>`;
    } else if (line.startsWith('### ')) {
      html += `<h3>${escHtml(line.slice(4))}</h3>`;
    } else if (line === '---') {
      html += '<hr/>';
    } else if (!line.trim()) {
      html += '<div><br/></div>';
    } else {
      const content = escHtml(line).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      html += `<div>${content}</div>`;
    }
  }
  return html;
}

// Convert HTML back to plain text
export function htmlToPlainText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.innerText || tmp.textContent || '';
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
