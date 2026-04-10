import { normalizeDocumentCoordinateLayer } from './documentCoordinateLayer';

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\[PAGE:\d+\]/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMatchText(value, { loose = false } = {}) {
  let text = normalizeWhitespace(value)
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[‐‑–—−]/g, '-');

  if (loose) {
    text = text
      .replace(/\s*([,.;:!?%)\]})])/g, '$1')
      .replace(/([([{"])\s*/g, '$1');
  }

  return text.toLowerCase();
}

function isClosingPunctuation(text) {
  return /^[,.;:!?%)\]}"»]/.test(text);
}

function isOpeningPunctuation(text) {
  return /^[([{'"«]/.test(text);
}

function isInitialGroup(text) {
  return /^[a-zа-яё]\.$/i.test(text);
}

function getSeparator(previousText, nextText) {
  if (!previousText || !nextText) return '';
  if (isClosingPunctuation(nextText) || isOpeningPunctuation(previousText)) return '';
  if (isInitialGroup(previousText) && isInitialGroup(nextText)) return '';
  if (/\($/.test(previousText) || /^\)/.test(nextText)) return '';
  return ' ';
}

function buildPageIndex(page) {
  let exactText = '';
  let looseText = '';
  const segments = [];

  for (const span of page.spans || []) {
    const exactSpanText = normalizeWhitespace(span.searchText || span.text || '');
    if (!exactSpanText) continue;

    const looseSpanText = normalizeMatchText(exactSpanText, { loose: true });
    const exactSeparator = getSeparator(segments[segments.length - 1]?.exactText || '', exactSpanText);
    const looseSeparator = getSeparator(segments[segments.length - 1]?.looseText || '', looseSpanText);

    const exactStart = exactText.length + exactSeparator.length;
    const looseStart = looseText.length + looseSeparator.length;

    exactText += exactSeparator + exactSpanText;
    looseText += looseSeparator + looseSpanText;
    segments.push({
      span,
      exactText: exactSpanText,
      looseText: looseSpanText,
      exactStart,
      exactEnd: exactStart + exactSpanText.length,
      looseStart,
      looseEnd: looseStart + looseSpanText.length,
    });
  }

  return {
    pageNumber: page.pageNumber,
    exactText: normalizeMatchText(exactText),
    looseText: normalizeMatchText(looseText, { loose: true }),
    segments,
  };
}

function findOccurrencePositions(haystack, needle) {
  if (!haystack || !needle) return [];
  const positions = [];
  let startIndex = 0;

  while (startIndex < haystack.length) {
    const foundIndex = haystack.indexOf(needle, startIndex);
    if (foundIndex === -1) break;
    positions.push(foundIndex);
    startIndex = foundIndex + 1;
  }

  return positions;
}

function getMatchedSegments(segments, start, end, mode) {
  const startKey = mode === 'loose' ? 'looseStart' : 'exactStart';
  const endKey = mode === 'loose' ? 'looseEnd' : 'exactEnd';

  return segments.filter((segment) => segment[endKey] > start && segment[startKey] < end);
}

function buildBoundingBox(spans) {
  const leftValues = spans.map((span) => span.x).filter((value) => Number.isFinite(value));
  const topValues = spans.map((span) => span.top).filter((value) => Number.isFinite(value));
  const rightValues = spans.map((span) => span.right).filter((value) => Number.isFinite(value));
  const bottomValues = spans.map((span) => span.bottom).filter((value) => Number.isFinite(value));

  return {
    left: leftValues.length > 0 ? Math.min(...leftValues) : null,
    top: topValues.length > 0 ? Math.min(...topValues) : null,
    right: rightValues.length > 0 ? Math.max(...rightValues) : null,
    bottom: bottomValues.length > 0 ? Math.max(...bottomValues) : null,
  };
}

function buildMatch(pageNumber, matchedSegments, start, end, score, mode) {
  const spans = matchedSegments.map((segment) => segment.span);
  if (spans.length === 0) return null;

  const bbox = buildBoundingBox(spans);
  return {
    pageNumber,
    score,
    matchMode: mode,
    start,
    end,
    spanStartIndex: spans[0].index,
    spanEndIndex: spans[spans.length - 1].index,
    spanCount: spans.length,
    matchedText: spans.map((span) => span.text).join(' '),
    searchText: spans.map((span) => span.searchText).join(' '),
    bbox,
    spans,
  };
}

export function findCoordinateMatches({
  fragmentText,
  coordinateLayer,
  preferredPageNumber = null,
  maxMatches = 5,
} = {}) {
  const normalizedLayer = normalizeDocumentCoordinateLayer({ coordinateLayer });
  if (!normalizedLayer || !Array.isArray(normalizedLayer.pages) || normalizedLayer.pages.length === 0) {
    return [];
  }

  const exactNeedle = normalizeMatchText(fragmentText);
  if (!exactNeedle) return [];
  const looseNeedle = normalizeMatchText(fragmentText, { loose: true });

  const matches = [];
  for (const page of normalizedLayer.pages) {
    const pageIndex = buildPageIndex(page);

    for (const position of findOccurrencePositions(pageIndex.exactText, exactNeedle)) {
      const matchedSegments = getMatchedSegments(
        pageIndex.segments,
        position,
        position + exactNeedle.length,
        'exact'
      );
      const pageBoost = preferredPageNumber && page.pageNumber === preferredPageNumber ? 0.05 : 0;
      const match = buildMatch(page.pageNumber, matchedSegments, position, position + exactNeedle.length, 1 + pageBoost, 'exact');
      if (match) matches.push(match);
    }

    if (matches.some((match) => match.pageNumber === page.pageNumber && match.matchMode === 'exact')) {
      continue;
    }

    if (!looseNeedle) continue;
    for (const position of findOccurrencePositions(pageIndex.looseText, looseNeedle)) {
      const matchedSegments = getMatchedSegments(
        pageIndex.segments,
        position,
        position + looseNeedle.length,
        'loose'
      );
      const pageBoost = preferredPageNumber && page.pageNumber === preferredPageNumber ? 0.05 : 0;
      const match = buildMatch(page.pageNumber, matchedSegments, position, position + looseNeedle.length, 0.8 + pageBoost, 'loose');
      if (match) matches.push(match);
    }
  }

  return matches
    .sort((a, b) => (
      b.score - a.score
      || a.pageNumber - b.pageNumber
      || a.spanStartIndex - b.spanStartIndex
    ))
    .slice(0, Math.max(1, maxMatches));
}

export function findBestCoordinateMatch(options) {
  return findCoordinateMatches({ ...options, maxMatches: 1 })[0] || null;
}
