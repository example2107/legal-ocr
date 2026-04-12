import React, { useCallback, useEffect } from 'react';
import AppGateScreen, { getAppGateState } from './components/AppGateScreen';
import AppWorkspaceScreen from './components/AppWorkspaceScreen';
import { buildAnnotatedHtml, buildPdMatchPattern, patchPdMarks, initPdMarkOriginals } from './components/RichEditor';
import { useAuth } from './context/AuthContext';
import { useAppBatchProgressState } from './hooks/useAppBatchProgressState';
import { useAppNavigationFlow } from './hooks/useAppNavigationFlow';
import { useAppViewProps } from './hooks/useAppViewProps';
import { useAppWorkspaceState } from './hooks/useAppWorkspaceState';
import { useEditorPageNavigation } from './hooks/useEditorPageNavigation';
import { useEditorPdActions } from './hooks/useEditorPdActions';
import { useGlobalUndoShortcuts } from './hooks/useGlobalUndoShortcuts';
import { usePdPanelNavigation } from './hooks/usePdPanelNavigation';
import { useProjectRecognitionActions } from './hooks/useProjectRecognitionActions';
import { useProjectDerivedState } from './hooks/useProjectDerivedState';
import { useProjectWorkspaceActions } from './hooks/useProjectWorkspaceActions';
import { useResizablePanels } from './hooks/useResizablePanels';
import { useResultWorkspaceState } from './hooks/useResultWorkspaceState';
import { useStickyToolbarLayout } from './hooks/useStickyToolbarLayout';
import { useStoredData } from './hooks/useStoredData';
import { useWorkspaceSaveActions } from './hooks/useWorkspaceSaveActions';
import { getOriginalImageIndexForPage } from './utils/originalImagePages';
import {
  ALPHA_PRIVATE,
  OTHER_PD_TYPES_MAP,
  assignLetters,
  buildCanonicalPersonMentions,
  dedupeMentions,
  formatDate,
  formatDocumentPageProgress,
  getBatchResumeText,
  getBatchSourceSelectionHint,
  getBatchStatusTitle,
  getOtherPdMentions,
  getPersonMentions,
  mergeBatchUiState,
  mergePD,
  normalizePdText,
  parseCssSize,
} from './utils/appWorkspaceHelpers';
import './App.css';

const VIEW_HOME = 'home';
const VIEW_PROCESSING = 'processing';
const VIEW_RESULT = 'result';
const VIEW_PROJECT = 'project';

