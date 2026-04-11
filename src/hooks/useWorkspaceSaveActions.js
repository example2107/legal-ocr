import { useCallback } from 'react';
import { addDocumentToProjectRecord, saveDocumentRecord } from '../utils/dataStore';
import { exportRichTextDocx } from '../utils/docxExport';
import { exportRichTextPdf } from '../utils/pdfExportFlow';

export function useWorkspaceSaveActions({
  currentProjectId,
  docId,
  docTitle,
  originalFileName,
  sourceFiles,
  pageMetadata,
  rawText,
  editorHtml,
  personalData,
  anonymized,
  history,
  user,
  editorDomRef,
  refreshHistory,
  refreshProjects,
  setError,
  setLastSavedState,
  setSavedMsg,
  countUncertain,
  countPageSeparators,
  setPendingExportAction,
  setShowUncertainWarning,
  setHighlightUncertain,
} = {}) {
  const handleDownloadPdf = useCallback(() => {
    try {
      exportRichTextPdf({
        editorDomRef,
        editorHtml,
        docTitle,
        originalFileName,
      });
    } catch (error) {
      alert(error?.message || 'Разрешите всплывающие окна для скачивания PDF');
    }
  }, [docTitle, editorDomRef, editorHtml, originalFileName]);

  const handleSave = useCallback(async () => {
    if (!currentProjectId) {
      setError('Документ можно сохранить только внутри проекта');
      return;
    }

    const currentHtml = editorDomRef.current?.innerHTML || editorHtml;
    const existingDocEntry = history.find((item) => item.id === docId) || null;
    const docData = {
      id: docId,
      title: docTitle,
      originalFileName,
      sourceFiles,
      pageMetadata,
      text: rawText,
      editedHtml: currentHtml,
      personalData,
      anonymized,
      source: existingDocEntry?.source || 'ocr',
      projectId: currentProjectId,
    };

    await saveDocumentRecord(user, docData);
    await addDocumentToProjectRecord(user, currentProjectId, docId);
    await refreshProjects();
    setLastSavedState(JSON.stringify({
      anonymized: JSON.stringify(anonymized),
      html: currentHtml,
    }));
    await refreshHistory();
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  }, [
    anonymized,
    currentProjectId,
    docId,
    docTitle,
    editorDomRef,
    editorHtml,
    history,
    originalFileName,
    pageMetadata,
    personalData,
    rawText,
    refreshHistory,
    refreshProjects,
    setError,
    setLastSavedState,
    setSavedMsg,
    sourceFiles,
    user,
  ]);

  const handleDownloadDocx = useCallback(async () => {
    await exportRichTextDocx({
      html: editorDomRef.current?.innerHTML || editorHtml,
      docTitle,
      originalFileName,
    });
  }, [docTitle, editorDomRef, editorHtml, originalFileName]);

  const triggerExport = useCallback((action) => {
    const uncertainCount = countUncertain();
    const separatorCount = countPageSeparators();
    if (uncertainCount > 0 || separatorCount > 0) {
      setPendingExportAction(action);
      setShowUncertainWarning(true);
      setHighlightUncertain(true);
      if (editorDomRef.current) {
        editorDomRef.current.querySelectorAll('.part-separator').forEach((element) => {
          element.classList.add('page-separator-highlight');
        });
      }
      return;
    }

    if (action === 'save') void handleSave();
    else if (action === 'pdf') handleDownloadPdf();
    else if (action === 'docx') void handleDownloadDocx();
  }, [
    countPageSeparators,
    countUncertain,
    editorDomRef,
    handleDownloadDocx,
    handleDownloadPdf,
    handleSave,
    setHighlightUncertain,
    setPendingExportAction,
    setShowUncertainWarning,
  ]);

  const handleUncertainProceed = useCallback((pendingExportAction, setPendingAction) => {
    setShowUncertainWarning(false);
    setHighlightUncertain(false);
    if (editorDomRef.current) {
      editorDomRef.current.querySelectorAll('.part-separator').forEach((element) => {
        element.classList.remove('page-separator-highlight');
      });
    }
    if (pendingExportAction === 'save') void handleSave();
    else if (pendingExportAction === 'pdf') handleDownloadPdf();
    else if (pendingExportAction === 'docx') void handleDownloadDocx();
    setPendingAction(null);
  }, [
    editorDomRef,
    handleDownloadDocx,
    handleDownloadPdf,
    handleSave,
    setHighlightUncertain,
    setShowUncertainWarning,
  ]);

  const handleUncertainCancel = useCallback((setPendingAction) => {
    setShowUncertainWarning(false);
    setPendingAction(null);
    if (editorDomRef.current) {
      const first = editorDomRef.current.querySelector('mark.uncertain, .page-separator-highlight');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [editorDomRef, setShowUncertainWarning]);

  return {
    handleDownloadPdf,
    handleSave,
    handleDownloadDocx,
    triggerExport,
    handleUncertainProceed,
    handleUncertainCancel,
  };
}
