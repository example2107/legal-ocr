import { useCallback } from 'react';
import { useEditorPdHistoryActions } from './internal/useEditorPdHistoryActions';
import { useEditorPdMarkActions } from './internal/useEditorPdMarkActions';
import { useEditorPdEditActions } from './internal/useEditorPdEditActions';

export function useEditorPdActions({
  editorDomRef,
  editorHtml,
  setEditorHtml,
  personalData,
  setPersonalData,
  anonymized,
  setAnonymized,
  pdRef,
  anonRef,
  undoStackRef,
  undoIndexRef,
  maxUndo = 80,
  pdCleanupTimerRef,
  currentProjectId,
  setPdIdsInDoc,
  pdNavTimerRef,
  pdNavIndexRef,
  setPdNavState,
  setEditingPdId,
  editingPdFragment,
  setEditingPdFragment,
  removeAmbiguousEntry,
  buildPdMatchPattern,
  patchPdMarks,
  initPdMarkOriginals,
  normalizePdText,
  dedupeMentions,
  getPersonMentions,
  getOtherPdMentions,
  buildCanonicalPersonMentions,
  alphaPrivate,
  otherPdTypesMap,
} = {}) {
  const {
    pushSnap,
    replaceTopSnap,
    performUndo,
    performRedo,
    syncHtmlAndPushSnapshot,
    syncHtmlAndReplaceSnapshot,
  } = useEditorPdHistoryActions({
    editorDomRef,
    initPdMarkOriginals,
    setEditorHtml,
    pdRef,
    anonRef,
    setPersonalData,
    setAnonymized,
    undoStackRef,
    undoIndexRef,
    maxUndo,
  });

  const countUncertain = useCallback(() => {
    if (!editorDomRef.current) return 0;
    return editorDomRef.current.querySelectorAll('mark.uncertain').length;
  }, [editorDomRef]);

  const countPageSeparators = useCallback(() => {
    if (!editorDomRef.current) return 0;
    return editorDomRef.current.querySelectorAll('.part-separator').length;
  }, [editorDomRef]);

  const {
    handlePdClick,
    anonymizeAllByCategory,
    handleEditorHtmlChange,
    handleRemovePdMark,
    handleDeletePdEntry,
    handleAttachPdMark,
    handleAddPdMark,
    handleRemoveAmbiguousMark,
  } = useEditorPdMarkActions({
    editorDomRef,
    editorHtml,
    personalData,
    setEditorHtml,
    setPersonalData,
    anonymized,
    setAnonymized,
    pdRef,
    anonRef,
    pdCleanupTimerRef,
    currentProjectId,
    setPdIdsInDoc,
    pdNavTimerRef,
    pdNavIndexRef,
    setPdNavState,
    removeAmbiguousEntry,
    normalizePdText,
    dedupeMentions,
    alphaPrivate,
    otherPdTypesMap,
    patchPdMarks,
    pushSnap,
    replaceTopSnap,
    syncHtmlAndPushSnapshot,
    syncHtmlAndReplaceSnapshot,
  });

  const {
    openPdEditor,
    openPdFragmentEditor,
    handleSavePdEdit,
    handleSavePdFragmentEdit,
    handleApplyPdCanonicalText,
    handleUncertainResolved,
  } = useEditorPdEditActions({
    editorDomRef,
    editorHtml,
    personalData,
    setEditorHtml,
    setPersonalData,
    anonymized,
    pdRef,
    anonRef,
    setEditingPdId,
    editingPdFragment,
    setEditingPdFragment,
    buildPdMatchPattern,
    patchPdMarks,
    normalizePdText,
    dedupeMentions,
    getPersonMentions,
    getOtherPdMentions,
    buildCanonicalPersonMentions,
    pushSnap,
    syncHtmlAndPushSnapshot,
  });

  return {
    performUndo,
    performRedo,
    countUncertain,
    countPageSeparators,
    handlePdClick,
    anonymizeAllByCategory,
    handleEditorHtmlChange,
    handleRemovePdMark,
    handleDeletePdEntry,
    handleAttachPdMark,
    handleAddPdMark,
    handleRemoveAmbiguousMark,
    openPdEditor,
    openPdFragmentEditor,
    handleSavePdEdit,
    handleSavePdFragmentEdit,
    handleApplyPdCanonicalText,
    handleUncertainResolved,
  };
}
