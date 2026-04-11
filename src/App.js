import React, { useState, useRef, useCallback, useEffect } from 'react';
import AppHeader from './components/AppHeader';
import AppMainContent from './components/AppMainContent';
import AppOverlays from './components/AppOverlays';
import AuthScreen from './components/AuthScreen';
import { buildAnnotatedHtml, buildPdMatchPattern, patchPdMarks, initPdMarkOriginals } from './components/RichEditor';
import { useAuth } from './context/AuthContext';
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
import { exportDocument } from './utils/history';
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
  loadBatchProgressSnapshot,
  mergeBatchUiState,
  mergePD,
  normalizePdText,
  parseCssSize,
  saveBatchProgressSnapshot,
} from './utils/appWorkspaceHelpers';
import './App.css';

const VIEW_HOME = 'home';
const VIEW_PROCESSING = 'processing';
const VIEW_RESULT = 'result';
const VIEW_PROJECT = 'project';

export default function App() {
  const { user, loading: authLoading, isConfigured, signInWithPassword, signUpWithPassword, signOut } = useAuth();
  const userId = user?.id || null;
  const [view, setView] = useState(VIEW_HOME);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [provider, setProvider] = useState('claude');

  // ── Projects ──────────────────────────────────────────────────────────────
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);
  const [editingPdId, setEditingPdId] = useState(null);
  const [editingPdFragment, setEditingPdFragment] = useState(null);
  const [inputTab, setInputTab] = useState('documents'); // 'documents' | 'docx' | 'text'
  const [pdIdsInDoc, setPdIdsInDoc] = useState(null); // Set of PD ids present in current doc, or null if not in project

  const [files, setFiles] = useState([]);
  const [docxFiles, setDocxFiles] = useState([]);
  const [pastedText, setPastedText] = useState('');
  const [originalImages, setOriginalImages] = useState([]); // for file viewer
  const [showOriginal, setShowOriginal] = useState(false);
  const [originalPage, setOriginalPage] = useState(0);
  const [zoomActive, setZoomActive] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [, setZoomOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);


  const [progress, setProgress] = useState(null);
  const [activeBatchUiState, setActiveBatchUiState] = useState(null);
  const [persistedBatchUiState, setPersistedBatchUiState] = useState(() => loadBatchProgressSnapshot());
  const progressCreepRef = useRef(null);
  const activeBatchControlRef = useRef({
    projectId: null,
    pauseRequested: false,
    targetView: null,
  });

  const setNonDecreasingProgress = useCallback((next) => {
    setProgress(prev => prev && prev.percent > next.percent
      ? { ...prev, message: next.message }
      : next
    );
  }, []);

  // Animate progress bar smoothly to a target integer value
  const animateTo = useCallback((target, message) => {
    if (progressCreepRef.current) clearInterval(progressCreepRef.current);
    progressCreepRef.current = setInterval(() => {
      setProgress(prev => {
        if (!prev) return prev;
        const cur = Math.round(prev.percent);
        // Никогда не уменьшаем прогресс
        const safeTarget = Math.max(target, cur);
        if (cur >= safeTarget) {
          clearInterval(progressCreepRef.current);
          return { ...prev, percent: safeTarget, message: message || prev.message };
        }
        const step = Math.max(1, Math.round((safeTarget - cur) / 5));
        return { ...prev, percent: Math.min(cur + step, safeTarget) };
      });
    }, 100);
  }, []);

  const stopProgressCreep = useCallback(() => {
    if (progressCreepRef.current) {
      clearInterval(progressCreepRef.current);
      progressCreepRef.current = null;
    }
  }, []);
  const [error, setError] = useState(null);
  const [warningMessage, setWarningMessage] = useState(null);

  const [docId, setDocId] = useState(null);
  const [docTitle, setDocTitle] = useState('');
  const [originalFileName, setOriginalFileName] = useState('');
  const [sourceFiles, setSourceFiles] = useState([]);
  const [pageMetadata, setPageMetadata] = useState(null);
  const [rawText, setRawText] = useState('');
  // editorHtml is only used for initial load and save/export — NOT rebuilt on every anonymize
  const [editorHtml, setEditorHtml] = useState('');
  const [personalData, setPersonalData] = useState({ persons: [], otherPD: [], ambiguousPersons: [] });
  // anonymized: { [id]: bool }
  const [anonymized, setAnonymized] = useState({});
  const [lastSavedState, setLastSavedState] = useState(null);

  const [showUnsaved, setShowUnsaved] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [showUncertainWarning, setShowUncertainWarning] = useState(false);
  const [editorCurrentPage, setEditorCurrentPage] = useState(null);
  const [editorTotalPages, setEditorTotalPages] = useState(null);
  const [editorPageInput, setEditorPageInput] = useState('');
  const [showLongDocWarning, setShowLongDocWarning] = useState(false);
  const [highlightUncertain, setHighlightUncertain] = useState(false);
  const [pendingExportAction, setPendingExportAction] = useState(null); // 'save'|'pdf'|'docx'
  const pendingNavRef = useRef(null);
  const projectFileInputRef = useRef();
  const projectDocxInputRef = useRef();
  const projectImportRef = useRef();
  const editorPageInputRef = useRef(null);
  const editorNavigatingPageRef = useRef(null);
  const editorPageNavigationTimerRef = useRef(null);
  const uploadedFilesRef = useRef(new Map());

  const handleStoredDataError = useCallback((message) => {
    setError(message);
  }, []);

  const handleStoredDataSignedOut = useCallback(() => {
    setCurrentProjectId(null);
    uploadedFilesRef.current.clear();
  }, []);

  const handleToggleOriginalViewer = useCallback(() => {
    setShowOriginal((visible) => !visible);
    setOriginalPage(0);
  }, []);

  const handleLoadOriginalViewerImages = useCallback((allImages) => {
    setOriginalImages(allImages);
    setShowOriginal(true);
    setOriginalPage(0);
  }, []);

  const {
    dataLoading,
    history,
    projects,
    refreshHistory,
    refreshProjects,
    setProjects,
  } = useStoredData({
    authLoading,
    isConfigured,
    userId,
    onError: handleStoredDataError,
    onSignedOut: handleStoredDataSignedOut,
  });

  useEffect(() => {
    if (!activeBatchUiState) return;
    saveBatchProgressSnapshot(activeBatchUiState);
    setPersistedBatchUiState(activeBatchUiState);
  }, [activeBatchUiState]);

  useEffect(() => {
    const handler = () => {
      if (!activeBatchUiState) return;
      if (!['running', 'pausing'].includes(activeBatchUiState.status)) return;
      const pausedSnapshot = {
        ...activeBatchUiState,
        status: 'paused',
        message: activeBatchUiState.message || 'Обработка была приостановлена после обновления страницы.',
      };
      saveBatchProgressSnapshot(pausedSnapshot);
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activeBatchUiState]);

  const removeAmbiguousEntry = useCallback((pd, markEl) => {
    if (!markEl) return pd;
    const value = markEl.dataset?.value || '';
    const context = markEl.dataset?.context || '';
    const reason = markEl.dataset?.reason || '';
    return {
      ...pd,
      ambiguousPersons: (pd.ambiguousPersons || []).filter(item =>
        !(
          (item?.value || '') === value &&
          (item?.context || '') === context &&
          (item?.reason || '') === reason
        )
      ),
    };
  }, []);

  const { pdWidth, viewerWidth, startResize } = useResizablePanels();



  // Direct ref to the editor DOM element — used for DOM patching
  const editorDomRef = useRef(null);
  // Timer ref for deferred PD cleanup after editing
  const pdCleanupTimerRef = useRef(null);
  // Sync refs — always hold latest values so snapshot is always accurate
  const pdRef   = useRef({ persons: [], otherPD: [], ambiguousPersons: [] });
  const anonRef = useRef({});
  // Undo stack
  const undoStackRef  = useRef([]); // array of {html, pd, anon}
  const undoIndexRef  = useRef(-1);
  const MAX_UNDO = 80;
  const headerRef = useRef(null);
  // Ref to doc-title-row — used to measure its height for --toolbar-top CSS var
  const titleRowRef = useRef(null);
  const {
    setPdPanelRef,
    initNavCounter,
    navigateToPd,
    pdNavState,
    setPdNavState,
    pdNavIndexRef,
    pdNavTimerRef,
  } = usePdPanelNavigation({ editorDomRef });

  useEffect(() => {
    if (currentProjectId && !projects.some((item) => item.id === currentProjectId)) {
      setCurrentProjectId(null);
    }
  }, [currentProjectId, projects]);

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
  }, [anonymized, lastSavedState, view]); // sync saved snapshot with real DOM markup

  const {
    currentProject,
    currentBatchSession,
    currentBatchDisplayState,
    projectDocs,
    getProjectDocs,
    projectSummaryDoc,
    getProjectExistingPD,
  } = useProjectDerivedState({
    projects,
    history,
    currentProjectId,
    activeBatchUiState,
    persistedBatchUiState,
  });

  useEffect(() => {
    if (!persistedBatchUiState?.projectId) return;
    const matchingProject = projects.find((project) => project.id === persistedBatchUiState.projectId) || null;
    if (!matchingProject?.batchSession || matchingProject.batchSession.status === 'completed') {
      saveBatchProgressSnapshot(null);
      setPersistedBatchUiState(null);
      if (activeBatchUiState?.projectId === persistedBatchUiState.projectId) {
        setActiveBatchUiState(null);
      }
    }
  }, [activeBatchUiState, persistedBatchUiState, projects]);

  const getProjectChunkDocKey = useCallback((doc) => {
    if (!doc || doc.isProjectSummary) return '';
    if (!doc.batchFileName || !doc.pageFrom || !doc.pageTo) return '';
    return `${doc.projectId || ''}::${doc.batchFileName}::${doc.pageFrom}::${doc.pageTo}`;
  }, []);

  const {
    cleanupDuplicateProjectChunkDocs,
    handleCreateProject,
    openProject,
    requestPauseActiveBatch,
    consumePauseBatchTargetView,
    clearActiveBatchTracking,
    saveProjectBatchSessionState,
    handleDeleteProject,
    handleRemoveDocFromProject,
    handleResetProjectBatchSession,
    openRecognizedDocResult,
    openDocFromProject,
    handleProjectImport,
    handleBuildSummary,
    handleConfirmRebuild,
    handleDeleteSummary,
    ensureUploadedSourceFile,
    goHomeAfterReset,
    goBackToProjectAfterReset,
    handleProjectTitleChange,
  } = useProjectWorkspaceActions({
    user,
    projects,
    history,
    currentProjectId,
    currentProject,
    projectDocs,
    projectSummaryDoc,
    refreshHistory,
    refreshProjects,
    setProjects,
    setCurrentProjectId,
    setView,
    setFiles,
    setDocxFiles,
    setPastedText,
    setInputTab,
    setError,
    setWarningMessage,
    setProgress,
    setShowUnsaved,
    setShowCreateProject,
    setNewProjectTitle,
    setShowRebuildConfirm,
    setDocId,
    setDocTitle,
    setOriginalFileName,
    setSourceFiles,
    setPageMetadata,
    setRawText,
    setEditorHtml,
    setOriginalImages,
    setShowOriginal,
    setOriginalPage,
    setEditorCurrentPage,
    setEditorTotalPages,
    setEditorPageInput,
    setPdIdsInDoc,
    setPersonalData,
    setAnonymized,
    setLastSavedState,
    setShowLongDocWarning,
    setZoomActive,
    setZoomScale,
    setZoomOffset,
    setPersistedBatchUiState,
    setActiveBatchUiState,
    buildAnnotatedHtml,
    assignLetters,
    mergePD,
    getOtherPdMentions,
    pdRef,
    anonRef,
    undoStackRef,
    undoIndexRef,
    uploadedFilesRef,
    activeBatchControlRef,
    persistedBatchUiState,
    activeBatchUiState,
    newProjectTitle,
    getProjectChunkDocKey,
    viewHome: VIEW_HOME,
    viewProject: VIEW_PROJECT,
    viewResult: VIEW_RESULT,
  });

  const {
    handleProjectDocumentFiles,
    handleProjectDocxFiles,
    handleProjectDocumentDrop,
    removeFile,
    removeDocxFile,
    handleProjectRecognize,
  } = useProjectRecognitionActions({
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
    viewProcessing: VIEW_PROCESSING,
    viewProject: VIEW_PROJECT,
    viewResult: VIEW_RESULT,
    formatDate,
  });

  const {
    performUndo,
    performRedo,
    countUncertain,
    countPageSeparators,
    handlePdClick,
    anonymizeAllByCategory,
    handleEditorHtmlChange,
    handleRemovePdMark,
    handleDeletePdEntry,
    handleAttachPdMark,
    handleAddPdMark,
    handleRemoveAmbiguousMark,
    openPdEditor,
    openPdFragmentEditor,
    handleSavePdEdit,
    handleSavePdFragmentEdit,
    handleApplyPdCanonicalText,
    handleUncertainResolved,
  } = useEditorPdActions({
    editorDomRef,
    editorHtml,
    setEditorHtml,
    personalData,
    setPersonalData,
    anonymized,
    setAnonymized,
    pdRef,
    anonRef,
    undoStackRef,
    undoIndexRef,
    maxUndo: MAX_UNDO,
    pdCleanupTimerRef,
    currentProjectId,
    setPdIdsInDoc,
    pdNavTimerRef,
    pdNavIndexRef,
    setPdNavState,
    setEditingPdId,
    editingPdFragment,
    setEditingPdFragment,
    removeAmbiguousEntry,
    buildPdMatchPattern,
    patchPdMarks,
    initPdMarkOriginals,
    normalizePdText,
    dedupeMentions,
    getPersonMentions,
    getOtherPdMentions,
    buildCanonicalPersonMentions,
    alphaPrivate: ALPHA_PRIVATE,
    otherPdTypesMap: OTHER_PD_TYPES_MAP,
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

  // ── Navigation ────────────────────────────────────────────────────────────────
  const goHome = () => {
    if (view === VIEW_PROCESSING && requestPauseActiveBatch(VIEW_HOME)) {
      goHomeAfterReset();
      return;
    }
    if (view === VIEW_RESULT && isDirty()) {
      setShowUnsaved(true);
      pendingNavRef.current = 'home';
    } else {
      goHomeAfterReset();
    }
  };

  const goBackToProject = () => {
    if (view === VIEW_PROCESSING && requestPauseActiveBatch(VIEW_PROJECT)) {
      goBackToProjectAfterReset();
      return;
    }
    if (view === VIEW_RESULT && isDirty()) {
      setShowUnsaved(true);
      pendingNavRef.current = 'project';
    } else {
      goBackToProjectAfterReset();
    }
  };

  const handleUnsavedSave = async () => {
    await handleSave();
    setShowUnsaved(false);
    if (pendingNavRef.current === 'home') goHomeAfterReset();
    else if (pendingNavRef.current === 'project') goBackToProjectAfterReset();
    pendingNavRef.current = null;
  };

  const handleUnsavedDiscard = () => {
    setShowUnsaved(false);
    if (pendingNavRef.current === 'home') goHomeAfterReset();
    else if (pendingNavRef.current === 'project') goBackToProjectAfterReset();
    pendingNavRef.current = null;
  };

  const {
    handleEditorPageSubmit,
    handleEditorPageStep,
  } = useEditorPageNavigation({
    view,
    viewResult: VIEW_RESULT,
    editorHtml,
    editorDomRef,
    pageMetadata,
    titleRowRef,
    originalImages,
    getOriginalImageIndexForPage,
    setOriginalPage,
    editorCurrentPage,
    setEditorCurrentPage,
    editorTotalPages,
    setEditorTotalPages,
    editorPageInput,
    setEditorPageInput,
    editorNavigatingPageRef,
    editorPageNavigationTimerRef,
  });

  const {
    handleSave,
    triggerExport,
    handleUncertainProceed: confirmUncertainProceed,
    handleUncertainCancel: confirmUncertainCancel,
  } = useWorkspaceSaveActions({
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
  });

  const {
    privatePersons,
    profPersons,
    pdTypeGroups,
    pdTypeLabels,
    hasPD,
    currentEditingPd,
    currentEditingPdFragment,
    pdInDoc,
  } = useResultWorkspaceState({
    personalData,
    editingPdId,
    editingPdFragment,
    pdIdsInDoc,
  });
  const uncertainCount = countUncertain();
  const separatorCount = countPageSeparators();
  const handleUncertainProceed = () => confirmUncertainProceed(pendingExportAction, setPendingExportAction);
  const handleUncertainCancel = () => confirmUncertainCancel(setPendingExportAction);

  const homeProps = {
    projects,
    onCreateProject: () => setShowCreateProject(true),
    onOpenProject: openProject,
    onDeleteProject: handleDeleteProject,
    formatDate,
  };

  const projectProps = {
    currentProject,
    currentBatchSession,
    currentBatchDisplayState,
    provider,
    setProvider,
    apiKey,
    setApiKey,
    showApiKey,
    setShowApiKey,
    inputTab,
    setInputTab,
    isDragging,
    setIsDragging,
    projectFileInputRef,
    projectDocxInputRef,
    projectImportRef,
    handleProjectDocumentDrop,
    handleProjectDocumentFiles,
    handleProjectDocxFiles,
    files,
    docxFiles,
    removeFile,
    removeDocxFile,
    pastedText,
    setPastedText,
    requestPauseActiveBatch,
    handleResetProjectBatchSession,
    getBatchStatusTitle,
    getBatchResumeText,
    getBatchSourceSelectionHint,
    warningMessage,
    error,
    handleProjectRecognize,
    formatDate,
    projectDocs,
    projectSummaryDoc,
    openDocFromProject,
    formatDocumentPageProgress,
    handleRemoveDocFromProject,
    exportDocument,
    handleBuildSummary,
    handleDeleteSummary,
    handleProjectImport,
    onImportClick: () => projectImportRef.current?.click(),
    onProjectTitleChange: handleProjectTitleChange,
  };

  const processingProps = {
    progress,
    activeBatchUiState,
    onPause: () => requestPauseActiveBatch(VIEW_PROJECT),
    onResume: handleProjectRecognize,
    onReturnToProject: () => setView(VIEW_PROJECT),
  };

  const resultProps = {
    showOriginal,
    originalImages,
    hasPD,
    pdWidth,
    setPdPanelRef,
    startResize,
    privatePersons,
    profPersons,
    pdTypeGroups,
    pdTypeLabels,
    anonymized,
    pdInDoc,
    handlePdClick,
    initNavCounter,
    navigateToPd,
    openPdEditor,
    handleDeletePdEntry,
    anonymizeAllByCategory,
    pdNavState,
    docTitle,
    setDocTitle,
    titleRowRef,
    handleToggleOriginalViewer,
    handleLoadOriginalViewerImages,
    triggerExport,
    showLongDocWarning,
    setShowLongDocWarning,
    editorHtml,
    handleEditorHtmlChange,
    personalData,
    editorDomRef,
    highlightUncertain,
    editorTotalPages,
    editorCurrentPage,
    editorPageInput,
    editorPageInputRef,
    setEditorPageInput,
    handleEditorPageSubmit,
    handleEditorPageStep,
    handlePdClickFromEditor: handlePdClick,
    handleRemovePdMark,
    handleApplyPdCanonicalText,
    openPdFragmentEditor,
    handleAttachPdMark,
    handleAddPdMark,
    handleRemoveAmbiguousMark,
    handleUncertainResolved,
    originalPage,
    setOriginalPage,
    zoomActive,
    setZoomActive,
    zoomScale,
    setZoomScale,
    viewerWidth,
    onCloseOriginal: () => setShowOriginal(false),
  };

  if (isConfigured && authLoading) {
    return (
      <div className="app">
        <main className="main auth-main">
          <section className="card auth-card auth-loading-card">
            <h1 className="auth-title">Загрузка профиля</h1>
          </section>
        </main>
      </div>
    );
  }

  if (isConfigured && !user) {
    return (
      <div className="app">
        <AppHeader showNavigation={false} />
        <AuthScreen
          isConfigured={isConfigured}
          onSignIn={signInWithPassword}
          onSignUp={signUpWithPassword}
          loading={authLoading}
        />
      </div>
    );
  }

  if (dataLoading) {
    return (
      <div className="app">
        <AppHeader user={user} onSignOut={() => signOut()} showNavigation={false} />
        <main className="main auth-main">
          <section className="card auth-card auth-loading-card">
            <h1 className="auth-title">Загрузка данных</h1>
          </section>
        </main>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div className="app">
      <AppHeader
        view={view}
        currentProjectId={currentProjectId}
        user={user}
        onGoHome={goHome}
        onGoBackToProject={goBackToProject}
        onSignOut={() => signOut()}
        headerRef={headerRef}
      />

      <AppOverlays
        showUncertainWarning={showUncertainWarning}
        uncertainCount={uncertainCount}
        separatorCount={separatorCount}
        onUncertainProceed={handleUncertainProceed}
        onUncertainCancel={handleUncertainCancel}
        savedMsg={savedMsg}
        showUnsaved={showUnsaved}
        docTitle={docTitle}
        onUnsavedSave={handleUnsavedSave}
        onUnsavedDiscard={handleUnsavedDiscard}
        onUnsavedClose={() => setShowUnsaved(false)}
        currentEditingPd={currentEditingPd}
        onClosePdEditor={() => setEditingPdId(null)}
        onSavePdEdit={handleSavePdEdit}
        currentEditingPdFragment={currentEditingPdFragment}
        onClosePdFragmentEditor={() => setEditingPdFragment(null)}
        onSavePdFragmentEdit={handleSavePdFragmentEdit}
        showCreateProject={showCreateProject}
        newProjectTitle={newProjectTitle}
        setNewProjectTitle={setNewProjectTitle}
        onCreateProject={handleCreateProject}
        onCloseCreateProject={() => {
          setShowCreateProject(false);
          setNewProjectTitle('');
        }}
        showRebuildConfirm={showRebuildConfirm}
        onConfirmRebuild={handleConfirmRebuild}
        onCloseRebuildConfirm={() => setShowRebuildConfirm(false)}
      />

      <main className={`main${view === VIEW_RESULT ? ' main-result' : ''}`}>
        <AppMainContent
          view={view}
          viewHome={VIEW_HOME}
          viewProcessing={VIEW_PROCESSING}
          viewProject={VIEW_PROJECT}
          viewResult={VIEW_RESULT}
          homeProps={homeProps}
          projectProps={projectProps}
          processingProps={processingProps}
          resultProps={resultProps}
        />
      </main>

      <footer className="footer">
        ЮрДок — обработка происходит только в вашем браузере, документы не сохраняются на серверах
      </footer>
    </div>
  );
}
