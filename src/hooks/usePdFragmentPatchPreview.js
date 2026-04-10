import { useEffect, useState } from 'react';
import { canRenderPatchPlanPreview, renderPatchPlanPreview } from '../utils/documentPageCompositor';
import { buildPatchPlan } from '../utils/documentPatchPlan';
import { buildPatchRegion } from '../utils/documentPatchRegion';

function normalizePdText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function usePdFragmentPatchPreview({
  fragment,
  text,
  previewPageImage,
} = {}) {
  const [previewState, setPreviewState] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const patchRegion = buildPatchRegion({
    coordinateMatch: fragment?.coordinateMatch,
    originalText: fragment?.text,
    replacementText: text,
  });
  const patchPlan = buildPatchPlan({
    fragmentId: fragment?.id || null,
    originalText: fragment?.text || '',
    replacementText: normalizePdText(text),
    coordinateMatch: fragment?.coordinateMatch || null,
    patchRegion,
    pageMetadataSource: fragment?.pageMetadataSource || null,
  });
  const canBuildPreview = canRenderPatchPlanPreview(previewPageImage, patchPlan);

  useEffect(() => {
    setPreviewState(null);
    setPreviewError('');
    setPreviewLoading(false);
  }, [fragment?.id, fragment?.text, text]);

  const handleBuildPreview = async () => {
    if (!canBuildPreview) return;
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const nextPreview = await renderPatchPlanPreview({
        pageImage: previewPageImage,
        patchPlan,
      });
      setPreviewState(nextPreview);
    } catch (error) {
      setPreviewState(null);
      setPreviewError(error?.message || 'Не удалось собрать черновик локальной замены.');
    } finally {
      setPreviewLoading(false);
    }
  };

  return {
    normalizedText: normalizePdText(text),
    patchPlan,
    patchRegion,
    canBuildPreview,
    previewError,
    previewLoading,
    previewState,
    handleBuildPreview,
  };
}
