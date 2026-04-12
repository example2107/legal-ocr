const PAGE_METADATA_VERSION = 1;

function toPositiveNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeSourceFile(sourceFile, fallback = {}) {
  if (!sourceFile && !fallback.originalFileName && !fallback.batchFileName) return null;

  return {
    name: sourceFile?.name || fallback.originalFileName || fallback.batchFileName || '',
    size: toPositiveNumberOrNull(sourceFile?.size),
    type: sourceFile?.type || '',
    bucket: sourceFile?.bucket || '',
    storagePath: sourceFile?.storagePath || '',
    uploadedAt: sourceFile?.uploadedAt || '',
  };
}

function buildPagesFromRange(pageFrom, pageTo) {
  const safeFrom = toPositiveNumberOrNull(pageFrom);
  const safeTo = toPositiveNumberOrNull(pageTo);
  if (!safeFrom || !safeTo || safeTo < safeFrom) return [];

  const pages = [];
  for (let pageNumber = safeFrom; pageNumber <= safeTo; pageNumber += 1) {
    pages.push({
      pageNumber,
      chunkPageIndex: pageNumber - safeFrom + 1,
      pdfWidth: null,
      pdfHeight: null,
      renderWidth: null,
      renderHeight: null,
      rotation: 0,
      mediaType: '',
    });
  }
  return pages;
}

function normalizePage(page, index, fallbackPageNumber = null) {
  const pageNumber = toPositiveNumberOrNull(page?.pageNumber || page?.pageNum || fallbackPageNumber);
  if (!pageNumber) return null;

  return {
    pageNumber,
    chunkPageIndex: toPositiveNumberOrNull(page?.chunkPageIndex) || index + 1,
    pdfWidth: toNumberOrNull(page?.pdfWidth),
    pdfHeight: toNumberOrNull(page?.pdfHeight),
    renderWidth: toPositiveNumberOrNull(page?.renderWidth || page?.width),
    renderHeight: toPositiveNumberOrNull(page?.renderHeight || page?.height),
    rotation: toNumberOrNull(page?.rotation) || 0,
    mediaType: page?.mediaType || '',
  };
}

function getNormalizedSourceRange(source, fallback) {
  return {
    pageFrom: toPositiveNumberOrNull(source?.pageFrom || fallback.pageFrom),
    pageTo: toPositiveNumberOrNull(source?.pageTo || fallback.pageTo),
    totalPages: toPositiveNumberOrNull(source?.totalPages || fallback.totalPages),
  };
}

function buildNormalizedPages(source, pageFrom) {
  const rawPages = Array.isArray(source?.pages) && source.pages.length > 0
    ? source.pages
    : buildPagesFromRange(pageFrom, toPositiveNumberOrNull(source?.pageTo));

  return rawPages
    .map((page, index) => normalizePage(page, index, pageFrom ? pageFrom + index : null))
    .filter(Boolean);
}

function normalizeSourceEntry(source, fallback = {}) {
  const { pageFrom, pageTo, totalPages } = getNormalizedSourceRange(source, fallback);
  const pages = buildNormalizedPages(
    {
      ...source,
      pageTo,
    },
    pageFrom,
  );

  if (!pageFrom && !pageTo && pages.length === 0) return null;

  return {
    sourceFile: normalizeSourceFile(
      source?.sourceFile || source?.source,
      fallback
    ),
    batchFileName: source?.batchFileName || fallback.batchFileName || '',
    projectId: source?.projectId || fallback.projectId || null,
    pageFrom: pageFrom || pages[0]?.pageNumber || null,
    pageTo: pageTo || pages[pages.length - 1]?.pageNumber || null,
    totalPages,
    pages,
  };
}

function buildSourceKey(source) {
  return [
    source?.sourceFile?.storagePath || '',
    source?.sourceFile?.name || '',
    source?.batchFileName || '',
    source?.projectId || '',
  ].join('::');
}

function mergePageRange(currentValue, nextValue, compareFn) {
  if (currentValue && nextValue) {
    return compareFn(currentValue, nextValue);
  }
  return currentValue || nextValue || null;
}

function appendSourceToMap(sourceMap, source) {
  const key = buildSourceKey(source);
  const existing = sourceMap.get(key);
  if (!existing) {
    sourceMap.set(key, {
      ...source,
      pages: [...(source.pages || [])],
    });
    return;
  }

  existing.pages = [...(existing.pages || []), ...(source.pages || [])];
  existing.pageFrom = mergePageRange(existing.pageFrom, source.pageFrom, Math.min);
  existing.pageTo = mergePageRange(existing.pageTo, source.pageTo, Math.max);
  existing.totalPages = existing.totalPages || source.totalPages || null;
}

function dedupeAndNormalizePages(pages = []) {
  const sortedPages = [...pages].sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));
  const uniquePages = [];

  sortedPages.forEach((page) => {
    if (!page?.pageNumber) return;
    if (uniquePages.some((item) => item.pageNumber === page.pageNumber)) return;
    uniquePages.push({
      ...page,
      chunkPageIndex: uniquePages.length + 1,
    });
  });

  return uniquePages;
}

export function buildDocumentPageMetadata({
  sourceFile = null,
  sourceFiles = [],
  batchFileName = '',
  projectId = null,
  pageFrom = null,
  pageTo = null,
  totalPages = null,
  pages = [],
} = {}) {
  const primarySourceFile = sourceFile || (Array.isArray(sourceFiles) ? sourceFiles[0] : null);
  const source = normalizeSourceEntry({
    sourceFile: primarySourceFile,
    batchFileName,
    projectId,
    pageFrom,
    pageTo,
    totalPages,
    pages,
  });

  if (!source) return null;
  return {
    version: PAGE_METADATA_VERSION,
    sources: [source],
  };
}

export function normalizeDocumentPageMetadata(entry = {}) {
  const safeEntry = entry || {};
  const metadata = safeEntry.pageMetadata;
  if (metadata && Array.isArray(metadata.sources)) {
    const sources = metadata.sources
      .map((source) => normalizeSourceEntry(source, safeEntry))
      .filter(Boolean);

    if (sources.length > 0) {
      return {
        version: PAGE_METADATA_VERSION,
        sources,
      };
    }
  }

  return buildDocumentPageMetadata({
    sourceFiles: safeEntry.sourceFiles,
    batchFileName: safeEntry.batchFileName,
    projectId: safeEntry.projectId,
    pageFrom: safeEntry.pageFrom,
    pageTo: safeEntry.pageTo,
    totalPages: safeEntry.totalPages,
  });
}

export function mergeDocumentPageMetadata(entries = []) {
  const sourceMap = new Map();
  entries.forEach((entry) => {
    const metadata = normalizeDocumentPageMetadata(entry);
    (metadata?.sources || []).forEach((source) => appendSourceToMap(sourceMap, source));
  });

  const sources = Array.from(sourceMap.values())
    .map((source) => ({
      ...source,
      pages: dedupeAndNormalizePages(source.pages || []),
    }))
    .sort((a, b) => (a.pageFrom || 0) - (b.pageFrom || 0));

  if (sources.length === 0) return null;
  return {
    version: PAGE_METADATA_VERSION,
    sources,
  };
}
