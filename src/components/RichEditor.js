import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './RichEditor.css';
import EditorContextMenu from './rich-editor/EditorContextMenu';
import { createRichEditorContextActions } from './rich-editor/createRichEditorContextActions';
import { findAdjacentPdMark } from './rich-editor/richEditorKeydownUtils';
import { ICONS, TOOLBAR } from './rich-editor/richEditorToolbarConfig';
import { initPdMarkOriginals } from '../utils/richEditorMarkUtils';

export { buildAnnotatedHtml, buildPdMatchPattern, htmlToPlainText } from '../utils/richEditorAnnotations';
export { patchPdMarks, initPdMarkOriginals } from '../utils/richEditorMarkUtils';

function renderToolbarButton(item, exec, key) {
  return (
    <button
      key={key}
      className="rich-btn"
      title={item.title}
      onMouseDown={(event) => {
        event.preventDefault();
        exec(item.cmd);
      }}
    >
      {item.svg ? (
        <span className="rich-icon">{ICONS[item.svg]}</span>
      ) : (
        <span style={item.style}>{item.icon}</span>
      )}
    </button>
  );
}

function RichToolbar({ exec, pageNavigation }) {
  return (
    <div className="rich-toolbar">
      {TOOLBAR.map((entry, entryIndex) => {
        if (entry.type === 'sep') {
          return <div key={`sep-${entryIndex}`} className="rich-sep" />;
        }

        return entry.items.map((item, itemIndex) =>
          item.type === 'select'
            ? null
            : renderToolbarButton(item, exec, `btn-${entryIndex}-${itemIndex}`),
        );
      })}

      {pageNavigation && (
        <div className="rich-toolbar-nav" onMouseDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="rich-page-btn"
            onMouseDown={(event) => {
              event.preventDefault();
              pageNavigation.onStepBack?.();
            }}
            disabled={pageNavigation.currentPage <= 1}
            title="Предыдущая страница"
          >
            ←
          </button>
          <input
            id="editor-page-input"
            ref={pageNavigation.inputRef}
            className="rich-page-input"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pageNavigation.inputValue}
            onChange={(event) => pageNavigation.onInputChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                pageNavigation.onSubmit?.();
              }
            }}
            aria-label="Текущая страница"
          />
          <span className="rich-page-total">из {pageNavigation.totalPages}</span>
          <button
            type="button"
            className="rich-page-btn"
            onMouseDown={(event) => {
              event.preventDefault();
              pageNavigation.onStepForward?.();
            }}
            disabled={pageNavigation.currentPage >= pageNavigation.totalPages}
            title="Следующая страница"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}

