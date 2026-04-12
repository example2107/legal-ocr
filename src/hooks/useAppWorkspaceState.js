import { useCallback, useRef, useState } from 'react';

export function useAppWorkspaceState() {
  const [view, setView] = useState('home');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [provider, setProvider] = useState('claude');

  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);
  const [editingPdId, setEditingPdId] = useState(null);
  const [editingPdFragment, setEditingPdFragment] = useState(null);
  const [inputTab, setInputTab] = useState('documents');
  const [pdIdsInDoc, setPdIdsInDoc] = useState(null);

  const [files, setFiles] = useState([]);
  const [docxFiles, setDocxFiles] = useState([]);
  const [pastedText, setPastedText] = useState('');
  const [originalImages, setOriginalImages] = useState([]);
  const [showOriginal, setShowOriginal] = useState(false);
  const [originalPage, setOriginalPage] = useState(0);
  const [zoomActive, setZoomActive] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [, setZoomOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const [error, setError] = useState(null);
  const [warningMessage, setWarningMessage] = useState(null);

  const [docId, setDocId] = useState(null);
  const [docTitle, setDocTitle] = useState('');
  const [originalFileName, setOriginalFileName] = useState('');
  const [sourceFiles, setSourceFiles] = useState([]);
  const [pageMetadata, setPageMetadata] = useState(null);
  const [rawText, setRawText] = useState('');
  const [editorHtml, setEditorHtml] = useState('');
  const [personalData, setPersonalData] = useState({ persons: [], otherPD: [], ambiguousPersons: [] });
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
  const [pendingExportAction, setPendingExportAction] = useState(null);

  const activeBatchControlRef = useRef({
    projectId: null,
    pauseRequested: false,
    targetView: null,
  });
  const pendingNavRef = useRef(null);
  const projectFileInputRef = useRef();
  const projectDocxInputRef = useRef();
  const projectImportRef = useRef();
  const editorPageInputRef = useRef(null);
  const editorNavigatingPageRef = useRef(null);
  const editorPageNavigationTimerRef = useRef(null);
  const uploadedFilesRef = useRef(new Map());
  const editorDomRef = useRef(null);
  const pdCleanupTimerRef = useRef(null);
  const pdRef = useRef({ persons: [], otherPD: [], ambiguousPersons: [] });
  const anonRef = useRef({});
  const undoStackRef = useRef([]);
  const undoIndexRef = useRef(-1);
  const headerRef = useRef(null);
  const titleRowRef = useRef(null);
  const MAX_UNDO = 80;

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

  const removeAmbiguousEntry = useCallback((pd, markEl) => {
    if (!markEl) return pd;
    const value = markEl.dataset?.value || '';
    const context = markEl.dataset?.context || '';
    const reason = markEl.dataset?.reason || '';
    return {
      ...pd,
      ambiguousPersons: (pd.ambiguousPersons || []).filter((item) => !(
        (item?.value || '') === value &&
        (item?.context || '') === context &&
        (item?.reason || '') === reason
      )),
    };
  }, []);

  return {
    view, setView, apiKey, setApiKey, showApiKey, setShowApiKey, provider, setProvider,
    currentProjectId, setCurrentProjectId, showCreateProject, setShowCreateProject,
    newProjectTitle, setNewProjectTitle, showRebuildConfirm, setShowRebuildConfirm,
    editingPdId, setEditingPdId, editingPdFragment, setEditingPdFragment,
    inputTab, setInputTab, pdIdsInDoc, setPdIdsInDoc, files, setFiles, docxFiles, setDocxFiles,
    pastedText, setPastedText, originalImages, setOriginalImages, showOriginal, setShowOriginal,
    originalPage, setOriginalPage, zoomActive, setZoomActive, zoomScale, setZoomScale,
    setZoomOffset, isDragging, setIsDragging, error, setError, warningMessage, setWarningMessage,
    docId, setDocId, docTitle, setDocTitle, originalFileName, setOriginalFileName,
    sourceFiles, setSourceFiles, pageMetadata, setPageMetadata, rawText, setRawText,
    editorHtml, setEditorHtml, personalData, setPersonalData, anonymized, setAnonymized,
    lastSavedState, setLastSavedState, showUnsaved, setShowUnsaved, savedMsg, setSavedMsg,
    showUncertainWarning, setShowUncertainWarning, editorCurrentPage, setEditorCurrentPage,
    editorTotalPages, setEditorTotalPages, editorPageInput, setEditorPageInput,
    showLongDocWarning, setShowLongDocWarning, highlightUncertain, setHighlightUncertain,
    pendingExportAction, setPendingExportAction, activeBatchControlRef, pendingNavRef,
    projectFileInputRef, projectDocxInputRef, projectImportRef, editorPageInputRef,
    editorNavigatingPageRef, editorPageNavigationTimerRef, uploadedFilesRef, editorDomRef,
    pdCleanupTimerRef, pdRef, anonRef, undoStackRef, undoIndexRef, headerRef, titleRowRef,
    MAX_UNDO, handleStoredDataError, handleStoredDataSignedOut, handleToggleOriginalViewer,
    handleLoadOriginalViewerImages, removeAmbiguousEntry,
  };
}
