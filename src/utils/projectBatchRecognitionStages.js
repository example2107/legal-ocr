import { getPdfPageCount } from './pdfUtils';
import {
  PROJECT_BATCH_CHUNK_SIZE,
  PROJECT_BATCH_SOURCE_IMAGE,
  PROJECT_BATCH_SOURCE_PDF,
  updateProjectPdfBatchSession,
  isSameProjectImageBatchFiles,
  isSameProjectPdfBatchFile,
} from './projectBatch';

export function getReadableErrorMessage(error) {
  if (!error) return 'Произошла ошибка';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}

function isTransientNetworkError(error) {
  const message = getReadableErrorMessage(error).toLowerCase();
  return (
    message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('fetch failed')
    || message.includes('load failed')
    || message.includes('network request failed')
    || message.includes('the internet connection appears to be offline')
  );
}

function buildStageError(stageLabel, error) {
  const message = getReadableErrorMessage(error);
  return new Error(`${stageLabel}: ${message}`);
}

export function createBatchUiStateBuilder(projectId) {
  return ({
    session = null,
    fileName = '',
    progressPercent = null,
    message = '',
    status = null,
    error = '',
  } = {}) => ({
    projectId,
    fileName: fileName || session?.fileName || '',
    sourceKind: session?.sourceKind || PROJECT_BATCH_SOURCE_PDF,
    totalPages: session?.totalPages || 0,
    nextPage: session?.nextPage || 1,
    currentPageFrom: session?.currentPageFrom || null,
    currentPageTo: session?.currentPageTo || null,
    progressPercent,
    message,
    status: status || session?.status || 'running',
    error: error || session?.error || '',
  });
}

export function emitBatchUiState(onBatchUiStateChange, snapshot) {
  onBatchUiStateChange?.(snapshot || null);
}

export function setNonDecreasingProgress(setProgress, next) {
  setProgress((prev) => (prev && prev.percent > next.percent ? { ...prev, message: next.message } : next));
}

export async function runStage(stageLabel, action, options = {}) {
  const { retryNetwork = false, onRetry = null } = options;
  const maxAttempts = retryNetwork ? 2 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      const shouldRetry = retryNetwork && attempt < maxAttempts && isTransientNetworkError(error);
      if (shouldRetry) {
        onRetry?.(attempt, error);
        continue;
      }
      throw buildStageError(stageLabel, error);
    }
  }

  throw new Error(stageLabel);
}

export async function runSoftRefresh(stageLabel, action) {
  try {
    await runStage(stageLabel, action, { retryNetwork: true });
  } catch (error) {
    console.warn('Project batch soft refresh failed', {
      stageLabel,
      errorMessage: getReadableErrorMessage(error),
    });
  }
}

export function getOverallPercent(totalChunks, completedChunks, chunkPercent = 0) {
  const safeTotal = Math.max(1, totalChunks);
  const base = 12 + (completedChunks / safeTotal) * 84;
  const current = (chunkPercent / 100) * (84 / safeTotal);
  return Math.max(12, Math.min(98, Math.round(base + current)));
}

export function countRemainingChunks(jobs) {
  const totalChunks = jobs.reduce((sum, job) => {
    const startPage = job.session?.nextPage || 1;
    return sum + Math.ceil(Math.max(0, job.totalPages - startPage + 1) / PROJECT_BATCH_CHUNK_SIZE);
  }, 0);

  return Math.max(1, totalChunks);
}

export async function buildProjectBatchJobs({
  activeBatchSession,
  files,
  setProgress,
  onBatchUiStateChange,
  buildBatchUiState,
}) {
  const pdfFiles = files.filter((file) => file.type === 'application/pdf');
  const imageFiles = files.filter((file) => file.type.startsWith('image/'));
  const jobs = [];

  if (activeBatchSession && activeBatchSession.status !== 'completed') {
    if ((activeBatchSession.sourceKind || PROJECT_BATCH_SOURCE_PDF) === PROJECT_BATCH_SOURCE_IMAGE) {
      if (!isSameProjectImageBatchFiles(activeBatchSession, files)) {
        throw new Error('Для продолжения выберите тот же набор изображений в том же порядке. Если хотите начать другой набор, сначала сбросьте незавершённую обработку.');
      }
      return [{
        kind: PROJECT_BATCH_SOURCE_IMAGE,
        files,
        totalPages: activeBatchSession.totalPages,
        session: updateProjectPdfBatchSession(activeBatchSession, { status: 'running', error: '' }),
      }];
    }

    if (files.length !== 1) {
      throw new Error('Для продолжения выберите только тот PDF-файл, обработка которого была прервана.');
    }
    if (!isSameProjectPdfBatchFile(activeBatchSession, files[0])) {
      throw new Error('Для продолжения выберите тот же PDF-файл, который обрабатывался ранее. Если хотите начать другой файл, сначала сбросьте незавершённую обработку.');
    }
    return [{
      kind: PROJECT_BATCH_SOURCE_PDF,
      file: files[0],
      totalPages: activeBatchSession.totalPages,
      session: updateProjectPdfBatchSession(activeBatchSession, { status: 'running', error: '' }),
    }];
  }

  const totalSelectable = pdfFiles.length + imageFiles.length;
  if (totalSelectable !== files.length) {
    throw new Error('В режиме пакетной обработки поддерживаются только PDF-файлы и изображения.');
  }

  if (pdfFiles.length > 0) {
    setNonDecreasingProgress(setProgress, { percent: 2, message: 'Подсчёт страниц PDF...' });
    for (let index = 0; index < pdfFiles.length; index += 1) {
      const file = pdfFiles[index];
      const totalPages = await getPdfPageCount(file);
      const progressPercent = Math.round(2 + ((index + 1) / Math.max(1, totalSelectable)) * 8);
      const message = `Подсчёт страниц: ${file.name} (${totalPages} стр.)`;

      setNonDecreasingProgress(setProgress, { percent: progressPercent, message });
      emitBatchUiState(onBatchUiStateChange, buildBatchUiState({
        fileName: file.name,
        progressPercent,
        message,
        status: 'running',
      }));
      jobs.push({ kind: PROJECT_BATCH_SOURCE_PDF, file, totalPages, session: null });
    }
  }

  if (imageFiles.length > 0) {
    const message = imageFiles.length === 1
      ? `Подготовка изображения: ${imageFiles[0].name}`
      : `Подготовка набора изображений: ${imageFiles.length} файлов`;
    emitBatchUiState(onBatchUiStateChange, buildBatchUiState({
      fileName: imageFiles.length === 1 ? imageFiles[0].name : `Изображения (${imageFiles.length})`,
      progressPercent: 10,
      message,
      status: 'running',
    }));
    setNonDecreasingProgress(setProgress, { percent: 10, message });
    jobs.push({
      kind: PROJECT_BATCH_SOURCE_IMAGE,
      files: imageFiles,
      totalPages: imageFiles.length,
      session: null,
    });
  }

  return jobs;
}

export function getJobDisplayName(job) {
  if (job.kind === PROJECT_BATCH_SOURCE_IMAGE) {
    const imageBatchFiles = job.files || [];
    return imageBatchFiles.length === 1
      ? imageBatchFiles[0]?.name || 'Изображение'
      : `Изображения (${imageBatchFiles.length})`;
  }
  return job.file?.name || 'PDF';
}