export default function App() {
  const { user, loading: authLoading, isConfigured, signInWithPassword, signUpWithPassword, signOut } = useAuth();
  const userId = user?.id || null;
  const {
    view, setView, apiKey, setApiKey, showApiKey, setShowApiKey, provider, setProvider, currentProjectId, setCurrentProjectId,
    showCreateProject, setShowCreateProject, newProjectTitle, setNewProjectTitle, showRebuildConfirm, setShowRebuildConfirm,
    editingPdId, setEditingPdId, editingPdFragment, setEditingPdFragment, inputTab, setInputTab, pdIdsInDoc, setPdIdsInDoc,
    files, setFiles, docxFiles, setDocxFiles, pastedText, setPastedText, originalImages, setOriginalImages, showOriginal,
    setShowOriginal, originalPage, setOriginalPage, zoomActive, setZoomActive, zoomScale, setZoomScale, setZoomOffset,
    isDragging, setIsDragging, error, setError, warningMessage, setWarningMessage, docId, setDocId, docTitle, setDocTitle,
    originalFileName, setOriginalFileName, sourceFiles, setSourceFiles, pageMetadata, setPageMetadata, rawText, setRawText,
    editorHtml, setEditorHtml, personalData, setPersonalData, anonymized, setAnonymized, lastSavedState, setLastSavedState,
    showUnsaved, setShowUnsaved, savedMsg, setSavedMsg, showUncertainWarning, setShowUncertainWarning, editorCurrentPage,
    setEditorCurrentPage, editorTotalPages, setEditorTotalPages, editorPageInput, setEditorPageInput, showLongDocWarning,
    setShowLongDocWarning, highlightUncertain, setHighlightUncertain, pendingExportAction, setPendingExportAction,
    activeBatchControlRef, pendingNavRef, projectFileInputRef, projectDocxInputRef, projectImportRef, editorPageInputRef,
    editorNavigatingPageRef, editorPageNavigationTimerRef, uploadedFilesRef, editorDomRef, pdCleanupTimerRef, pdRef,
    anonRef, undoStackRef, undoIndexRef, headerRef, titleRowRef, MAX_UNDO, handleStoredDataError, handleStoredDataSignedOut,
    handleToggleOriginalViewer, handleLoadOriginalViewerImages, removeAmbiguousEntry,
  } = useAppWorkspaceState();

  const { dataLoading, history, projects, refreshHistory, refreshProjects, setProjects } = useStoredData({
    authLoading,
    isConfigured,
    userId,
    onError: handleStoredDataError,
    onSignedOut: handleStoredDataSignedOut,
  });

  const { progress, setProgress, activeBatchUiState, setActiveBatchUiState, persistedBatchUiState, setPersistedBatchUiState, setNonDecreasingProgress, animateTo, stopProgressCreep } = useAppBatchProgressState({ projects });

  const { pdWidth, viewerWidth, startResize } = useResizablePanels();



  const { setPdPanelRef, initNavCounter, navigateToPd, pdNavState, setPdNavState, pdNavIndexRef, pdNavTimerRef } = usePdPanelNavigation({ editorDomRef });

  useEffect(() => {
    if (currentProjectId && !projects.some((item) => item.id === currentProjectId)) {
      setCurrentProjectId(null);
    }
  }, [currentProjectId, projects, setCurrentProjectId]);

  // Sync lastSavedState with actual DOM after editor renders
  // Browser normalizes innerHTML (attribute order, whitespace) so the saved string
  // from buildAnnotatedHtml may differ from what the DOM produces.
  useEffect(() => {
    if (view !== VIEW_RESULT) return;
    const timer = setTimeout(() => {
      if (editorDomRef.current && lastSavedState) {
        const realHtml = editorDomRef.current.innerHTML;
        const nextSavedState = JSON.stringify({
          anonymized: JSON.stringify(anonymized),
          html: realHtml,
        });
        if (nextSavedState !== lastSavedState) {
          setLastSavedState(nextSavedState);
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [anonymized, editorDomRef, lastSavedState, setLastSavedState, view]); // sync saved snapshot with real DOM markup

  const { currentProject, currentBatchSession, currentBatchDisplayState, projectDocs, getProjectDocs, projectSummaryDoc, getProjectExistingPD } = useProjectDerivedState({
    projects, history, currentProjectId, activeBatchUiState, persistedBatchUiState,
  });

  const getProjectChunkDocKey = useCallback((doc) => {
    if (!doc || doc.isProjectSummary) return '';
    if (!doc.batchFileName || !doc.pageFrom || !doc.pageTo) return '';
    return `${doc.projectId || ''}::${doc.batchFileName}::${doc.pageFrom}::${doc.pageTo}`;
  }, []);

  const { cleanupDuplicateProjectChunkDocs, handleCreateProject, openProject, requestPauseActiveBatch, consumePauseBatchTargetView, clearActiveBatchTracking, saveProjectBatchSessionState, handleDeleteProject, handleRemoveDocFromProject, handleResetProjectBatchSession, openRecognizedDocResult, openDocFromProject, handleProjectImport, handleBuildSummary, handleConfirmRebuild, handleDeleteSummary, ensureUploadedSourceFile, goHomeAfterReset, goBackToProjectAfterReset, handleProjectTitleChange } = useProjectWorkspaceActions({
    user, projects, history, currentProjectId, currentProject, projectDocs, projectSummaryDoc, refreshHistory, refreshProjects,
    setProjects, setCurrentProjectId, setView, setFiles, setDocxFiles, setPastedText, setInputTab, setError, setWarningMessage,
    setProgress, setShowUnsaved, setShowCreateProject, setNewProjectTitle, setShowRebuildConfirm, setDocId, setDocTitle,
    setOriginalFileName, setSourceFiles, setPageMetadata, setRawText, setEditorHtml, setOriginalImages, setShowOriginal,
    setOriginalPage, setEditorCurrentPage, setEditorTotalPages, setEditorPageInput, setPdIdsInDoc, setPersonalData,
    setAnonymized, setLastSavedState, setShowLongDocWarning, setZoomActive, setZoomScale, setZoomOffset,
    setPersistedBatchUiState, setActiveBatchUiState, buildAnnotatedHtml, assignLetters, mergePD, getOtherPdMentions, pdRef,
    anonRef, undoStackRef, undoIndexRef, uploadedFilesRef, activeBatchControlRef, persistedBatchUiState, activeBatchUiState,
    newProjectTitle, getProjectChunkDocKey, viewHome: VIEW_HOME, viewProject: VIEW_PROJECT, viewResult: VIEW_RESULT,
  });

  const { handleProjectDocumentFiles, handleProjectDocxFiles, handleProjectDocumentDrop, removeFile, removeDocxFile, handleProjectRecognize } = useProjectRecognitionActions({
    apiKey, provider, user, currentProjectId, currentBatchSession, inputTab, files, setFiles, docxFiles, setDocxFiles,
    pastedText, setPastedText, projects, getProjectExistingPD, getProjectDocs, cleanupDuplicateProjectChunkDocs,
    saveProjectBatchSessionState, ensureUploadedSourceFile, mergePD, assignLetters, refreshHistory, refreshProjects,
    openRecognizedDocResult, activeBatchControlRef, consumePauseBatchTargetView, clearActiveBatchTracking, mergeBatchUiState,
    setActiveBatchUiState, setView, setError, setWarningMessage, setProgress, setOriginalImages, setIsDragging, animateTo,
    setNonDecreasingProgress, stopProgressCreep, viewProcessing: VIEW_PROCESSING, viewProject: VIEW_PROJECT,
    viewResult: VIEW_RESULT, formatDate,
  });

  const { performUndo, performRedo, countUncertain, countPageSeparators, handlePdClick, anonymizeAllByCategory, handleEditorHtmlChange, handleRemovePdMark, handleDeletePdEntry, handleAttachPdMark, handleAddPdMark, handleRemoveAmbiguousMark, openPdEditor, openPdFragmentEditor, handleSavePdEdit, handleSavePdFragmentEdit, handleApplyPdCanonicalText, handleUncertainResolved } = useEditorPdActions({
    editorDomRef, editorHtml, setEditorHtml, personalData, setPersonalData, anonymized, setAnonymized, pdRef, anonRef,
    undoStackRef, undoIndexRef, maxUndo: MAX_UNDO, pdCleanupTimerRef, currentProjectId, setPdIdsInDoc, pdNavTimerRef,
    pdNavIndexRef, setPdNavState, setEditingPdId, editingPdFragment, setEditingPdFragment, removeAmbiguousEntry,
    buildPdMatchPattern, patchPdMarks, initPdMarkOriginals, normalizePdText, dedupeMentions, getPersonMentions,
    getOtherPdMentions, buildCanonicalPersonMentions, alphaPrivate: ALPHA_PRIVATE, otherPdTypesMap: OTHER_PD_TYPES_MAP,
  });

  useGlobalUndoShortcuts({
    undoStackRef,
    performUndo,
    performRedo,
  });

  useStickyToolbarLayout({
    headerRef,
    titleRowRef,
    parseCssSize,
  });

  // ── Dirty check ──────────────────────────────────────────────────────────────
  const isDirty = () => {
    const currentHtml = editorDomRef.current?.innerHTML || '';
    if (!lastSavedState) return !!currentHtml;
    const saved = JSON.parse(lastSavedState);
    if (JSON.stringify(anonymized) !== saved.anonymized) return true;
    if (currentHtml !== saved.html) return true;
    return false;
  };

  const { handleEditorPageSubmit, handleEditorPageStep } = useEditorPageNavigation({
    view, viewResult: VIEW_RESULT, editorHtml, editorDomRef, pageMetadata, titleRowRef, originalImages,
    getOriginalImageIndexForPage, setOriginalPage, editorCurrentPage, setEditorCurrentPage, editorTotalPages,
    setEditorTotalPages, editorPageInput, setEditorPageInput, editorNavigatingPageRef, editorPageNavigationTimerRef,
  });

  const { handleSave, triggerExport, handleUncertainProceed: confirmUncertainProceed, handleUncertainCancel: confirmUncertainCancel } = useWorkspaceSaveActions({
    currentProjectId, docId, docTitle, originalFileName, sourceFiles, pageMetadata, rawText, editorHtml, personalData,
    anonymized, history, user, editorDomRef, refreshHistory, refreshProjects, setError, setLastSavedState, setSavedMsg,
    countUncertain, countPageSeparators, setPendingExportAction, setShowUncertainWarning, setHighlightUncertain,
  });

  const { privatePersons, profPersons, pdTypeGroups, pdTypeLabels, hasPD, currentEditingPd, currentEditingPdFragment, pdInDoc } = useResultWorkspaceState({
    personalData, editingPdId, editingPdFragment, pdIdsInDoc,
  });
  const uncertainCount = countUncertain();
  const separatorCount = countPageSeparators();
  const handleUncertainProceed = () => confirmUncertainProceed(pendingExportAction, setPendingExportAction);
  const handleUncertainCancel = () => confirmUncertainCancel(setPendingExportAction);

  const { goHome, goBackToProject, handleUnsavedSave, handleUnsavedDiscard } = useAppNavigationFlow({
    view, viewProcessing: VIEW_PROCESSING, viewResult: VIEW_RESULT, requestPauseActiveBatch, goHomeAfterReset,
    goBackToProjectAfterReset, isDirty, setShowUnsaved, pendingNavRef, handleSave,
  });

  const { headerProps, overlayProps, mainProps } = useAppViewProps({
    view, currentProjectId, user, goHome, goBackToProject, signOut, headerRef, projects, openProject,
    handleDeleteProject, formatDate, setShowCreateProject, currentProject, currentBatchSession,
    currentBatchDisplayState, provider, setProvider, apiKey, setApiKey, showApiKey, setShowApiKey, inputTab,
    setInputTab, isDragging, setIsDragging, projectFileInputRef, projectDocxInputRef, projectImportRef,
    handleProjectDocumentDrop, handleProjectDocumentFiles, handleProjectDocxFiles, files, docxFiles, removeFile,
    removeDocxFile, pastedText, setPastedText, requestPauseActiveBatch, handleResetProjectBatchSession,
    getBatchStatusTitle, getBatchResumeText, getBatchSourceSelectionHint, warningMessage, error,
    handleProjectRecognize, projectDocs, projectSummaryDoc, openDocFromProject, formatDocumentPageProgress,
    handleRemoveDocFromProject, handleBuildSummary, handleDeleteSummary, handleProjectImport,
    handleProjectTitleChange, progress, activeBatchUiState, setView, handlePdClick, pdWidth, setPdPanelRef,
    startResize, privatePersons, profPersons, pdTypeGroups, pdTypeLabels, anonymized, pdInDoc, initNavCounter,
    navigateToPd, openPdEditor, handleDeletePdEntry, anonymizeAllByCategory, pdNavState, docTitle, setDocTitle,
    titleRowRef, handleToggleOriginalViewer, handleLoadOriginalViewerImages, triggerExport, showLongDocWarning,
    setShowLongDocWarning, editorHtml, handleEditorHtmlChange, personalData, editorDomRef, highlightUncertain,
    editorTotalPages, editorCurrentPage, editorPageInput, editorPageInputRef, setEditorPageInput,
    handleEditorPageSubmit, handleEditorPageStep, handleRemovePdMark, handleApplyPdCanonicalText,
    openPdFragmentEditor, handleAttachPdMark, handleAddPdMark, handleRemoveAmbiguousMark, handleUncertainResolved,
    originalPage, setOriginalPage, zoomActive, setZoomActive, zoomScale, setZoomScale, viewerWidth, showOriginal,
    originalImages, hasPD, onCloseOriginal: () => setShowOriginal(false), showUncertainWarning, uncertainCount,
    separatorCount, handleUncertainProceed, handleUncertainCancel, savedMsg, showUnsaved, handleUnsavedSave,
    handleUnsavedDiscard, setShowUnsaved, currentEditingPd, setEditingPdId, handleSavePdEdit,
    currentEditingPdFragment, setEditingPdFragment, handleSavePdFragmentEdit, showCreateProject,
    newProjectTitle, setNewProjectTitle, handleCreateProject, showRebuildConfirm, handleConfirmRebuild,
    setShowRebuildConfirm,
  });

  const gateState = getAppGateState({
    isConfigured,
    authLoading,
    user,
    dataLoading,
  });

  if (gateState) {
    return (
      <AppGateScreen
        gateState={gateState}
        isConfigured={isConfigured}
        user={user}
        authLoading={authLoading}
        onSignIn={signInWithPassword}
        onSignUp={signUpWithPassword}
        onSignOut={() => signOut()}
      />
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  return <AppWorkspaceScreen headerProps={headerProps} overlayProps={overlayProps} mainProps={mainProps} />;
}
