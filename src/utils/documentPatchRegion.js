function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function countVisualUnits(text) {
  let units = 0;
  for (const char of normalizeWhitespace(text)) {
    if (char === ' ') {
      units += 0.35;
    } else if (/[.,;:!?'"()«»\-]/.test(char)) {
      units += 0.3;
    } else if (/[A-ZА-ЯЁ0-9]/.test(char)) {
      units += 1.05;
    } else {
      units += 0.9;
    }
  }
  return Number(units.toFixed(3));
}

function roundMetric(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Number(num.toFixed(3)) : null;
}

function withPadding(bbox, paddingX, paddingY) {
  if (!bbox) return null;
  return {
    left: bbox.left === null ? null : roundMetric(bbox.left - paddingX),
    top: bbox.top === null ? null : roundMetric(bbox.top - paddingY),
    right: bbox.right === null ? null : roundMetric(bbox.right + paddingX),
    bottom: bbox.bottom === null ? null : roundMetric(bbox.bottom + paddingY),
  };
}

export function buildPatchRegion({
  coordinateMatch,
  originalText,
  replacementText,
} = {}) {
  if (!coordinateMatch?.bbox) return null;

  const sourceText = normalizeWhitespace(originalText || coordinateMatch.searchText || coordinateMatch.matchedText || '');
  const targetText = normalizeWhitespace(replacementText || sourceText);
  const width = coordinateMatch.bbox.right !== null && coordinateMatch.bbox.left !== null
    ? roundMetric(coordinateMatch.bbox.right - coordinateMatch.bbox.left)
    : null;
  const height = coordinateMatch.bbox.bottom !== null && coordinateMatch.bbox.top !== null
    ? roundMetric(coordinateMatch.bbox.bottom - coordinateMatch.bbox.top)
    : null;

  const sourceUnits = countVisualUnits(sourceText);
  const replacementUnits = countVisualUnits(targetText);
  const avgUnitWidth = width && sourceUnits ? roundMetric(width / sourceUnits) : null;
  const estimatedReplacementWidth = avgUnitWidth ? roundMetric(avgUnitWidth * replacementUnits) : null;
  const fitRatio = width && estimatedReplacementWidth ? roundMetric(estimatedReplacementWidth / width) : null;
  const paddingX = width ? Math.max(1.5, width * 0.03) : 2;
  const paddingY = height ? Math.max(1.5, height * 0.2) : 2;

  return {
    pageNumber: coordinateMatch.pageNumber,
    sourceText,
    replacementText: targetText,
    spanStartIndex: coordinateMatch.spanStartIndex,
    spanEndIndex: coordinateMatch.spanEndIndex,
    spanCount: coordinateMatch.spanCount,
    sourceRect: {
      ...coordinateMatch.bbox,
      width,
      height,
    },
    paddedRect: withPadding(coordinateMatch.bbox, paddingX, paddingY),
    estimated: {
      sourceUnits,
      replacementUnits,
      avgUnitWidth,
      estimatedReplacementWidth,
      fitRatio,
      likelyFits: fitRatio === null ? null : fitRatio <= 1.12,
    },
  };
}
