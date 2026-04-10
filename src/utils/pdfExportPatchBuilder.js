import { findCoordinateMatches } from './documentCoordinateMatcher';
import { buildPatchPlan } from './documentPatchPlan';
import { buildPatchRegion } from './documentPatchRegion';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getPreferredPdfPageForMark(editorEl, markEl, pageMetadata, coordinateLayer) {
  if (!editorEl || !markEl?.isConnected) return null;

  const separators = Array.from(editorEl.querySelectorAll('.page-separator[data-page]'));
  let relativePage = 1;
  for (const separator of separators) {
    if (separator === markEl) continue;
    if (separator.compareDocumentPosition(markEl) & Node.DOCUMENT_POSITION_FOLLOWING) {
      relativePage = Number(separator.dataset.page || relativePage);
    } else {
      break;
    }
  }

  const absoluteStartPage = pageMetadata?.sources?.[0]?.pageFrom
    || coordinateLayer?.pages?.[0]?.pageNumber
    || 1;

  return absoluteStartPage + relativePage - 1;
}

function getSourceForPage(pageMetadata, pageNumber) {
  const sources = pageMetadata?.sources || [];
  return sources.find((source) => (
    Number(source?.pageFrom || 0) <= Number(pageNumber || 0)
    && Number(source?.pageTo || 0) >= Number(pageNumber || 0)
  )) || sources[0] || null;
}

function pickUnusedMatch(matches, usedMatches) {
  for (const match of matches || []) {
    const key = `${match.pageNumber}:${match.spanStartIndex}:${match.spanEndIndex}`;
    if (usedMatches.has(key)) continue;
    usedMatches.add(key);
    return match;
  }
  return matches?.[0] || null;
}

export function buildPdfExportPatchEntries({
  editorEl,
  anonymized = {},
  coordinateLayer = null,
  pageMetadata = null,
} = {}) {
  if (!editorEl) return [];

  const anonMarks = Array.from(editorEl.querySelectorAll('mark.pd.anon[data-pd-id]'));
  if (anonMarks.length === 0) return [];

  const usedMatches = new Set();

  return anonMarks.map((markEl, index) => {
    const pdId = String(markEl.dataset.pdId || '');
    const originalText = normalizeText(markEl.dataset.original || '');
    const replacementText = normalizeText(markEl.textContent || '');
    const preferredPageNumber = getPreferredPdfPageForMark(editorEl, markEl, pageMetadata, coordinateLayer);

    const matches = originalText
      ? findCoordinateMatches({
          fragmentText: originalText,
          coordinateLayer,
          preferredPageNumber,
          maxMatches: 8,
        })
      : [];
    const coordinateMatch = pickUnusedMatch(matches, usedMatches);
    const patchRegion = buildPatchRegion({
      coordinateMatch,
      originalText,
      replacementText,
    });
    const patchPlan = buildPatchPlan({
      fragmentId: `anon_export_${pdId}_${index + 1}`,
      originalText,
      replacementText,
      coordinateMatch,
      patchRegion,
      pageMetadataSource: getSourceForPage(pageMetadata, coordinateMatch?.pageNumber || preferredPageNumber),
    });

    return {
      id: `anon_export_${pdId}_${index + 1}`,
      fragmentId: `anon_export_${pdId}_${index + 1}`,
      pdId,
      pageNumber: patchPlan.pageNumber || preferredPageNumber || null,
      patchPlan,
      appliedAt: null,
      derivedFromAnonymized: !!anonymized[pdId],
    };
  }).filter((entry) => entry.pageNumber || entry.patchPlan?.status === 'unsupported');
}
