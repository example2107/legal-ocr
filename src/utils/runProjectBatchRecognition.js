import { getPdfPageCount, imageFileToBase64, pdfToImagesRange } from './pdfUtils';
import { recognizeDocument } from './claudeApi';
import { buildAnnotatedHtml } from '../components/RichEditor';
import { buildDocumentCoordinateLayer } from './documentCoordinateLayer';
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
  createProjectPdfBatchSession,
  createProjectImageBatchSession,
  formatProjectChunkPageRange,
  getProjectPdfChunkEnd,
  isSameProjectImageBatchFiles,
  isSameProjectPdfBatchFile,
  updateProjectPdfBatchSession,
} from './projectBatch';
import { buildProjectBatchDocumentEntry } from './projectDocumentOps';

function getReadableErrorMessage(error) {
  if (!error) return 'Произошла ошибка';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}

function isTransientNetworkError(error) {
  const message = getReadableErrorMessage(error).toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('fetch failed') ||
    message.includes('load failed') ||
    message.includes('network request failed') ||
    message.includes('the internet connection appears to be offline')
  );
}

function buildStageError(stageLabel, error) {
  const message = getReadableErrorMessage(error);
  return new Error(`${stageLabel}: ${message}`);
}

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

  let failedSession = null;
  const emitBatchUiState = (snapshot) => {
    onBatchUiStateChange?.(snapshot || null);
  };

  const buildBatchUiState = ({
    session = null,
    fileName = '',
    progressPercent = null,
    message = '',
    status = null,
    error = '',
  } = {}) => ({
    projectId: currentProjectId,
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

  try {
    const setNonDecreasingProgress = (next) => {
      setProgress(prev => prev && prev.percent > next.percent
        ? { ...prev, message: next.message }
        : next
      );
    };

    const runStage = async (stageLabel, action, options = {}) => {
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
    };

    const runSoftRefresh = async (stageLabel, action) => {
      try {
        await runStage(stageLabel, action, { retryNetwork: true });
      } catch (error) {
        console.warn('Project batch soft refresh failed', {
          stageLabel,
          errorMessage: getReadableErrorMessage(error),
        });
      }
    };

    const liveProject = projects.find((item) => item.id === currentProjectId) || null;
    const activeBatchSession = liveProject?.batchSession || null;
    const pdfFiles = files.filter((file) => file.type === 'application/pdf');
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    let jobs = [];

    if (activeBatchSession && activeBatchSession.status !== 'completed') {
      if ((activeBatchSession.sourceKind || PROJECT_BATCH_SOURCE_PDF) === PROJECT_BATCH_SOURCE_IMAGE) {
        if (!isSameProjectImageBatchFiles(activeBatchSession, files)) {
          throw new Error('Для продолжения выберите тот же набор изображений в том же порядке. Если хотите начать другой набор, сначала сбросьте незавершённую обработку.');
        }
        jobs = [{
          kind: PROJECT_BATCH_SOURCE_IMAGE,
          files,
          totalPages: activeBatchSession.totalPages,
          session: updateProjectPdfBatchSession(activeBatchSession, { status: 'running', error: '' }),
        }];
      } else {
        if (files.length !== 1) {
          throw new Error('Для продолжения выберите только тот PDF-файл, обработка которого была прервана.');
        }
        if (!isSameProjectPdfBatchFile(activeBatchSession, files[0])) {
          throw new Error('Для продолжения выберите тот же PDF-файл, который обрабатывался ранее. Если хотите начать другой файл, сначала сбросьте незавершённую обработку.');
        }
        jobs = [{
          kind: PROJECT_BATCH_SOURCE_PDF,
          file: files[0],
          totalPages: activeBatchSession.totalPages,
          session: updateProjectPdfBatchSession(activeBatchSession, { status: 'running', error: '' }),
        }];
      }
    } else {
      const totalSelectable = pdfFiles.length + imageFiles.length;
      if (totalSelectable !== files.length) {
        throw new Error('В режиме пакетной обработки поддерживаются только PDF-файлы и изображения.');
      }

      if (pdfFiles.length > 0) {
        setNonDecreasingProgress({ percent: 2, message: 'Подсчёт страниц PDF...' });
        for (let i = 0; i < pdfFiles.length; i++) {
          const file = pdfFiles[i];
          const totalPages = await getPdfPageCount(file);
          setNonDecreasingProgress({
            percent: Math.round(2 + ((i + 1) / Math.max(1, totalSelectable)) * 8),
            message: `Подсчёт страниц: ${file.name} (${totalPages} стр.)`,
          });
          emitBatchUiState(buildBatchUiState({
            fileName: file.name,
            progressPercent: Math.round(2 + ((i + 1) / Math.max(1, totalSelectable)) * 8),
            message: `Подсчёт страниц: ${file.name} (${totalPages} стр.)`,
            status: 'running',
          }));
          jobs.push({ kind: PROJECT_BATCH_SOURCE_PDF, file, totalPages, session: null });
        }
      }

      if (imageFiles.length > 0) {
        const message = imageFiles.length === 1
          ? `Подготовка изображения: ${imageFiles[0].name}`
          : `Подготовка набора изображений: ${imageFiles.length} файлов`;
        setNonDecreasingProgress({ percent: 10, message });
        emitBatchUiState(buildBatchUiState({
          fileName: imageFiles.length === 1 ? imageFiles[0].name : `Изображения (${imageFiles.length})`,
          progressPercent: 10,
          message,
          status: 'running',
        }));
        jobs.push({
          kind: PROJECT_BATCH_SOURCE_IMAGE,
          files: imageFiles,
          totalPages: imageFiles.length,
          session: null,
        });
      }
    }

    let totalChunks = jobs.reduce((sum, job) => {
      const startPage = job.session?.nextPage || 1;
      return sum + Math.ceil(Math.max(0, job.totalPages - startPage + 1) / PROJECT_BATCH_CHUNK_SIZE);
    }, 0);
    totalChunks = Math.max(1, totalChunks);

    let completedChunks = 0;
    let existingPD = getProjectExistingPD();
    let activeBatchDoc = activeBatchSession?.documentId
      ? (getProjectDocs().find((doc) => doc.id === activeBatchSession.documentId) || null)
      : null;
    let lastSavedDoc = null;

    const getOverallPercent = (chunkPercent = 0) => {
      const safeTotal = Math.max(1, totalChunks);
      const base = 12 + (completedChunks / safeTotal) * 84;
      const current = (chunkPercent / 100) * (84 / safeTotal);
      return Math.max(12, Math.min(98, Math.round(base + current)));
    };

    const pauseBatchIfRequested = async (session, fileName, fallbackView = viewProject) => {
      if (!shouldPauseBatch?.()) return false;
      const sourceKind = session?.sourceKind || PROJECT_BATCH_SOURCE_PDF;
      const pausedSession = updateProjectPdfBatchSession(session, {
        status: 'paused',
        error: '',
        progressPercent: getOverallPercent(100),
        progressMessage: `Обработка приостановлена. Следующий запуск начнётся с ${formatProjectChunkPageRange(session.nextPage, getProjectPdfChunkEnd(session.nextPage, session.totalPages, session.chunkSize), session.totalPages, sourceKind)}.`,
      });
      failedSession = pausedSession;
      await saveProjectBatchSessionState(pausedSession);
      emitBatchUiState(buildBatchUiState({
        session: pausedSession,
        fileName,
        progressPercent: pausedSession.progressPercent,
        message: pausedSession.progressMessage,
        status: 'paused',
      }));
      stopProgressCreep();
      setProgress({
        percent: pausedSession.progressPercent ?? getOverallPercent(100),
        message: `${fileName}: обработка приостановлена`,
      });
      consumePauseBatchTargetView?.();
      return true;
    };

    for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
      const job = jobs[jobIndex];
      const { kind, totalPages } = job;
      const file = job.file || null;
      const imageBatchFiles = job.files || [];
      const displayName = kind === PROJECT_BATCH_SOURCE_IMAGE
        ? (imageBatchFiles.length === 1 ? imageBatchFiles[0]?.name || 'Изображение' : `Изображения (${imageBatchFiles.length})`)
        : (file?.name || 'PDF');
      const uploadedSourceFile = file
        ? await runStage(`Не удалось подготовить исходный файл ${file.name}`, () => (
          ensureUploadedSourceFile(file, currentProjectId)
        ), {
          retryNetwork: true,
          onRetry: () => {
            const message = `${file.name}: повторная попытка подготовки исходного файла...`;
            setNonDecreasingProgress({ percent: 12, message });
            emitBatchUiState(buildBatchUiState({
              fileName: file.name,
              progressPercent: 12,
              message,
              status: 'running',
            }));
          },
        })
        : null;
      let session = job.session || (
        kind === PROJECT_BATCH_SOURCE_IMAGE
          ? createProjectImageBatchSession(imageBatchFiles, getProjectDocs().length + 1)
          : createProjectPdfBatchSession(file, totalPages, getProjectDocs().length + 1)
      );
      session = updateProjectPdfBatchSession(session, { status: 'running', error: '' });
      await runStage(`Не удалось сохранить состояние обработки для ${displayName}`, () => (
        saveProjectBatchSessionState(session)
      ), { retryNetwork: true });
      emitBatchUiState(buildBatchUiState({
        session,
        fileName: displayName,
        progressPercent: 12,
        message: `${displayName}: подготовка...`,
        status: 'running',
      }));

      for (let pageFrom = session.nextPage || 1; pageFrom <= session.totalPages; pageFrom += session.chunkSize || PROJECT_BATCH_CHUNK_SIZE) {
        const pageTo = getProjectPdfChunkEnd(pageFrom, session.totalPages, session.chunkSize || PROJECT_BATCH_CHUNK_SIZE);
        const rangeLabel = formatProjectChunkPageRange(pageFrom, pageTo, session.totalPages, kind);
        session = updateProjectPdfBatchSession(session, {
          status: 'running',
          error: '',
          nextPage: pageFrom,
          currentPageFrom: pageFrom,
          currentPageTo: pageTo,
        });
        const stageSessionSnapshot = session;
        failedSession = session;
        await runStage(`Не удалось обновить состояние обработки для ${rangeLabel}`, () => (
          saveProjectBatchSessionState(stageSessionSnapshot)
        ), { retryNetwork: true });

        const sessionSnapshot = stageSessionSnapshot;
        const existingPDSnapshot = existingPD;
        const chunkSizeSnapshot = session.chunkSize || PROJECT_BATCH_CHUNK_SIZE;
        setNonDecreasingProgress({
          percent: getOverallPercent(0),
          message: `${displayName}: подготовка ${rangeLabel}...`,
        });
        emitBatchUiState(buildBatchUiState({
          session,
          fileName: displayName,
          progressPercent: getOverallPercent(0),
          message: `${displayName}: подготовка ${rangeLabel}...`,
          status: 'running',
        }));

        let chunkSourceFile = uploadedSourceFile;
        const chunkImages = kind === PROJECT_BATCH_SOURCE_IMAGE
          ? []
          : await pdfToImagesRange(file, pageFrom, pageTo, (pageNumInFile) => {
            const rendered = Math.max(0, pageNumInFile - pageFrom + 1);
            const pagesInChunk = Math.max(1, pageTo - pageFrom + 1);
            const innerPercent = Math.round((rendered / pagesInChunk) * 18);
            const message = pagesInChunk > 1
              ? `${displayName}: рендер ${rangeLabel} (${rendered}/${pagesInChunk})...`
              : `${displayName}: рендер ${rangeLabel}...`;
            const percent = getOverallPercent(innerPercent);
            setNonDecreasingProgress({
              percent,
              message,
            });
            emitBatchUiState(buildBatchUiState({
              session: sessionSnapshot,
              fileName: displayName,
              progressPercent: percent,
              message,
              status: 'running',
            }));
          });

        if (kind === PROJECT_BATCH_SOURCE_IMAGE) {
          const currentImageFile = imageBatchFiles[pageFrom - 1];
          const imageMessage = imageBatchFiles.length > 1
            ? `${displayName}: подготовка ${rangeLabel} (${currentImageFile?.name || 'изображение'})...`
            : `${currentImageFile?.name || 'Изображение'}: подготовка...`;
          setNonDecreasingProgress({
            percent: getOverallPercent(18),
            message: imageMessage,
          });
          emitBatchUiState(buildBatchUiState({
            session: sessionSnapshot,
            fileName: displayName,
            progressPercent: getOverallPercent(18),
            message: imageMessage,
            status: 'running',
          }));
          chunkSourceFile = await runStage(`Не удалось подготовить исходный файл ${currentImageFile?.name || 'изображение'}`, () => (
            ensureUploadedSourceFile(currentImageFile, currentProjectId)
          ), {
            retryNetwork: true,
          });
          const imageData = await imageFileToBase64(currentImageFile);
          chunkImages.push({
            ...imageData,
            pageNum: pageFrom,
            totalPages: session.totalPages,
          });
        }

        let result;
        try {
          result = await runStage(`Не удалось распознать ${rangeLabel}`, () => recognizeDocument(chunkImages, apiKey.trim(), provider, p => {
            const chunkPercent = p.percent != null ? Math.round(p.percent) : (p.stage === 'done' ? 100 : 50);
            const percent = getOverallPercent(Math.max(20, chunkPercent));
            const message = `${displayName}: ${p.message} (${rangeLabel})`;
            setProgress(prev => prev && prev.percent > percent
              ? { ...prev, message }
              : { percent, message }
            );
            emitBatchUiState(buildBatchUiState({
              session: sessionSnapshot,
              fileName: displayName,
              progressPercent: percent,
              message,
              status: 'running',
            }));
          }, existingPDSnapshot), {
          retryNetwork: true,
          onRetry: () => {
            const percent = getOverallPercent(20);
            const message = `${displayName}: повторная попытка распознавания ${rangeLabel}...`;
            setNonDecreasingProgress({ percent, message });
            emitBatchUiState(buildBatchUiState({
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

        const pd = existingPD
          ? assignLetters(mergePD(existingPD, result.personalData), existingPD)
          : assignLetters(result.personalData);

        const initialAnon = {};
        const html = buildAnnotatedHtml(result.text, pd, initialAnon);
        const existingBatchDoc = activeBatchDoc;

        const entryTitle = kind === PROJECT_BATCH_SOURCE_IMAGE
          ? (imageBatchFiles[pageFrom - 1]?.name || displayName)
          : (file?.name || displayName);

        const pageDocEntry = {
          id: generateId(),
          title: entryTitle,
          originalFileName: entryTitle,
          text: result.text,
          editedHtml: html,
          personalData: pd,
          anonymized: initialAnon,
          source: kind === PROJECT_BATCH_SOURCE_IMAGE ? 'image' : 'ocr',
          projectId: currentProjectId,
          pageFrom,
          pageTo,
          totalPages: sessionSnapshot.totalPages,
          chunkIndex: Math.ceil(pageFrom / chunkSizeSnapshot),
          chunkSize: chunkSizeSnapshot,
          batchFileName: kind === PROJECT_BATCH_SOURCE_IMAGE ? displayName : (file?.name || displayName),
          sourceFiles: chunkSourceFile ? [chunkSourceFile] : [],
          pageMetadata: buildDocumentPageMetadata({
            sourceFile: chunkSourceFile,
            batchFileName: kind === PROJECT_BATCH_SOURCE_IMAGE ? displayName : (file?.name || displayName),
            projectId: currentProjectId,
            pageFrom,
            pageTo,
            totalPages: session.totalPages,
            pages: chunkImages,
          }),
          coordinateLayer: buildDocumentCoordinateLayer({
            pages: chunkImages,
          }),
        };

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
            const percent = getOverallPercent(92);
            const message = `${displayName}: повторная попытка сохранения ${rangeLabel}...`;
            setNonDecreasingProgress({ percent, message });
            emitBatchUiState(buildBatchUiState({
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

        activeBatchDoc = docEntry;
        lastSavedDoc = docEntry;
        existingPD = pd;
        completedChunks += 1;

        session = updateProjectPdfBatchSession(session, {
          documentId: docEntry.id,
          documentTitle: docEntry.title,
          nextPage: pageTo + 1,
          status: pageTo >= session.totalPages ? 'completed' : 'running',
          error: '',
          currentPageFrom: pageFrom,
          currentPageTo: pageTo,
          progressPercent: getOverallPercent(100),
          progressMessage: `${displayName}: распознано ${rangeLabel}.`,
        });
        const completedSessionSnapshot = session;
        await runStage(`Не удалось сохранить прогресс после ${rangeLabel}`, () => (
          saveProjectBatchSessionState(pageTo >= completedSessionSnapshot.totalPages ? null : completedSessionSnapshot)
        ), { retryNetwork: true });
        failedSession = pageTo >= completedSessionSnapshot.totalPages ? null : completedSessionSnapshot;

        if (pageTo < session.totalPages && await pauseBatchIfRequested(session, displayName)) {
          return;
        }
      }
    }

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
  } catch (err) {
    stopProgressCreep();
    if (failedSession) {
      await saveProjectBatchSessionState(updateProjectPdfBatchSession(failedSession, {
        status: 'failed',
        error: err.message || 'Произошла ошибка',
      }));
      emitBatchUiState(buildBatchUiState({
        session: failedSession,
        fileName: failedSession.fileName || '',
        progressPercent: failedSession.progressPercent ?? null,
        message: failedSession.progressMessage || '',
        status: 'failed',
        error: err.message || 'Произошла ошибка',
      }));
    }
    setError(err.message || 'Произошла ошибка');
    setView(viewProject);
    setProgress(null);
  }
}
