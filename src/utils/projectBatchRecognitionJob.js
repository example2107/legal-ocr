import { imageFileToBase64, pdfToImagesRange } from './pdfUtils';
import { recognizeDocument } from './claudeApi';
import { buildAnnotatedHtml } from '../components/RichEditor';
import { buildDocumentPageMetadata } from './documentPageMetadata';
import { generateId } from './history';
import {
  addDocumentToProjectRecord,
  saveDocumentRecord,
  updateProjectSharedPDRecord,
} from './dataStore';
import {
  PROJECT_BATCH_CHUNK_SIZE,
  PROJECT_BATCH_SOURCE_IMAGE,
  PROJECT_BATCH_SOURCE_PDF,
  formatProjectChunkPageRange,
  getProjectPdfChunkEnd,
  updateProjectPdfBatchSession,
} from './projectBatch';
import { buildProjectBatchDocumentEntry } from './projectDocumentOps';
import {
  emitBatchUiState,
  getOverallPercent,
  getJobDisplayName,
  runSoftRefresh,
  runStage,
  setNonDecreasingProgress,
} from './projectBatchRecognitionStages';

async function renderChunkContent({
  job,
  sessionSnapshot,
  pageFrom,
  pageTo,
  displayName,
  rangeLabel,
  getCurrentPercent,
  setProgress,
  onBatchUiStateChange,
  buildBatchUiState,
  file,
  imageBatchFiles,
  currentProjectId,
  ensureUploadedSourceFile,
}) {
  let chunkSourceFile = file;
  const chunkImages = job.kind === PROJECT_BATCH_SOURCE_IMAGE
    ? []
    : await pdfToImagesRange(job.file, pageFrom, pageTo, (pageNumInFile) => {
      const rendered = Math.max(0, pageNumInFile - pageFrom + 1);
      const pagesInChunk = Math.max(1, pageTo - pageFrom + 1);
      const innerPercent = Math.round((rendered / pagesInChunk) * 18);
      const percent = getCurrentPercent(innerPercent);
      const message = pagesInChunk > 1
        ? `${displayName}: рендер ${rangeLabel} (${rendered}/${pagesInChunk})...`
        : `${displayName}: рендер ${rangeLabel}...`;

      setNonDecreasingProgress(setProgress, { percent, message });
      emitBatchUiState(onBatchUiStateChange, buildBatchUiState({
        session: sessionSnapshot,
        fileName: displayName,
        progressPercent: percent,
        message,
        status: 'running',
      }));
    });

  if (job.kind !== PROJECT_BATCH_SOURCE_IMAGE) {
    return { chunkImages, chunkSourceFile };
  }

  const currentImageFile = imageBatchFiles[pageFrom - 1];
  const message = imageBatchFiles.length > 1
    ? `${displayName}: подготовка ${rangeLabel} (${currentImageFile?.name || 'изображение'})...`
    : `${currentImageFile?.name || 'Изображение'}: подготовка...`;
  const progressPercent = getCurrentPercent(18);

  setNonDecreasingProgress(setProgress, { percent: progressPercent, message });
  emitBatchUiState(onBatchUiStateChange, buildBatchUiState({
    session: sessionSnapshot,
    fileName: displayName,
    progressPercent,
    message,
    status: 'running',
  }));
  chunkSourceFile = await runStage(`Не удалось подготовить исходный файл ${currentImageFile?.name || 'изображение'}`, () => (
    ensureUploadedSourceFile(currentImageFile, currentProjectId)
  ), { retryNetwork: true });

  const imageData = await imageFileToBase64(currentImageFile);
  chunkImages.push({
    ...imageData,
    pageNum: pageFrom,
    totalPages: sessionSnapshot.totalPages,
  });

  return { chunkImages, chunkSourceFile };
}

