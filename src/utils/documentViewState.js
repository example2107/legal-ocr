export function buildLoadedDocumentState({
  entry,
  images = [],
  currentProjectId,
  buildAnnotatedHtml,
  extractPdIdsFromHtml,
  shouldShowLongDocWarningForEntry,
}) {
  const pd = entry.personalData || { persons: [], otherPD: [], ambiguousPersons: [] };
  const anon = entry.anonymized || {};
  const html = entry.editedHtml || buildAnnotatedHtml(entry.text || '', pd, anon);

  return {
    docId: entry.id,
    docTitle: entry.title || '',
    originalFileName: entry.originalFileName || '',
    sourceFiles: entry.sourceFiles || [],
    rawText: entry.text || '',
    editorHtml: html,
    originalImages: images,
    showOriginal: images.length > 0,
    originalPage: 0,
    pdIdsInDoc: currentProjectId ? extractPdIdsFromHtml(html) : null,
    personalData: pd,
    anonymized: anon,
    lastSavedState: JSON.stringify({ anonymized: JSON.stringify(anon), html }),
    initialUndoSnapshot: { html, pd, anon },
    showLongDocWarning: shouldShowLongDocWarningForEntry(entry),
  };
}

export function getClearedWorkspaceState() {
  return {
    files: [],
    pastedText: '',
    originalImages: [],
    showOriginal: false,
    originalPage: 0,
    zoomActive: false,
    zoomScale: 1,
    zoomOffset: { x: 0, y: 0 },
    originalFileName: '',
    sourceFiles: [],
    error: null,
    progress: null,
    showUnsaved: false,
  };
}
