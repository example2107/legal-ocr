import { getPdfPageCount, pdfToImagesRange } from './pdfUtils';
import { recognizeDocument } from './claudeApi';
import { buildAnnotatedHtml } from '../components/RichEditor';
import { generateId } from './history';
import {
  addDocumentToProjectRecord,
  deleteDocumentRecord,
  removeDocumentFromProjectRecord,
  saveDocumentRecord,
  updateProjectSharedPDRecord,
} from './dataStore';
import {
  PROJECT_PDF_CHUNK_SIZE,
  createProjectPdfBatchSession,
  formatProjectChunkPageRange,
  formatProjectChunkTitle,
  getProjectPdfChunkEnd,
  isSameProjectPdfBatchFile,
  updateProjectPdfBatchSession,
} from './projectBatch';

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
  try {
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
      setProgress({ percent: 2, message: 'Подсчёт страниц PDF...' });
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const totalPages = await getPdfPageCount(file);
        setProgress({
          percent: Math.round(2 + ((i + 1) / files.length) * 8),
          message: `Подсчёт страниц: ${file.name} (${totalPages} стр.)`,
        });
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
    let nextDocumentNumber = activeBatchSession?.nextDocumentNumber || (getProjectDocs().length + 1);
    let lastSavedDoc = null;
    let lastChunkImages = [];

    const getOverallPercent = (chunkPercent = 0) => {
      const safeTotal = Math.max(1, totalChunks);
      const base = 6 + (completedChunks / safeTotal) * 90;
      const current = (chunkPercent / 100) * (90 / safeTotal);
      return Math.max(2, Math.min(98, Math.round(base + current)));
    };

    for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
      const { file, totalPages } = jobs[jobIndex];
      const uploadedSourceFile = await ensureUploadedSourceFile(file, currentProjectId);
      let session = jobs[jobIndex].session || createProjectPdfBatchSession(file, totalPages, nextDocumentNumber);
      session = updateProjectPdfBatchSession(session, { status: 'running', error: '' });
      await saveProjectBatchSessionState(session);

      for (let pageFrom = session.nextPage || 1; pageFrom <= session.totalPages; pageFrom += session.chunkSize || PROJECT_PDF_CHUNK_SIZE) {
        const pageTo = getProjectPdfChunkEnd(pageFrom, session.totalPages, session.chunkSize || PROJECT_PDF_CHUNK_SIZE);
        session = updateProjectPdfBatchSession(session, {
          status: 'running',
          error: '',
          nextPage: pageFrom,
          nextDocumentNumber,
          currentPageFrom: pageFrom,
          currentPageTo: pageTo,
        });
        failedSession = session;
        await saveProjectBatchSessionState(session);

        const rangeLabel = formatProjectChunkPageRange(pageFrom, pageTo, session.totalPages);
        setProgress({
          percent: getOverallPercent(0),
          message: `${file.name}: подготовка ${rangeLabel}...`,
        });

        const chunkImages = await pdfToImagesRange(file, pageFrom, pageTo, (pageNumInFile) => {
          const rendered = Math.max(0, pageNumInFile - pageFrom + 1);
          const innerPercent = Math.round((rendered / (pageTo - pageFrom + 1)) * 18);
          setProgress({
            percent: getOverallPercent(innerPercent),
            message: `${file.name}: рендер ${rangeLabel} (${rendered}/${pageTo - pageFrom + 1})...`,
          });
        });
        lastChunkImages = chunkImages;

        const result = await recognizeDocument(chunkImages, apiKey.trim(), provider, p => {
          const chunkPercent = p.percent != null ? Math.round(p.percent) : (p.stage === 'done' ? 100 : 50);
          const percent = getOverallPercent(Math.max(20, chunkPercent));
          setProgress(prev => prev && prev.percent > percent
            ? { ...prev, message: `${file.name}: ${p.message} (${rangeLabel})` }
            : { percent, message: `${file.name}: ${p.message} (${rangeLabel})` }
          );
        }, existingPD);

        const pd = existingPD
          ? assignLetters(mergePD(existingPD, result.personalData), existingPD)
          : assignLetters(result.personalData);

        const initialAnon = {};
        const html = buildAnnotatedHtml(result.text, pd, initialAnon);
        const currentProjectDocs = getProjectDocs();
        const chunkMatches = currentProjectDocs.filter(doc =>
          doc.batchFileName === file.name &&
          Number(doc.pageFrom || 0) === pageFrom &&
          Number(doc.pageTo || 0) === pageTo
        );
        const primaryChunkDoc = chunkMatches[0] || null;
        if (chunkMatches.length > 1) {
          for (const doc of chunkMatches.slice(1)) {
            await removeDocumentFromProjectRecord(user, currentProjectId, doc.id);
            await deleteDocumentRecord(user, doc.id);
          }
        }

        const docEntry = await saveDocumentRecord(user, {
          id: primaryChunkDoc?.id || generateId(),
          title: primaryChunkDoc?.title || formatProjectChunkTitle(nextDocumentNumber, file.name),
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
        });
        await addDocumentToProjectRecord(user, currentProjectId, docEntry.id);
        await updateProjectSharedPDRecord(user, currentProjectId, pd);
        await refreshHistory();
        await refreshProjects();

        lastSavedDoc = docEntry;
        existingPD = pd;
        nextDocumentNumber += 1;
        completedChunks += 1;

        session = updateProjectPdfBatchSession(session, {
          nextPage: pageTo + 1,
          nextDocumentNumber,
          status: pageTo >= session.totalPages ? 'completed' : 'running',
          error: '',
          currentPageFrom: pageFrom,
          currentPageTo: pageTo,
        });
        await saveProjectBatchSessionState(pageTo >= session.totalPages ? null : session);
        failedSession = pageTo >= session.totalPages ? null : session;
      }
    }

    stopProgressCreep();
    await saveProjectBatchSessionState(null);
    setFiles([]);
    if (lastSavedDoc) openRecognizedDocResult(lastSavedDoc, lastChunkImages);
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
    }
    setError(err.message || 'Произошла ошибка');
    setView(viewProject);
    setProgress(null);
  }
}
