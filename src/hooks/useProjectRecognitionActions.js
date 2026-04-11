import { useCallback } from 'react';
import { analyzePD, analyzePastedText } from '../utils/claudeApi';
import { parseDocx } from '../utils/docxParser';
import { buildAnnotatedHtml } from '../components/RichEditor';
import { generateId } from '../utils/history';
import {
  addDocumentToProjectRecord,
  saveDocumentRecord,
  updateProjectSharedPDRecord,
} from '../utils/dataStore';
import { runProjectBatchRecognition } from '../utils/runProjectBatchRecognition';

export function useProjectRecognitionActions({
  apiKey,
  provider,
  user,
  currentProjectId,
  currentBatchSession,
  inputTab,
  files,
  setFiles,
  docxFiles,
  setDocxFiles,
  pastedText,
  setPastedText,
  projects,
  getProjectExistingPD,
  getProjectDocs,
  cleanupDuplicateProjectChunkDocs,
  saveProjectBatchSessionState,
  ensureUploadedSourceFile,
  mergePD,
  assignLetters,
  refreshHistory,
  refreshProjects,
  openRecognizedDocResult,
  activeBatchControlRef,
  consumePauseBatchTargetView,
  clearActiveBatchTracking,
  mergeBatchUiState,
  setActiveBatchUiState,
  setView,
  setError,
  setWarningMessage,
  setProgress,
  setOriginalImages,
  setIsDragging,
  animateTo,
  setNonDecreasingProgress,
  stopProgressCreep,
  viewProcessing,
  viewProject,
  viewResult,
  formatDate,
} = {}) {
  const handleProjectDocumentFiles = useCallback((newFiles) => {
    const valid = Array.from(newFiles).filter(
      (file) => file.type === 'application/pdf' || file.type.startsWith('image/'),
    );
    if (valid.length !== newFiles.length) {
      setError('Во вкладке "Документы" поддерживаются только PDF, JPG, PNG и WEBP');
    }
    setFiles((prev) => [...prev, ...valid]);
  }, [setError, setFiles]);

  const handleProjectDocxFiles = useCallback((newFiles) => {
    const valid = Array.from(newFiles).filter((file) => file.name.toLowerCase().endsWith('.docx'));
    if (valid.length !== newFiles.length) {
      setError('Во вкладке "DOCX" поддерживаются только файлы DOCX');
    }
    setDocxFiles((prev) => [...prev, ...valid]);
  }, [setDocxFiles, setError]);

  const handleProjectDocumentDrop = useCallback((event) => {
    event.preventDefault();
    setIsDragging(false);
    handleProjectDocumentFiles(event.dataTransfer.files);
  }, [handleProjectDocumentFiles, setIsDragging]);

  const removeFile = useCallback((index) => {
    setFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index));
  }, [setFiles]);

  const removeDocxFile = useCallback((index) => {
    setDocxFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index));
  }, [setDocxFiles]);

  const saveRecognizedProjectDocument = useCallback(async ({
    result,
    title,
    originalFileName = '',
    source,
    uploadedSourceFiles = [],
  }) => {
    if (!currentProjectId) throw new Error('Сначала откройте проект');

    const existingPD = getProjectExistingPD();
    const pd = existingPD
      ? assignLetters(mergePD(existingPD, result.personalData || { persons: [], otherPD: [] }), existingPD)
      : assignLetters(result.personalData || { persons: [], otherPD: [] });
    const initialAnon = {};
    const html = buildAnnotatedHtml(result.text, pd, initialAnon);
    const savedDoc = await saveDocumentRecord(user, {
      id: generateId(),
      title,
      originalFileName,
      text: result.text,
      editedHtml: html,
      personalData: pd,
      anonymized: initialAnon,
      source,
      projectId: currentProjectId,
      sourceFiles: uploadedSourceFiles,
    });

    await addDocumentToProjectRecord(user, currentProjectId, savedDoc.id);
    await updateProjectSharedPDRecord(user, currentProjectId, pd);
    await refreshHistory();
    await refreshProjects();
    return savedDoc;
  }, [
    assignLetters,
    currentProjectId,
    getProjectExistingPD,
    mergePD,
    refreshHistory,
    refreshProjects,
    user,
  ]);

  const handleProjectTextRecognize = useCallback(async () => {
    if (!apiKey.trim()) {
      setError('Введите API ключ');
      return;
    }
    if (!pastedText.trim()) {
      setError('Вставьте текст для обезличивания');
      return;
    }

    setError(null);
    setWarningMessage(null);
    setView(viewProcessing);

    try {
      setOriginalImages([]);
      setNonDecreasingProgress({ percent: 10, message: 'Подготовка текста...' });
      animateTo(85, null);

      const result = await analyzePastedText(pastedText.trim(), apiKey.trim(), provider, (progressSnapshot) => {
        const percent = progressSnapshot.percent != null
          ? Math.round(progressSnapshot.percent)
          : (progressSnapshot.stage === 'done' ? 100 : 50);
        setNonDecreasingProgress({ percent, message: progressSnapshot.message });
      });

      stopProgressCreep();
      const savedDoc = await saveRecognizedProjectDocument({
        result,
        title: `Текст от ${formatDate(new Date())}`,
        originalFileName: '',
        source: 'paste',
        uploadedSourceFiles: [],
      });
      setPastedText('');
      openRecognizedDocResult(savedDoc, []);
      setTimeout(() => {
        setView(viewResult);
        setProgress(null);
      }, 400);
    } catch (error) {
      stopProgressCreep();
      setError(error.message || 'Произошла ошибка');
      setView(viewProject);
      setProgress(null);
    }
  }, [
    apiKey,
    animateTo,
    formatDate,
    openRecognizedDocResult,
    pastedText,
    provider,
    saveRecognizedProjectDocument,
    setNonDecreasingProgress,
    setError,
    setOriginalImages,
    setProgress,
    setPastedText,
    setView,
    setWarningMessage,
    stopProgressCreep,
    viewProcessing,
    viewProject,
    viewResult,
  ]);

  const handleProjectDocxRecognize = useCallback(async () => {
    if (!apiKey.trim()) {
      setError('Введите API ключ');
      return;
    }
    if (docxFiles.length === 0) {
      setError('Добавьте хотя бы один DOCX-файл');
      return;
    }

    setError(null);
    setWarningMessage(null);
    setView(viewProcessing);

    try {
      let lastSavedDoc = null;

      for (let index = 0; index < docxFiles.length; index += 1) {
        const file = docxFiles[index];
        setNonDecreasingProgress({
          percent: Math.round(10 + (index / Math.max(1, docxFiles.length)) * 20),
          message: `Чтение DOCX: ${file.name}...`,
        });
        const docxText = await parseDocx(file);
        setNonDecreasingProgress({
          percent: Math.round(30 + (index / Math.max(1, docxFiles.length)) * 20),
          message: `Анализ персональных данных: ${file.name}...`,
        });
        animateTo(90, null);

        const personalData = await analyzePD(docxText, apiKey.trim(), provider, (progressSnapshot) => {
          const percent = progressSnapshot.percent != null ? Math.round(progressSnapshot.percent) : 97;
          setNonDecreasingProgress({ percent, message: `${file.name}: ${progressSnapshot.message}` });
        });
        const uploadedSourceFile = await ensureUploadedSourceFile(file, currentProjectId);
        lastSavedDoc = await saveRecognizedProjectDocument({
          result: { text: docxText, personalData },
          title: file.name,
          originalFileName: file.name,
          source: 'docx',
          uploadedSourceFiles: uploadedSourceFile ? [uploadedSourceFile] : [],
        });
      }

      stopProgressCreep();
      setDocxFiles([]);
      if (lastSavedDoc) {
        openRecognizedDocResult(lastSavedDoc, []);
        setTimeout(() => {
          setView(viewResult);
          setProgress(null);
        }, 400);
        return;
      }

      setView(viewProject);
      setProgress(null);
    } catch (error) {
      stopProgressCreep();
      setError(error.message || 'Произошла ошибка');
      setView(viewProject);
      setProgress(null);
    }
  }, [
    apiKey,
    animateTo,
    currentProjectId,
    docxFiles,
    ensureUploadedSourceFile,
    openRecognizedDocResult,
    provider,
    saveRecognizedProjectDocument,
    setDocxFiles,
    setError,
    setNonDecreasingProgress,
    setProgress,
    setView,
    setWarningMessage,
    stopProgressCreep,
    viewProcessing,
    viewProject,
    viewResult,
  ]);

  const runProjectBatch = useCallback(async () => {
    activeBatchControlRef.current.projectId = currentProjectId;
    activeBatchControlRef.current.pauseRequested = false;
    activeBatchControlRef.current.targetView = null;
    setWarningMessage(null);

    await runProjectBatchRecognition({
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
      shouldPauseBatch: () => activeBatchControlRef.current.pauseRequested,
      consumePauseBatchTargetView,
      onBatchUiStateChange: (nextState) => {
        if (nextState?.projectId) {
          activeBatchControlRef.current.projectId = nextState.projectId;
        }
        setActiveBatchUiState((prevState) => mergeBatchUiState(prevState, nextState));
      },
      onBatchUiStateClear: clearActiveBatchTracking,
      stopProgressCreep,
      setError,
      setView,
      setFiles,
      setProgress,
      viewProcessing,
      viewProject,
      viewResult,
    });
  }, [
    activeBatchControlRef,
    apiKey,
    assignLetters,
    cleanupDuplicateProjectChunkDocs,
    clearActiveBatchTracking,
    consumePauseBatchTargetView,
    currentProjectId,
    ensureUploadedSourceFile,
    files,
    getProjectDocs,
    getProjectExistingPD,
    mergeBatchUiState,
    mergePD,
    openRecognizedDocResult,
    projects,
    provider,
    refreshHistory,
    refreshProjects,
    saveProjectBatchSessionState,
    setActiveBatchUiState,
    setError,
    setFiles,
    setProgress,
    setView,
    setWarningMessage,
    stopProgressCreep,
    user,
    viewProcessing,
    viewProject,
    viewResult,
  ]);

  const handleProjectRecognize = useCallback(async () => {
    if (currentBatchSession && currentBatchSession.status !== 'completed') {
      await runProjectBatch();
      return;
    }
    if (inputTab === 'text') {
      await handleProjectTextRecognize();
      return;
    }
    if (inputTab === 'docx') {
      await handleProjectDocxRecognize();
      return;
    }
    await runProjectBatch();
  }, [
    currentBatchSession,
    handleProjectDocxRecognize,
    handleProjectTextRecognize,
    inputTab,
    runProjectBatch,
  ]);

  return {
    handleProjectDocumentFiles,
    handleProjectDocxFiles,
    handleProjectDocumentDrop,
    removeFile,
    removeDocxFile,
    handleProjectRecognize,
  };
}
