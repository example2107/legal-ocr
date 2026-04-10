import { getPdfPageCount, pdfToImagesRange } from './pdfUtils';
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
  PROJECT_PDF_CHUNK_SIZE,
  createProjectPdfBatchSession,
  formatProjectChunkPageRange,
  getProjectPdfChunkEnd,
  isSameProjectPdfBatchFile,
  updateProjectPdfBatchSession,
} from './projectBatch';
import { buildProjectBatchDocumentEntry } from './projectDocumentOps';

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
    setError('Добавьте хотя бы один PDF-файл');
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

    const liveProject = projects.find((item) => item.id === currentProjectId) || null;
    const activeBatchSession = liveProject?.batchSession || null;
    let jobs = [];

    if (activeBatchSession && activeBatchSession.status !== 'completed') {
      if (files.length !== 1) {
        throw new Error('Для продолжения выберите только тот PDF-файл, обработка которого была прервана.');
      }
      if (!isSameProjectPdfBatchFile(activeBatchSession, files[0])) {
        throw new Error('Для продолжения выберите тот же PDF-файл, который обрабатывался ранее. Если хотите начать другой файл, сначала сбросьте незавершённую обработку.');
      }
      jobs = [{
        file: files[0],
        totalPages: activeBatchSession.totalPages,
        session: updateProjectPdfBatchSession(activeBatchSession, { status: 'running', error: '' }),
      }];
    } else {
      setNonDecreasingProgress({ percent: 2, message: 'Подсчёт страниц PDF...' });
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const totalPages = await getPdfPageCount(file);
        setNonDecreasingProgress({
          percent: Math.round(2 + ((i + 1) / files.length) * 8),
          message: `Подсчёт страниц: ${file.name} (${totalPages} стр.)`,
        });
        emitBatchUiState(buildBatchUiState({
          fileName: file.name,
          progressPercent: Math.round(2 + ((i + 1) / files.length) * 8),
          message: `Подсчёт страниц: ${file.name} (${totalPages} стр.)`,
          status: 'running',
        }));
        jobs.push({ file, totalPages, session: null });
      }
    }

    let totalChunks = jobs.reduce((sum, job) => {
      const startPage = job.session?.nextPage || 1;
      return sum + Math.ceil(Math.max(0, job.totalPages - startPage + 1) / PROJECT_PDF_CHUNK_SIZE);
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
      const pausedSession = updateProjectPdfBatchSession(session, {
        status: 'paused',
        error: '',
        progressPercent: getOverallPercent(100),
        progressMessage: `Обработка приостановлена. Следующий запуск начнётся с ${formatProjectChunkPageRange(session.nextPage, getProjectPdfChunkEnd(session.nextPage, session.totalPages, session.chunkSize), session.totalPages)}.`,
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
      setFiles([]);
      setProgress(null);
      setView(consumePauseBatchTargetView?.() || fallbackView);
      return true;
    };

    for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
      const { file, totalPages } = jobs[jobIndex];
      const uploadedSourceFile = await ensureUploadedSourceFile(file, currentProjectId);
      let session = jobs[jobIndex].session || createProjectPdfBatchSession(file, totalPages, getProjectDocs().length + 1);
      session = updateProjectPdfBatchSession(session, { status: 'running', error: '' });
      await saveProjectBatchSessionState(session);
      emitBatchUiState(buildBatchUiState({
        session,
        fileName: file.name,
        progressPercent: 12,
        message: `${file.name}: подготовка...`,
        status: 'running',
      }));

      for (let pageFrom = session.nextPage || 1; pageFrom <= session.totalPages; pageFrom += session.chunkSize || PROJECT_PDF_CHUNK_SIZE) {
        const pageTo = getProjectPdfChunkEnd(pageFrom, session.totalPages, session.chunkSize || PROJECT_PDF_CHUNK_SIZE);
        session = updateProjectPdfBatchSession(session, {
          status: 'running',
          error: '',
          nextPage: pageFrom,
          currentPageFrom: pageFrom,
          currentPageTo: pageTo,
        });
        failedSession = session;
        await saveProjectBatchSessionState(session);

        const rangeLabel = formatProjectChunkPageRange(pageFrom, pageTo, session.totalPages);
        setNonDecreasingProgress({
          percent: getOverallPercent(0),
          message: `${file.name}: подготовка ${rangeLabel}...`,
        });
        emitBatchUiState(buildBatchUiState({
          session,
          fileName: file.name,
          progressPercent: getOverallPercent(0),
          message: `${file.name}: подготовка ${rangeLabel}...`,
          status: 'running',
        }));

        const chunkImages = await pdfToImagesRange(file, pageFrom, pageTo, (pageNumInFile) => {
          const rendered = Math.max(0, pageNumInFile - pageFrom + 1);
          const pagesInChunk = Math.max(1, pageTo - pageFrom + 1);
          const innerPercent = Math.round((rendered / pagesInChunk) * 18);
          const message = pagesInChunk > 1
            ? `${file.name}: рендер ${rangeLabel} (${rendered}/${pagesInChunk})...`
            : `${file.name}: рендер ${rangeLabel}...`;
          const percent = getOverallPercent(innerPercent);
          setNonDecreasingProgress({
            percent,
            message,
          });
          emitBatchUiState(buildBatchUiState({
            session,
            fileName: file.name,
            progressPercent: percent,
            message,
            status: 'running',
          }));
        });

        let result;
        try {
          result = await recognizeDocument(chunkImages, apiKey.trim(), provider, p => {
            const chunkPercent = p.percent != null ? Math.round(p.percent) : (p.stage === 'done' ? 100 : 50);
            const percent = getOverallPercent(Math.max(20, chunkPercent));
            const message = `${file.name}: ${p.message} (${rangeLabel})`;
            setProgress(prev => prev && prev.percent > percent
              ? { ...prev, message }
              : { percent, message }
            );
            emitBatchUiState(buildBatchUiState({
              session,
              fileName: file.name,
              progressPercent: percent,
              message,
              status: 'running',
            }));
          }, existingPD);
        } catch (error) {
          console.error('Project batch recognition failed', {
            provider,
            projectId: currentProjectId,
            fileName: file.name,
            rangeLabel,
            pageFrom,
            pageTo,
            totalPages: session.totalPages,
            chunkIndex: Math.ceil(pageFrom / (session.chunkSize || PROJECT_PDF_CHUNK_SIZE)),
            chunkSize: session.chunkSize || PROJECT_PDF_CHUNK_SIZE,
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

        const pageDocEntry = {
          id: generateId(),
          title: file.name,
          originalFileName: file.name,
          text: result.text,
          editedHtml: html,
          personalData: pd,
          anonymized: initialAnon,
          source: 'ocr',
          projectId: currentProjectId,
          pageFrom,
          pageTo,
          totalPages: session.totalPages,
          chunkIndex: Math.ceil(pageFrom / (session.chunkSize || PROJECT_PDF_CHUNK_SIZE)),
          chunkSize: session.chunkSize || PROJECT_PDF_CHUNK_SIZE,
          batchFileName: file.name,
          sourceFiles: uploadedSourceFile ? [uploadedSourceFile] : [],
          pageMetadata: buildDocumentPageMetadata({
            sourceFile: uploadedSourceFile,
            batchFileName: file.name,
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
        const docEntry = await saveDocumentRecord(user, nextDocEntry);
        if (!existingBatchDoc) {
          await addDocumentToProjectRecord(user, currentProjectId, docEntry.id);
        }
        await updateProjectSharedPDRecord(user, currentProjectId, pd);
        await refreshHistory();
        await refreshProjects();

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
          progressMessage: `${file.name}: распознано ${rangeLabel}.`,
        });
        await saveProjectBatchSessionState(pageTo >= session.totalPages ? null : session);
        failedSession = pageTo >= session.totalPages ? null : session;

        if (pageTo < session.totalPages && await pauseBatchIfRequested(session, file.name)) {
          return;
        }
      }
    }

    stopProgressCreep();
    await saveProjectBatchSessionState(null);
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
