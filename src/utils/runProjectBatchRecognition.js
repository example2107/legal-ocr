import {
  buildProjectBatchJobs,
  countRemainingChunks,
  createBatchUiStateBuilder,
} from './projectBatchRecognitionStages';
import {
  finalizeBatchFailure,
  finalizeBatchSuccess,
  processProjectBatchJobs,
} from './projectBatchRecognitionLifecycle';

export async function runProjectBatchRecognition({
  apiKey,
  files,
  currentProjectId,
  projects,
  provider,
  user,
  cleanupDuplicateProjectChunkDocs,
  saveProjectBatchSessionState,
  getProjectExistingPD,
  getProjectDocs,
  ensureUploadedSourceFile,
  mergePD,
  assignLetters,
  refreshHistory,
  refreshProjects,
  openRecognizedDocResult,
  shouldPauseBatch,
  consumePauseBatchTargetView,
  onBatchUiStateChange,
  onBatchUiStateClear,
  stopProgressCreep,
  setError,
  setView,
  setFiles,
  setProgress,
  viewProcessing,
  viewProject,
  viewResult,
}) {
  if (!apiKey.trim()) {
    setError('Введите API ключ');
    return;
  }
  if (files.length === 0) {
    setError('Добавьте хотя бы один PDF-файл или изображение');
    return;
  }
  if (!currentProjectId) return;

  setError(null);
  await cleanupDuplicateProjectChunkDocs(currentProjectId);
  setView(viewProcessing);

  const buildBatchUiState = createBatchUiStateBuilder(currentProjectId);
  const liveProject = projects.find((item) => item.id === currentProjectId) || null;
  const activeBatchSession = liveProject?.batchSession || null;
  const runtime = {
    existingPD: getProjectExistingPD(),
    activeBatchDoc: activeBatchSession?.documentId
      ? (getProjectDocs().find((doc) => doc.id === activeBatchSession.documentId) || null)
      : null,
    lastSavedDoc: null,
    failedSession: null,
    completedChunks: 0,
  };

  try {
    const jobs = await buildProjectBatchJobs({
      activeBatchSession,
      files,
      setProgress,
      onBatchUiStateChange,
      buildBatchUiState,
    });
    const totalChunks = countRemainingChunks(jobs);

    await processProjectBatchJobs({
      jobs,
      runtime,
      context: {
        apiKey,
        currentProjectId,
        provider,
        user,
        totalChunks,
        saveProjectBatchSessionState,
        getProjectDocs,
        ensureUploadedSourceFile,
        mergePD,
        assignLetters,
        refreshHistory,
        refreshProjects,
        shouldPauseBatch,
        consumePauseBatchTargetView,
        onBatchUiStateChange,
        buildBatchUiState,
        stopProgressCreep,
        setProgress,
      },
    });

    if (runtime.failedSession?.status === 'paused') return;

    await finalizeBatchSuccess({
      stopProgressCreep,
      saveProjectBatchSessionState,
      onBatchUiStateClear,
      setFiles,
      openRecognizedDocResult,
      lastSavedDoc: runtime.lastSavedDoc,
      setView,
      setProgress,
      viewResult,
    });
  } catch (error) {
    await finalizeBatchFailure({
      failedSession: runtime.failedSession,
      saveProjectBatchSessionState,
      onBatchUiStateChange,
      buildBatchUiState,
      stopProgressCreep,
      setError,
      setView,
      setProgress,
      viewProject,
      error,
    });
  }
}
