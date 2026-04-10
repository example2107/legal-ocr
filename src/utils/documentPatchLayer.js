const PATCH_LAYER_VERSION = 1;

function toPositiveNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function normalizePatchPlan(patchPlan) {
  if (!patchPlan || typeof patchPlan !== 'object') return null;
  return {
    ...patchPlan,
    pageNumber: toPositiveNumberOrNull(patchPlan.pageNumber),
  };
}

function normalizePatchEntry(patch, index) {
  if (!patch || typeof patch !== 'object') return null;
  const patchPlan = normalizePatchPlan(patch.patchPlan || patch.plan || null);
  const pageNumber = toPositiveNumberOrNull(patch.pageNumber) || patchPlan?.pageNumber || null;
  if (!patchPlan || !pageNumber) return null;

  return {
    id: String(patch.id || patch.fragmentId || patchPlan.fragmentId || `patch_${pageNumber}_${index + 1}`),
    fragmentId: patch.fragmentId || patchPlan.fragmentId || null,
    pageNumber,
    patchPlan,
    appliedAt: patch.appliedAt || null,
  };
}

export function buildDocumentPatchLayer({ patches = [] } = {}) {
  const normalizedPatches = (patches || [])
    .map((patch, index) => normalizePatchEntry(patch, index))
    .filter(Boolean);

  if (normalizedPatches.length === 0) return null;
  return {
    version: PATCH_LAYER_VERSION,
    patches: normalizedPatches,
  };
}

export function normalizeDocumentPatchLayer(entry = {}) {
  const layer = entry.patchLayer;
  if (!layer || !Array.isArray(layer.patches)) return null;
  return buildDocumentPatchLayer({ patches: layer.patches });
}

export function upsertDocumentPatch({
  patchLayer = null,
  fragmentId = null,
  patchPlan = null,
  appliedAt = null,
} = {}) {
  const normalizedPatchPlan = normalizePatchPlan(patchPlan);
  const pageNumber = normalizedPatchPlan?.pageNumber || null;
  if (!normalizedPatchPlan || !pageNumber) {
    return normalizeDocumentPatchLayer({ patchLayer });
  }

  const nextPatch = {
    id: String(fragmentId || normalizedPatchPlan.fragmentId || `patch_${pageNumber}`),
    fragmentId: fragmentId || normalizedPatchPlan.fragmentId || null,
    pageNumber,
    patchPlan: normalizedPatchPlan,
    appliedAt: appliedAt || new Date().toISOString(),
  };

  const existingPatches = normalizeDocumentPatchLayer({ patchLayer })?.patches || [];
  const replaceKey = nextPatch.fragmentId || nextPatch.id;
  const preserved = existingPatches.filter((patch) => {
    const patchKey = patch.fragmentId || patch.id;
    return patchKey !== replaceKey;
  });

  return buildDocumentPatchLayer({
    patches: [...preserved, nextPatch],
  });
}

export function removeDocumentPatch({
  patchLayer = null,
  fragmentId = null,
  patchId = null,
} = {}) {
  const existingPatches = normalizeDocumentPatchLayer({ patchLayer })?.patches || [];
  if (!fragmentId && !patchId) {
    return buildDocumentPatchLayer({ patches: existingPatches });
  }

  const nextPatches = existingPatches.filter((patch) => {
    if (fragmentId && (patch.fragmentId || null) === fragmentId) return false;
    if (patchId && patch.id === patchId) return false;
    return true;
  });

  return buildDocumentPatchLayer({ patches: nextPatches });
}

export function listExportReadyPatches(patchLayer = null) {
  const patches = normalizeDocumentPatchLayer({ patchLayer })?.patches || [];
  return patches.filter((patch) => patch.patchPlan?.status === 'ready');
}

export function listNonExportablePatches(patchLayer = null) {
  const patches = normalizeDocumentPatchLayer({ patchLayer })?.patches || [];
  return patches.filter((patch) => patch.patchPlan?.status !== 'ready');
}
