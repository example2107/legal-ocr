import { useEffect } from 'react';

function isUndoEvent(event) {
  return (event.key === 'z' || event.code === 'KeyZ') && !event.shiftKey;
}

function isRedoEvent(event) {
  return (
    ((event.key === 'z' || event.code === 'KeyZ') && event.shiftKey)
    || event.key === 'y'
    || event.code === 'KeyY'
  );
}

function isTextInputFocused() {
  const tag = document.activeElement?.tagName ?? '';
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

export function useGlobalUndoShortcuts({
  undoStackRef,
  performUndo,
  performRedo,
} = {}) {
  useEffect(() => {
    const handler = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const isUndo = isUndoEvent(event);
      const isRedo = isRedoEvent(event);

      if (!isUndo && !isRedo) return;
      if (isTextInputFocused()) return;
      if (undoStackRef.current.length === 0) return;

      event.preventDefault();
      if (isUndo) performUndo();
      else performRedo();
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  });
}
