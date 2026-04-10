const COORDINATE_LAYER_VERSION = 1;

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toPositiveNumberOrNull(value) {
  const num = toNumberOrNull(value);
  return num !== null && num > 0 ? num : null;
}

function roundCoord(value) {
  const num = toNumberOrNull(value);
  return num === null ? null : Number(num.toFixed(3));
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTransform(transform) {
  if (!Array.isArray(transform) || transform.length < 6) return null;
  return transform.slice(0, 6).map(roundCoord);
}

function buildSpanFromPdfTextItem(item, index) {
  const text = String(item?.str || '');
  const searchText = normalizeText(text);
  if (!searchText) return null;

  const transform = normalizeTransform(item?.transform);
  const x = transform?.[4] ?? roundCoord(item?.x);
  const baselineY = transform?.[5] ?? roundCoord(item?.y);
  const width = roundCoord(item?.width);
  const height = roundCoord(Math.abs(toNumberOrNull(item?.height) || transform?.[3] || 0));
  const top = baselineY !== null && height !== null ? roundCoord(baselineY - height) : null;
  const right = x !== null && width !== null ? roundCoord(x + width) : null;
  const bottom = top !== null && height !== null ? roundCoord(top + height) : null;

  return {
    index: index + 1,
    text,
    searchText,
    dir: item?.dir || 'ltr',
    fontName: item?.fontName || '',
    hasEOL: !!item?.hasEOL,
    x,
    baselineY,
    top,
    width,
    height,
    right,
    bottom,
    transform,
  };
}

function normalizeSpan(span, index) {
  if (!span) return null;
  const text = String(span.text || '');
  const searchText = normalizeText(span.searchText || text);
  if (!searchText) return null;

  return {
    index: toPositiveNumberOrNull(span.index) || index + 1,
    text,
    searchText,
    dir: span.dir || 'ltr',
    fontName: span.fontName || '',
    hasEOL: !!span.hasEOL,
    x: roundCoord(span.x),
    baselineY: roundCoord(span.baselineY),
    top: roundCoord(span.top),
    width: roundCoord(span.width),
    height: roundCoord(span.height),
    right: roundCoord(span.right),
    bottom: roundCoord(span.bottom),
    transform: normalizeTransform(span.transform),
  };
}

function buildPageFromPdfPage(page, index) {
  const pageNumber = toPositiveNumberOrNull(page?.pageNumber || page?.pageNum);
  if (!pageNumber) return null;

  const rawTextItems = Array.isArray(page?.textItems)
    ? page.textItems
    : Array.isArray(page?.spans)
      ? page.spans
    : Array.isArray(page?.textLayer?.items)
      ? page.textLayer.items
      : [];
  const spans = rawTextItems
    .map((item, spanIndex) => {
      const candidate = item?.str !== undefined
        ? buildSpanFromPdfTextItem(item, spanIndex)
        : normalizeSpan(item, spanIndex);
      return candidate;
    })
    .filter(Boolean);

  return {
    pageNumber,
    chunkPageIndex: toPositiveNumberOrNull(page?.chunkPageIndex) || index + 1,
    pdfWidth: roundCoord(page?.pdfWidth),
    pdfHeight: roundCoord(page?.pdfHeight),
    rotation: roundCoord(page?.rotation) || 0,
    textSource: page?.textSource || (spans.length > 0 ? 'pdfjs-text-content' : 'missing-text-layer'),
    hasText: spans.length > 0,
    spanCount: spans.length,
    spans,
  };
}

function normalizePage(page, index) {
  if (!page) return null;
  if (Array.isArray(page.spans) || Array.isArray(page.textItems) || page.textLayer) {
    return buildPageFromPdfPage(page, index);
  }
  return null;
}

export function buildDocumentCoordinateLayer({ pages = [] } = {}) {
  const normalizedPages = (pages || [])
    .map((page, index) => normalizePage(page, index))
    .filter(Boolean);

  if (normalizedPages.length === 0) return null;
  return {
    version: COORDINATE_LAYER_VERSION,
    provider: 'pdfjs-text-content',
    pages: normalizedPages,
  };
}

export function normalizeDocumentCoordinateLayer(entry = {}) {
  const safeEntry = entry || {};
  const layer = safeEntry.coordinateLayer;
  if (!layer || !Array.isArray(layer.pages)) return null;

  const pages = layer.pages
    .map((page, index) => normalizePage(page, index))
    .filter(Boolean);

  if (pages.length === 0) return null;
  return {
    version: COORDINATE_LAYER_VERSION,
    provider: layer.provider || 'pdfjs-text-content',
    pages,
  };
}

export function mergeDocumentCoordinateLayer(entries = []) {
  const pageMap = new Map();
  entries.forEach((entry) => {
    const layer = normalizeDocumentCoordinateLayer(entry);
    (layer?.pages || []).forEach((page) => {
      const pageNumber = toPositiveNumberOrNull(page?.pageNumber);
      if (!pageNumber) return;
      pageMap.set(pageNumber, page);
    });
  });

  const pages = Array.from(pageMap.values()).sort((a, b) => a.pageNumber - b.pageNumber);
  if (pages.length === 0) return null;
  return {
    version: COORDINATE_LAYER_VERSION,
    provider: 'pdfjs-text-content',
    pages,
  };
}