async function recognizeChunk({
  chunkImages,
  apiKey,
  provider,
  existingPD,
  displayName,
  rangeLabel,
  sessionSnapshot,
  getCurrentPercent,
  setProgress,
  onBatchUiStateChange,
  buildBatchUiState,
  currentProjectId,
  pageFrom,
  pageTo,
  chunkSizeSnapshot,
}) {
  try {
    return await runStage(`Не удалось распознать ${rangeLabel}`, () => recognizeDocument(
      chunkImages,
      apiKey.trim(),
      provider,
      (progressSnapshot) => {
        const chunkPercent = progressSnapshot.percent != null
          ? Math.round(progressSnapshot.percent)
          : (progressSnapshot.stage === 'done' ? 100 : 50);
        const percent = getCurrentPercent(Math.max(20, chunkPercent));
        const message = `${displayName}: ${progressSnapshot.message} (${rangeLabel})`;

        setProgress((prev) => (prev && prev.percent > percent ? { ...prev, message } : { percent, message }));
        emitBatchUiState(onBatchUiStateChange, buildBatchUiState({
          session: sessionSnapshot,
          fileName: displayName,
          progressPercent: percent,
          message,
          status: 'running',
        }));
      },
      existingPD,
    ), {
      retryNetwork: true,
      onRetry: () => {
        const percent = getCurrentPercent(20);
        const message = `${displayName}: повторная попытка распознавания ${rangeLabel}...`;
        setNonDecreasingProgress(setProgress, { percent, message });
        emitBatchUiState(onBatchUiStateChange, buildBatchUiState({
          session: sessionSnapshot,
          fileName: displayName,
          progressPercent: percent,
          message,
          status: 'running',
        }));
      },
    });
  } catch (error) {
    console.error('Project batch recognition failed', {
      provider,
      projectId: currentProjectId,
      fileName: displayName,
      rangeLabel,
      pageFrom,
      pageTo,
      totalPages: sessionSnapshot.totalPages,
      chunkIndex: Math.ceil(pageFrom / chunkSizeSnapshot),
      chunkSize: chunkSizeSnapshot,
      renderedPages: chunkImages.map((image) => ({
        pageNum: image.pageNum,
        base64Length: image.base64?.length || 0,
        mediaType: image.mediaType || '',
        textSource: image.textSource || '',
      })),
      errorMessage: error?.message || String(error),
    });
    throw error;
  }
}

function buildChunkDocumentEntry({
  result,
  pd,
  chunkSourceFile,
  chunkImages,
  currentProjectId,
  job,
  displayName,
  pageFrom,
  pageTo,
  sessionSnapshot,
  chunkSizeSnapshot,
}) {
  const entryTitle = job.kind === PROJECT_BATCH_SOURCE_IMAGE
    ? (job.files?.[pageFrom - 1]?.name || displayName)
    : (job.file?.name || displayName);
  const initialAnon = {};
  const html = buildAnnotatedHtml(result.text, pd, initialAnon);

  return {
    id: generateId(),
    title: entryTitle,
    originalFileName: entryTitle,
    text: result.text,
    editedHtml: html,
    personalData: pd,
    anonymized: initialAnon,
    source: job.kind === PROJECT_BATCH_SOURCE_IMAGE ? 'image' : 'ocr',
    projectId: currentProjectId,
    pageFrom,
    pageTo,
    totalPages: sessionSnapshot.totalPages,
    chunkIndex: Math.ceil(pageFrom / chunkSizeSnapshot),
    chunkSize: chunkSizeSnapshot,
    batchFileName: job.kind === PROJECT_BATCH_SOURCE_IMAGE ? displayName : (job.file?.name || displayName),
    sourceFiles: chunkSourceFile ? [chunkSourceFile] : [],
    pageMetadata: buildDocumentPageMetadata({
      sourceFile: chunkSourceFile,
      batchFileName: job.kind === PROJECT_BATCH_SOURCE_IMAGE ? displayName : (job.file?.name || displayName),
      projectId: currentProjectId,
      pageFrom,
      pageTo,
      totalPages: sessionSnapshot.totalPages,
      pages: chunkImages,
    }),
  };
}

