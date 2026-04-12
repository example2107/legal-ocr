import { useCallback } from 'react';

export function useEditorPdHistoryActions({
  editorDomRef,
  initPdMarkOriginals,
  setEditorHtml,
  pdRef,
  anonRef,
  setPersonalData,
  setAnonymized,
  undoStackRef,
  undoIndexRef,
  maxUndo = 80,
} = {}) {
  const pushSnap = useCallback((snapshot) => {
    const stack = undoStackRef.current;
    const index = undoIndexRef.current;
    const next = stack.slice(0, index + 1);
    next.push(snapshot);
    if (next.length > maxUndo) next.shift();
    undoStackRef.current = next;
    undoIndexRef.current = next.length - 1;
  }, [maxUndo, undoIndexRef, undoStackRef]);

  const replaceTopSnap = useCallback((snapshot) => {
    const stack = undoStackRef.current;
    const index = undoIndexRef.current;
    if (index >= 0) stack[index] = snapshot;
  }, [undoIndexRef, undoStackRef]);

  const applySnap = useCallback((snapshot) => {
    if (editorDomRef.current) {
      editorDomRef.current.innerHTML = snapshot.html;
      initPdMarkOriginals(editorDomRef.current);
    }
    setEditorHtml(snapshot.html);
    pdRef.current = snapshot.pd;
    anonRef.current = snapshot.anon;
    setPersonalData(snapshot.pd);
    setAnonymized(snapshot.anon);
  }, [
    anonRef,
    editorDomRef,
    initPdMarkOriginals,
    pdRef,
    setAnonymized,
    setEditorHtml,
    setPersonalData,
  ]);

  const performUndo = useCallback(() => {
    const index = undoIndexRef.current;
    if (index <= 0) return;
    undoIndexRef.current = index - 1;
    applySnap(undoStackRef.current[index - 1]);
  }, [applySnap, undoIndexRef, undoStackRef]);

  const performRedo = useCallback(() => {
    const stack = undoStackRef.current;
    const index = undoIndexRef.current;
    if (index >= stack.length - 1) return;
    undoIndexRef.current = index + 1;
    applySnap(stack[index + 1]);
  }, [applySnap, undoIndexRef, undoStackRef]);

  const syncHtmlAndPushSnapshot = useCallback((fallbackHtml = '') => {
    const html = editorDomRef.current?.innerHTML ?? fallbackHtml;
    setEditorHtml(html);
    pushSnap({ html, pd: pdRef.current, anon: anonRef.current });
    return html;
  }, [anonRef, editorDomRef, pdRef, pushSnap, setEditorHtml]);

  const syncHtmlAndReplaceSnapshot = useCallback((fallbackHtml = '') => {
    const html = editorDomRef.current?.innerHTML ?? fallbackHtml;
    setEditorHtml(html);
    replaceTopSnap({ html, pd: pdRef.current, anon: anonRef.current });
    return html;
  }, [anonRef, editorDomRef, pdRef, replaceTopSnap, setEditorHtml]);

  return {
    pushSnap,
    replaceTopSnap,
    applySnap,
    performUndo,
    performRedo,
    syncHtmlAndPushSnapshot,
    syncHtmlAndReplaceSnapshot,
  };
}
