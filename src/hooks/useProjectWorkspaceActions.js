import { useCallback } from 'react';
import { buildLoadedDocumentState, getClearedWorkspaceState } from '../utils/documentViewState';
import { importDocument } from '../utils/history';
import { mergeProjectDocument, saveProjectSummaryDocument } from '../utils/projectDocumentOps';
import {
  buildSourceFileKey,
  createProjectRecord,
  deleteDocumentRecord,
  deleteProjectRecord,
  removeDocumentFromProjectRecord,
  saveProjectRecord,
  updateProjectBatchSessionRecord,
  uploadSourceFile,
} from '../utils/dataStore';
import {
  extractPdIdsFromHtml,
  saveBatchProgressSnapshot,
  shouldShowLongDocWarningForEntry,
} from '../utils/appWorkspaceHelpers';

function resetBatchTracking(activeBatchControlRef) {
  activeBatchControlRef.current = {
    projectId: null,
    pauseRequested: false,
    targetView: null,
  };
}

export function useProjectWorkspaceActions({
  user,
  projects,
  history,
  currentProjectId,
  currentProject,
  projectDocs,
  projectSummaryDoc,
  refreshHistory,
  refreshProjects,
  setProjects,
  setCurrentProjectId,
  setView,
  setFiles,
  setDocxFiles,
  setPastedText,
  setInputTab,
  setError,
  setWarningMessage,
  setProgress,
  setShowUnsaved,
  setShowCreateProject,
  setNewProjectTitle,
  setShowRebuildConfirm,
  setDocId,
  setDocTitle,
  setOriginalFileName,
  setSourceFiles,
  setPageMetadata,
  setRawText,
  setEditorHtml,
  setOriginalImages,
  setShowOriginal,
  setOriginalPage,
  setEditorCurrentPage,
  setEditorTotalPages,
  setEditorPageInput,
  setPdIdsInDoc,
  setPersonalData,
  setAnonymized,
  setLastSavedState,
  setShowLongDocWarning,
  setZoomActive,
  setZoomScale,
  setZoomOffset,
  setPersistedBatchUiState,
  setActiveBatchUiState,
  buildAnnotatedHtml,
  assignLetters,
  mergePD,
  getOtherPdMentions,
  pdRef,
  anonRef,
  undoStackRef,
  undoIndexRef,
  uploadedFilesRef,
  activeBatchControlRef,
  persistedBatchUiState,
  activeBatchUiState,
  newProjectTitle,
  getProjectChunkDocKey,
  viewHome,
  viewProject,
  viewResult,
} = {}) {
  const cleanupDuplicateProjectChunkDocs = useCallback(async (projectId) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return 0;

    const docs = project.documentIds
      .map((id) => history.find((entry) => entry.id === id))
      .filter(Boolean);

    const seen = new Map();
    const duplicates = [];
    for (const doc of docs) {
      const key = getProjectChunkDocKey(doc);
      if (!key) continue;
      if (seen.has(key)) duplicates.push(doc.id);
      else seen.set(key, doc.id);
    }

    if (duplicates.length === 0) return 0;

    for (const id of duplicates) {
      await removeDocumentFromProjectRecord(user, projectId, id);
      await deleteDocumentRecord(user, id);
    }

    await refreshHistory();
    await refreshProjects();
    return duplicates.length;
  }, [getProjectChunkDocKey, history, projects, refreshHistory, refreshProjects, user]);

  const handleCreateProject = useCallback(async () => {
    if (!newProjectTitle.trim()) return;
    await createProjectRecord(user, newProjectTitle.trim());
    setNewProjectTitle('');
    setShowCreateProject(false);
    await refreshProjects();
  }, [newProjectTitle, refreshProjects, setNewProjectTitle, setShowCreateProject, user]);

  const openProject = useCallback((projectId) => {
    void cleanupDuplicateProjectChunkDocs(projectId);
    setCurrentProjectId(projectId);
    setView(viewProject);
    setFiles([]);
    setDocxFiles([]);
    setPastedText('');
    setInputTab('documents');
    setError(null);
  }, [
    cleanupDuplicateProjectChunkDocs,
    setCurrentProjectId,
    setDocxFiles,
    setError,
    setFiles,
    setInputTab,
    setPastedText,
    setView,
    viewProject,
  ]);

  const requestPauseActiveBatch = useCallback((targetView = null) => {
    if (!activeBatchControlRef.current.projectId) return false;
    activeBatchControlRef.current.pauseRequested = true;
    if (targetView) activeBatchControlRef.current.targetView = targetView;

    setActiveBatchUiState((prev) => (
      prev
        ? {
            ...prev,
            status: 'pausing',
            message: 'Пауза будет поставлена после текущей страницы.',
          }
        : prev
    ));
    return true;
  }, [activeBatchControlRef, setActiveBatchUiState]);

  const consumePauseBatchTargetView = useCallback(() => {
    const targetView = activeBatchControlRef.current.targetView || null;
    activeBatchControlRef.current.pauseRequested = false;
    activeBatchControlRef.current.targetView = null;
    return targetView;
  }, [activeBatchControlRef]);

  const clearActiveBatchTracking = useCallback(() => {
    resetBatchTracking(activeBatchControlRef);
    setActiveBatchUiState(null);
    saveBatchProgressSnapshot(null);
    setPersistedBatchUiState(null);
  }, [activeBatchControlRef, setActiveBatchUiState, setPersistedBatchUiState]);

  const saveProjectBatchSessionState = useCallback(async (session) => {
    if (!currentProjectId) return null;
    const saved = await updateProjectBatchSessionRecord(user, currentProjectId, session);
    try {
      await refreshProjects();
    } catch (error) {
      console.warn('Failed to refresh projects after saving batch session', {
        projectId: currentProjectId,
        errorMessage: error?.message || String(error),
      });
    }
    return saved;
  }, [currentProjectId, refreshProjects, user]);

  const handleDeleteProject = useCallback(async (projectId, event) => {
    if (event) event.stopPropagation();
    await deleteProjectRecord(user, projectId);
    await refreshProjects();
    if (currentProjectId === projectId) {
      setCurrentProjectId(null);
      setView(viewHome);
    }
  }, [currentProjectId, refreshProjects, setCurrentProjectId, setView, user, viewHome]);

  const handleRemoveDocFromProject = useCallback(async (docId) => {
    if (!currentProjectId) return;
    await removeDocumentFromProjectRecord(user, currentProjectId, docId);
    await refreshProjects();
  }, [currentProjectId, refreshProjects, user]);

  const handleResetProjectBatchSession = useCallback(async () => {
    if (!currentProjectId) return;
    await updateProjectBatchSessionRecord(user, currentProjectId, null);
    await refreshProjects();

    if (persistedBatchUiState?.projectId === currentProjectId) {
      saveBatchProgressSnapshot(null);
      setPersistedBatchUiState(null);
    }
    if (activeBatchUiState?.projectId === currentProjectId) {
      setActiveBatchUiState(null);
    }

    resetBatchTracking(activeBatchControlRef);
    setError(null);
  }, [
    activeBatchControlRef,
    activeBatchUiState,
    currentProjectId,
    persistedBatchUiState,
    refreshProjects,
    setActiveBatchUiState,
    setError,
    setPersistedBatchUiState,
    user,
  ]);

  const openRecognizedDocResult = useCallback((entry, images = []) => {
    const nextState = buildLoadedDocumentState({
      entry,
      images,
      currentProjectId,
      buildAnnotatedHtml,
      extractPdIdsFromHtml,
      shouldShowLongDocWarningForEntry,
    });

    setDocId(nextState.docId);
    setDocTitle(nextState.docTitle);
    setOriginalFileName(nextState.originalFileName);
    setSourceFiles(nextState.sourceFiles);
    setPageMetadata(nextState.pageMetadata);
    setRawText(nextState.rawText);
    setEditorHtml(nextState.editorHtml);
    setOriginalImages(nextState.originalImages);
    setShowOriginal(nextState.showOriginal);
    setOriginalPage(nextState.originalPage);
    setEditorCurrentPage(null);
    setEditorTotalPages(null);
    setEditorPageInput('');
    setPdIdsInDoc(nextState.pdIdsInDoc);
    pdRef.current = nextState.personalData;
    anonRef.current = nextState.anonymized;
    setPersonalData(nextState.personalData);
    setAnonymized(nextState.anonymized);
    setLastSavedState(nextState.lastSavedState);
    undoStackRef.current = [nextState.initialUndoSnapshot];
    undoIndexRef.current = 0;
    setShowLongDocWarning(nextState.showLongDocWarning);
  }, [
    anonRef,
    buildAnnotatedHtml,
    currentProjectId,
    pdRef,
    setAnonymized,
    setDocId,
    setDocTitle,
    setEditorCurrentPage,
    setEditorHtml,
    setEditorPageInput,
    setEditorTotalPages,
    setLastSavedState,
    setOriginalFileName,
    setOriginalImages,
    setOriginalPage,
    setPageMetadata,
    setPdIdsInDoc,
    setPersonalData,
    setRawText,
    setShowLongDocWarning,
    setShowOriginal,
    setSourceFiles,
    undoIndexRef,
    undoStackRef,
  ]);

  const openDocFromProject = useCallback((entry) => {
    openRecognizedDocResult(entry, []);
    setView(viewResult);
  }, [openRecognizedDocResult, setView, viewResult]);

  const mergeDocIntoProject = useCallback(async (docEntry) => (
    mergeProjectDocument({
      user,
      currentProjectId,
      docEntry,
      projectDocs,
      mergePD,
      assignLetters,
      getOtherPdMentions,
      refreshHistory,
      refreshProjects,
    })
  ), [
    assignLetters,
    currentProjectId,
    getOtherPdMentions,
    mergePD,
    projectDocs,
    refreshHistory,
    refreshProjects,
    user,
  ]);

  const handleProjectImport = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const entry = await importDocument(file);
      const mergedEntry = await mergeDocIntoProject({
        ...entry,
        projectId: currentProjectId,
      });
      openRecognizedDocResult(mergedEntry, []);
      setView(viewResult);
    } catch (error) {
      setError(error.message || 'Ошибка импорта');
    }
  }, [currentProjectId, mergeDocIntoProject, openRecognizedDocResult, setError, setView, viewResult]);

  const buildProjectSummary = useCallback(async () => (
    saveProjectSummaryDocument({
      user,
      currentProject,
      currentProjectId,
      docs: projectDocs,
      history,
      refreshHistory,
      refreshProjects,
    })
  ), [
    currentProject,
    currentProjectId,
    history,
    projectDocs,
    refreshHistory,
    refreshProjects,
    user,
  ]);

  const handleBuildSummary = useCallback(() => {
    if (projectSummaryDoc) {
      setShowRebuildConfirm(true);
      return;
    }
    void buildProjectSummary();
  }, [buildProjectSummary, projectSummaryDoc, setShowRebuildConfirm]);

  const handleConfirmRebuild = useCallback(() => {
    setShowRebuildConfirm(false);
    void buildProjectSummary();
  }, [buildProjectSummary, setShowRebuildConfirm]);

  const handleDeleteSummary = useCallback(async (event) => {
    if (event) event.stopPropagation();
    if (!projectSummaryDoc) return;
    await deleteDocumentRecord(user, projectSummaryDoc.id);
    await refreshHistory();
  }, [projectSummaryDoc, refreshHistory, user]);

  const ensureUploadedSourceFile = useCallback(async (file, projectId = null) => {
    if (!user || !file) return null;

    const key = buildSourceFileKey(file);
    if (uploadedFilesRef.current.has(key)) {
      return uploadedFilesRef.current.get(key);
    }

    try {
      const uploaded = await uploadSourceFile(user, file, { projectId });
      uploadedFilesRef.current.set(key, uploaded);
      return uploaded;
    } catch (error) {
      console.error('Source file upload failed, continuing without cloud source copy', {
        fileName: file.name,
        fileSize: file.size,
        projectId,
        errorMessage: error?.message || String(error),
      });
      uploadedFilesRef.current.set(key, null);
      setWarningMessage(`Не удалось загрузить исходный файл "${file.name}" в облако. Обработка продолжена без облачной копии исходника.`);
      return null;
    }
  }, [setWarningMessage, uploadedFilesRef, user]);

  const resetWorkingDocumentState = useCallback(() => {
    const cleared = getClearedWorkspaceState();
    setFiles(cleared.files);
    setDocxFiles([]);
    setPastedText(cleared.pastedText);
    setInputTab('documents');
    setOriginalImages(cleared.originalImages);
    setShowOriginal(cleared.showOriginal);
    setOriginalPage(cleared.originalPage);
    setZoomActive(cleared.zoomActive);
    setZoomScale(cleared.zoomScale);
    setZoomOffset(cleared.zoomOffset);
    setOriginalFileName(cleared.originalFileName);
    setSourceFiles(cleared.sourceFiles);
    setPageMetadata(cleared.pageMetadata);
    setError(cleared.error);
    setWarningMessage(null);
    setProgress(cleared.progress);
    setShowUnsaved(cleared.showUnsaved);
  }, [
    setDocxFiles,
    setError,
    setFiles,
    setInputTab,
    setOriginalFileName,
    setOriginalImages,
    setOriginalPage,
    setPageMetadata,
    setPastedText,
    setProgress,
    setShowOriginal,
    setShowUnsaved,
    setSourceFiles,
    setWarningMessage,
    setZoomActive,
    setZoomOffset,
    setZoomScale,
  ]);

  const goHomeAfterReset = useCallback(() => {
    setView(viewHome);
    resetWorkingDocumentState();
    setCurrentProjectId(null);
    void refreshHistory();
    void refreshProjects();
  }, [
    refreshHistory,
    refreshProjects,
    resetWorkingDocumentState,
    setCurrentProjectId,
    setView,
    viewHome,
  ]);

  const goBackToProjectAfterReset = useCallback(() => {
    setView(viewProject);
    resetWorkingDocumentState();
    void refreshHistory();
    void refreshProjects();
  }, [refreshHistory, refreshProjects, resetWorkingDocumentState, setView, viewProject]);

  const handleProjectTitleChange = useCallback((nextTitle) => {
    if (!currentProject) return;
    setProjects((prev) => prev.map((item) => (
      item.id === currentProject.id
        ? { ...item, title: nextTitle, updatedAt: new Date().toISOString() }
        : item
    )));
    void saveProjectRecord(user, { ...currentProject, title: nextTitle });
  }, [currentProject, setProjects, user]);

  return {
    cleanupDuplicateProjectChunkDocs,
    handleCreateProject,
    openProject,
    requestPauseActiveBatch,
    consumePauseBatchTargetView,
    clearActiveBatchTracking,
    saveProjectBatchSessionState,
    handleDeleteProject,
    handleRemoveDocFromProject,
    handleResetProjectBatchSession,
    openRecognizedDocResult,
    openDocFromProject,
    mergeDocIntoProject,
    handleProjectImport,
    handleBuildSummary,
    handleConfirmRebuild,
    handleDeleteSummary,
    ensureUploadedSourceFile,
    resetWorkingDocumentState,
    goHomeAfterReset,
    goBackToProjectAfterReset,
    handleProjectTitleChange,
  };
}