async function saveChunkDocument({
  user,
  currentProjectId,
  sessionSnapshot,
  pageDocEntry,
  existingBatchDoc,
  pd,
  rangeLabel,
  displayName,
  getCurrentPercent,
  setProgress,
  onBatchUiStateChange,
  buildBatchUiState,
  refreshHistory,
  refreshProjects,
}) {
  const nextDocEntry = buildProjectBatchDocumentEntry({
    existingDoc: existingBatchDoc,
    pageEntry: pageDocEntry,
    currentProjectId,
    pd,
    getOtherPdMentions: (item) => [item?.value, ...(item?.mentions || [])].filter(Boolean),
  });

  const docEntry = await runStage(`Не удалось сохранить ${rangeLabel}`, () => (
    saveDocumentRecord(user, nextDocEntry)
  ), {
    retryNetwork: true,
    onRetry: () => {
      const percent = getCurrentPercent(92);
      const message = `${displayName}: повторная попытка сохранения ${rangeLabel}...`;
      setNonDecreasingProgress(setProgress, { percent, message });
      emitBatchUiState(onBatchUiStateChange, buildBatchUiState({
        session: sessionSnapshot,
        fileName: displayName,
        progressPercent: percent,
        message,
        status: 'running',
      }));
    },
  });

  if (!existingBatchDoc) {
    await runStage(`Не удалось добавить ${rangeLabel} в проект`, () => (
      addDocumentToProjectRecord(user, currentProjectId, docEntry.id)
    ), { retryNetwork: true });
  }

  await runStage(`Не удалось обновить персональные данные проекта после ${rangeLabel}`, () => (
    updateProjectSharedPDRecord(user, currentProjectId, pd)
  ), { retryNetwork: true });
  await runSoftRefresh(`Не удалось обновить историю после ${rangeLabel}`, () => refreshHistory());
  await runSoftRefresh(`Не удалось обновить список проектов после ${rangeLabel}`, () => refreshProjects());

  return docEntry;
}

async function pauseBatchIfRequested({
  shouldPauseBatch,
  session,
  fileName,
  saveProjectBatchSessionState,
  onBatchUiStateChange,
  buildBatchUiState,
  stopProgressCreep,
  setProgress,
  consumePauseBatchTargetView,
  totalChunks,
  completedChunks,
}) {
  if (!shouldPauseBatch?.()) return { paused: false, pausedSession: null };

  const sourceKind = session?.sourceKind || PROJECT_BATCH_SOURCE_PDF;
  const pausedSession = updateProjectPdfBatchSession(session, {
    status: 'paused',
    error: '',
    progressPercent: getOverallPercent(totalChunks, completedChunks, 100),
    progressMessage: `Обработка приостановлена. Следующий запуск начнётся с ${formatProjectChunkPageRange(session.nextPage, getProjectPdfChunkEnd(session.nextPage, session.totalPages, session.chunkSize), session.totalPages, sourceKind)}.`,
  });

  await saveProjectBatchSessionState(pausedSession);
  emitBatchUiState(onBatchUiStateChange, buildBatchUiState({
    session: pausedSession,
    fileName,
    progressPercent: pausedSession.progressPercent,
    message: pausedSession.progressMessage,
    status: 'paused',
  }));
  stopProgressCreep();
  setProgress({
    percent: pausedSession.progressPercent ?? getOverallPercent(totalChunks, completedChunks, 100),
    message: `${fileName}: обработка приостановлена`,
  });
  consumePauseBatchTargetView?.();

  return { paused: true, pausedSession };
}

