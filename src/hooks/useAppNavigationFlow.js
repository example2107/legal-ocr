import { useCallback } from 'react';

export function useAppNavigationFlow({
  view,
  viewProcessing,
  viewResult,
  requestPauseActiveBatch,
  goHomeAfterReset,
  goBackToProjectAfterReset,
  isDirty,
  setShowUnsaved,
  pendingNavRef,
  handleSave,
} = {}) {
  const goHome = useCallback(() => {
    if (view === viewProcessing && requestPauseActiveBatch('home')) {
      goHomeAfterReset();
      return;
    }

    if (view === viewResult && isDirty()) {
      setShowUnsaved(true);
      pendingNavRef.current = 'home';
      return;
    }

    goHomeAfterReset();
  }, [
    goHomeAfterReset,
    isDirty,
    pendingNavRef,
    requestPauseActiveBatch,
    setShowUnsaved,
    view,
    viewProcessing,
    viewResult,
  ]);

  const goBackToProject = useCallback(() => {
    if (view === viewProcessing && requestPauseActiveBatch('project')) {
      goBackToProjectAfterReset();
      return;
    }

    if (view === viewResult && isDirty()) {
      setShowUnsaved(true);
      pendingNavRef.current = 'project';
      return;
    }

    goBackToProjectAfterReset();
  }, [
    goBackToProjectAfterReset,
    isDirty,
    pendingNavRef,
    requestPauseActiveBatch,
    setShowUnsaved,
    view,
    viewProcessing,
    viewResult,
  ]);

  const handleUnsavedSave = useCallback(async () => {
    await handleSave();
    setShowUnsaved(false);

    if (pendingNavRef.current === 'home') {
      goHomeAfterReset();
    } else if (pendingNavRef.current === 'project') {
      goBackToProjectAfterReset();
    }

    pendingNavRef.current = null;
  }, [
    goBackToProjectAfterReset,
    goHomeAfterReset,
    handleSave,
    pendingNavRef,
    setShowUnsaved,
  ]);

  const handleUnsavedDiscard = useCallback(() => {
    setShowUnsaved(false);

    if (pendingNavRef.current === 'home') {
      goHomeAfterReset();
    } else if (pendingNavRef.current === 'project') {
      goBackToProjectAfterReset();
    }

    pendingNavRef.current = null;
  }, [
    goBackToProjectAfterReset,
    goHomeAfterReset,
    pendingNavRef,
    setShowUnsaved,
  ]);

  return {
    goHome,
    goBackToProject,
    handleUnsavedSave,
    handleUnsavedDiscard,
  };
}
