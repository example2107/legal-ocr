import {
  PROJECT_BATCH_CHUNK_SIZE,
  PROJECT_BATCH_SOURCE_IMAGE,
  createProjectImageBatchSession,
  createProjectPdfBatchSession,
  updateProjectPdfBatchSession,
} from './projectBatch';
import {
  emitBatchUiState,
  getJobDisplayName,
  runStage,
  setNonDecreasingProgress,
} from './projectBatchRecognitionStages';
import { processBatchChunk } from './projectBatchRecognitionJob';

async function ensureUploadedJobSourceFile({
  job,
  currentProjectId,
  ensureUploadedSourceFile,
  setProgress,
  onBatchUiStateChange,
  buildBatchUiState,
}) {
  if (!job.file) return null;

  return runStage(`Не удалось подготовить исходный файл ${job.file.name}`, () => (
    ensureUploadedSourceFile(job.file, currentProjectId)
  ), {
    retryNetwork: true,
    onRetry: () => {
      const message = `${job.file.name}: повторная попытка подготовки исходного файла...`;
      setNonDecreasingProgress(setProgress, { percent: 12, message });
      emitBatchUiState(onBatchUiStateChange, buildBatchUiState({
        fileName: job.file.name,
        progressPercent: 12,
        message,
        status: 'running',
      }));
    },
  });
}

async function initializeJobSession({
  job,
  displayName,
  getProjectDocs,
  saveProjectBatchSessionState,
  onBatchUiStateChange,
  buildBatchUiState,
}) {
  let session = job.session || (
    job.kind === PROJECT_BATCH_SOURCE_IMAGE
      ? createProjectImageBatchSession(job.files || [], getProjectDocs().length + 1)
      : createProjectPdfBatchSession(job.file, job.totalPages, getProjectDocs().length + 1)
  );

  session = updateProjectPdfBatchSession(session, { status: 'running', error: '' });
  await runStage(`Не удалось сохранить состояние обработки для ${displayName}`, () => (
    saveProjectBatchSessionState(session)
  ), { retryNetwork: true });
  emitBatchUiState(onBatchUiStateChange, buildBatchUiState({
    session,
    fileName: displayName,
    progressPercent: 12,
    message: `${displayName}: подготовка...`,
    status: 'running',
  }));

  return session;
}

async function processBatchJob({
  job,
  runtime,
  context,
}) {
  const displayName = getJobDisplayName(job);
  const jobSourceFile = await ensureUploadedJobSourceFile({
    job,
    currentProjectId: context.currentProjectId,
    ensureUploadedSourceFile: context.ensureUploadedSourceFile,
    setProgress: context.setProgress,
    onBatchUiStateChange: context.onBatchUiStateChange,
    buildBatchUiState: context.buildBatchUiState,
  });

  let session = await initializeJobSession({
    job,
    displayName,
    getProjectDocs: context.getProjectDocs,
    saveProjectBatchSessionState: context.saveProjectBatchSessionState,
    onBatchUiStateChange: context.onBatchUiStateChange,
    buildBatchUiState: context.buildBatchUiState,
  });

  for (
    let pageFrom = session.nextPage || 1;
    pageFrom <= session.totalPages;
    pageFrom += session.chunkSize || PROJECT_BATCH_CHUNK_SIZE
  ) {
    const result = await processBatchChunk({
      job,
      session,
      pageFrom,
      runtime,
      context: {
        ...context,
        jobSourceFile,
      },
    });
    session = result.session;
    if (result.paused) return;
  }
}

export async function processProjectBatchJobs({
  jobs,
  runtime,
  context,
}) {
  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
    await processBatchJob({
      job: jobs[jobIndex],
      runtime,
      context,
    });

    if (runtime.failedSession?.status === 'paused') return;
  }
}

export async function finalizeBatchSuccess({
  stopProgressCreep,
  saveProjectBatchSessionState,
  onBatchUiStateClear,
  setFiles,
  openRecognizedDocResult,
  lastSavedDoc,
  setView,
  setProgress,
  viewResult,
}) {
  stopProgressCreep();
  await runStage('Не удалось завершить batch-сессию проекта', () => (
    saveProjectBatchSessionState(null)
  ), { retryNetwork: true });
  onBatchUiStateClear?.();
  setFiles([]);
  if (lastSavedDoc) openRecognizedDocResult(lastSavedDoc, []);
  setTimeout(() => {
    setView(viewResult);
    setProgress(null);
  }, 400);
}

export async function finalizeBatchFailure({
  failedSession,
  saveProjectBatchSessionState,
  onBatchUiStateChange,
  buildBatchUiState,
  stopProgressCreep,
  setError,
  setView,
  setProgress,
  viewProject,
  error,
}) {
  stopProgressCreep();
  if (failedSession) {
    await saveProjectBatchSessionState(updateProjectPdfBatchSession(failedSession, {
      status: 'failed',
      error: error.message || 'Произошла ошибка',
    }));
    emitBatchUiState(onBatchUiStateChange, buildBatchUiState({
      session: failedSession,
      fileName: failedSession.fileName || '',
      progressPercent: failedSession.progressPercent ?? null,
      message: failedSession.progressMessage || '',
      status: 'failed',
      error: error.message || 'Произошла ошибка',
    }));
  }
  setError(error.message || 'Произошла ошибка');
  setView(viewProject);
  setProgress(null);
}