export function RichEditor({
  html,
  onHtmlChange,
  onPdClick,
  onRemovePdMark,
  onApplyPdCanonicalText,
  onEditPdMark,
  onEditPdTextMark,
  onAttachPdMark,
  onAddPdMark,
  onRemoveAmbiguousMark,
  onUncertainResolved,
  existingPD,
  editorRef: externalRef,
  highlightUncertain,
  pageNavigation = null,
}) {
  const internalRef = useRef(null);
  const editorRef = externalRef || internalRef;
  const lastHtml = useRef('');
  const isComposing = useRef(false);
  const [ctxMenu, setCtxMenu] = useState(null);

  useEffect(() => {
    if (!editorRef.current) return;
    if (html === lastHtml.current) return;

    editorRef.current.innerHTML = html || '';
    lastHtml.current = html || '';
    initPdMarkOriginals(editorRef.current);
  }, [html, editorRef]);

  const notifyChange = useCallback(() => {
    if (!editorRef.current) return;

    const currentHtml = editorRef.current.innerHTML;
    if (currentHtml !== lastHtml.current) {
      lastHtml.current = currentHtml;
      onHtmlChange?.(currentHtml);
    }
  }, [editorRef, onHtmlChange]);

  const exec = useCallback((cmd, value = null) => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();

    const selection = window.getSelection();
    if (selection && selection.rangeCount === 0) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    document.execCommand(cmd, false, value);
    notifyChange();
  }, [editorRef, notifyChange]);

  const handleClick = useCallback((event) => {
    const mark = event.target.closest('mark[data-pd-id]');
    if (!mark) return;

    event.preventDefault();
    event.stopPropagation();
    onPdClick?.(mark.dataset.pdId);
  }, [onPdClick]);

  const handleContextMenu = useCallback((event) => {
    const ambiguousMark = event.target.closest('mark.ambiguous-person');
    const uncertainMark = event.target.closest('mark.uncertain');
    const pdMark = event.target.closest('mark[data-pd-id]');

    if (ambiguousMark) {
      event.preventDefault();
      setCtxMenu({ x: event.clientX, y: event.clientY, mark: ambiguousMark, type: 'ambiguous' });
      return;
    }

    if (uncertainMark) {
      event.preventDefault();
      setCtxMenu({ x: event.clientX, y: event.clientY, mark: uncertainMark, type: 'uncertain' });
      return;
    }

    if (pdMark) {
      event.preventDefault();
      setCtxMenu({ x: event.clientX, y: event.clientY, mark: pdMark, type: 'pd' });
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const fragment = range.cloneContents();
    if (fragment.querySelector('mark')) return;

    event.preventDefault();
    setCtxMenu({ x: event.clientX, y: event.clientY, type: 'selection', range: range.cloneRange() });
  }, []);

  const contextActions = useMemo(
    () =>
      createRichEditorContextActions({
        ctxMenu,
        notifyChange,
        setCtxMenu,
        onUncertainResolved,
        onRemoveAmbiguousMark,
        onRemovePdMark,
        onAttachPdMark,
        onAddPdMark,
      }),
    [
      ctxMenu,
      notifyChange,
      onAddPdMark,
      onAttachPdMark,
      onRemoveAmbiguousMark,
      onRemovePdMark,
      onUncertainResolved,
    ],
  );

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      exec(event.shiftKey ? 'outdent' : 'indent');
      return;
    }

    if (event.key !== 'Delete' && event.key !== 'Backspace') {
      return;
    }

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    if (!range.collapsed) {
      return;
    }

    const adjacentMark = findAdjacentPdMark(range, event.key);
    if (!adjacentMark) return;

    event.preventDefault();
    const pdId = adjacentMark.dataset.pdId;
    adjacentMark.parentNode.removeChild(adjacentMark);
    notifyChange();
    onRemovePdMark?.(pdId);
  }, [exec, notifyChange, onRemovePdMark]);

  return (
    <div className="rich-editor-wrap">
      <RichToolbar exec={exec} pageNavigation={pageNavigation} />

      <div
        ref={editorRef}
        className={`rich-content${highlightUncertain ? ' uncertain-highlight-active' : ''}`}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={() => {
          if (!isComposing.current) {
            notifyChange();
          }
        }}
        onCompositionStart={() => {
          isComposing.current = true;
        }}
        onCompositionEnd={() => {
          isComposing.current = false;
          notifyChange();
        }}
        onBlur={notifyChange}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />

      {ctxMenu && (
        <EditorContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          type={ctxMenu.type}
          suggestion={ctxMenu.mark?.dataset?.suggestion || ''}
          pdId={ctxMenu.mark?.dataset?.pdId || ''}
          mark={ctxMenu.mark || null}
          existingPD={existingPD}
          onRemovePd={contextActions.removePdMark}
          onApplyPdCanonicalText={onApplyPdCanonicalText}
          onEditPdMark={onEditPdMark}
          onEditPdText={onEditPdTextMark}
          onRemoveUncertain={ctxMenu.type === 'ambiguous' ? contextActions.removeAmbiguousMark : contextActions.removeUncertainMark}
          onApplySuggestion={contextActions.applyUncertainSuggestion}
          onAttachPd={contextActions.attachPdMark}
          onAddNewPd={contextActions.addNewPdMark}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