export async function processBatchChunk({
  job,
  session,
  pageFrom,
  runtime,
  context,
}) {
  const { currentProjectId, apiKey, provider, user } = context;
  const { onBatchUiStateChange, buildBatchUiState } = context;
  const { setProgress, stopProgressCreep } = context;
  const { saveProjectBatchSessionState, refreshHistory, refreshProjects } = context;
  const { mergePD, assignLetters, ensureUploadedSourceFile } = context;
  const { shouldPauseBatch, consumePauseBatchTargetView } = context;
  const displayName = getJobDisplayName(job);
  const pageTo = getProjectPdfChunkEnd(pageFrom, session.totalPages, session.chunkSize || PROJECT_BATCH_CHUNK_SIZE);
  const rangeLabel = formatProjectChunkPageRange(pageFrom, pageTo, session.totalPages, job.kind);
  const chunkSizeSnapshot = session.chunkSize || PROJECT_BATCH_CHUNK_SIZE;
  const getCurrentPercent = (chunkPercent = 0) => getOverallPercent(context.totalChunks, runtime.completedChunks, chunkPercent);

  let updatedSession = updateProjectPdfBatchSession(session, {
    status: 'running',
    error: '',
    nextPage: pageFrom,
    currentPageFrom: pageFrom,
    currentPageTo: pageTo,
  });
  runtime.failedSession = updatedSession;

  await runStage(`Не удалось обновить состояние обработки для ${rangeLabel}`, () => (
    saveProjectBatchSessionState(updatedSession)
  ), { retryNetwork: true });

  setNonDecreasingProgress(setProgress, {
    percent: getCurrentPercent(0),
    message: `${displayName}: подготовка ${rangeLabel}...`,
  });
  emitBatchUiState(onBatchUiStateChange, buildBatchUiState({
    session: updatedSession,
    fileName: displayName,
    progressPercent: getCurrentPercent(0),
    message: `${displayName}: подготовка ${rangeLabel}...`,
    status: 'running',
  }));

  const uploadedSourceFile = await renderChunkContent({
    job,
    sessionSnapshot: updatedSession,
    pageFrom,
    pageTo,
    displayName,
    rangeLabel,
    getCurrentPercent,
    setProgress,
    onBatchUiStateChange,
    buildBatchUiState,
    file: context.jobSourceFile,
    imageBatchFiles: job.files || [],
    currentProjectId,
    ensureUploadedSourceFile,
  });

  const result = await recognizeChunk({
    chunkImages: uploadedSourceFile.chunkImages,
    apiKey,
    provider,
    existingPD: runtime.existingPD,
    displayName,
    rangeLabel,
    sessionSnapshot: updatedSession,
    getCurrentPercent,
    setProgress,
    onBatchUiStateChange,
    buildBatchUiState,
    currentProjectId,
    pageFrom,
    pageTo,
    chunkSizeSnapshot,
  });

  const pd = runtime.existingPD
    ? assignLetters(mergePD(runtime.existingPD, result.personalData), runtime.existingPD)
    : assignLetters(result.personalData);
  const pageDocEntry = buildChunkDocumentEntry({
    result,
    pd,
    chunkSourceFile: uploadedSourceFile.chunkSourceFile,
    chunkImages: uploadedSourceFile.chunkImages,
    currentProjectId,
    job,
    displayName,
    pageFrom,
    pageTo,
    sessionSnapshot: updatedSession,
    chunkSizeSnapshot,
  });
  const docEntry = await saveChunkDocument({
    user,
    currentProjectId,
    sessionSnapshot: updatedSession,
    pageDocEntry,
    existingBatchDoc: runtime.activeBatchDoc,
    pd,
    rangeLabel,
    displayName,
    getCurrentPercent,
    setProgress,
    onBatchUiStateChange,
    buildBatchUiState,
    refreshHistory,
    refreshProjects,
  });

  runtime.activeBatchDoc = docEntry;
  runtime.lastSavedDoc = docEntry;
  runtime.existingPD = pd;
  runtime.completedChunks += 1;

  updatedSession = updateProjectPdfBatchSession(updatedSession, {
    documentId: docEntry.id,
    documentTitle: docEntry.title,
    nextPage: pageTo + 1,
    status: pageTo >= updatedSession.totalPages ? 'completed' : 'running',
    error: '',
    currentPageFrom: pageFrom,
    currentPageTo: pageTo,
    progressPercent: getCurrentPercent(100),
    progressMessage: `${displayName}: распознано ${rangeLabel}.`,
  });

  await runStage(`Не удалось сохранить прогресс после ${rangeLabel}`, () => (
    saveProjectBatchSessionState(pageTo >= updatedSession.totalPages ? null : updatedSession)
  ), { retryNetwork: true });
  runtime.failedSession = pageTo >= updatedSession.totalPages ? null : updatedSession;

  if (pageTo < updatedSession.totalPages) {
    const pauseState = await pauseBatchIfRequested({
      shouldPauseBatch,
      session: updatedSession,
      fileName: displayName,
      saveProjectBatchSessionState,
      onBatchUiStateChange,
      buildBatchUiState,
      stopProgressCreep,
      setProgress,
      consumePauseBatchTargetView,
      totalChunks: context.totalChunks,
      completedChunks: runtime.completedChunks,
    });
    if (pauseState.paused) {
      runtime.failedSession = pauseState.pausedSession;
      return { session: updatedSession, paused: true };
    }
  }

  return { session: updatedSession, paused: false };
}
