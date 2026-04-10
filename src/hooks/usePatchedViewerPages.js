import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeDocumentPatchLayer, removeDocumentPatch, upsertDocumentPatch } from '../utils/documentPatchLayer';
import { buildPatchedPageImage, renderPatchEntriesOnImages } from '../utils/documentPageCompositor';
import { getOriginalImageForPage } from '../utils/originalImagePages';

export function usePatchedViewerPages({
  originalImages,
  patchLayer,
  setPatchLayer,
  onOpenOriginalPageNumber,
} = {}) {
  const [patchedOriginalPages, setPatchedOriginalPages] = useState({});

  const viewerImages = useMemo(
    () => originalImages.map((image) => patchedOriginalPages[Number(image?.pageNum || 0)] || image),
    [originalImages, patchedOriginalPages]
  );
  const patchedViewerPageCount = Object.keys(patchedOriginalPages).length;

  const clearPatchedViewerPages = useCallback(({ clearPatchLayer = false } = {}) => {
    setPatchedOriginalPages({});
    if (clearPatchLayer) {
      setPatchLayer(null);
    }
  }, [setPatchLayer]);

  const handleApplyPdFragmentPreview = useCallback((payload) => {
    const pageNumber = Number(payload?.previewState?.pageNumber || 0);
    if (!pageNumber) return;

    const sourceImage = getOriginalImageForPage(viewerImages, pageNumber);
    const patchedImage = buildPatchedPageImage(sourceImage, payload.previewState);
    if (!patchedImage) return;

    setPatchedOriginalPages((prev) => ({
      ...prev,
      [pageNumber]: patchedImage,
    }));
    setPatchLayer((prev) => upsertDocumentPatch({
      patchLayer: prev,
      fragmentId: payload?.fragment?.id || payload?.patchPlan?.fragmentId || null,
      patchPlan: payload?.patchPlan || null,
    }));

    onOpenOriginalPageNumber?.(pageNumber);
  }, [onOpenOriginalPageNumber, setPatchLayer, viewerImages]);

  const handleRemovePatchEntry = useCallback((patchEntry) => {
    if (!patchEntry) return;
    setPatchLayer((prev) => removeDocumentPatch({
      patchLayer: prev,
      fragmentId: patchEntry.fragmentId || null,
      patchId: patchEntry.id || null,
    }));
  }, [setPatchLayer]);

  useEffect(() => {
    let cancelled = false;

    const rebuildPatchedPages = async () => {
      const normalizedPatchLayer = normalizeDocumentPatchLayer({ patchLayer });
      if (!Array.isArray(originalImages) || originalImages.length === 0 || !normalizedPatchLayer?.patches?.length) {
        setPatchedOriginalPages({});
        return;
      }

      try {
        const nextImages = await renderPatchEntriesOnImages({
          originalImages,
          patchEntries: normalizedPatchLayer.patches,
        });
        if (cancelled) return;

        const nextPatchedPages = {};
        for (const image of nextImages) {
          if (image?.patched && image?.pageNum) {
            nextPatchedPages[Number(image.pageNum)] = image;
          }
        }
        setPatchedOriginalPages(nextPatchedPages);
      } catch (error) {
        console.error('[patch-layer] Failed to rebuild patch preview', {
          message: error?.message || String(error),
        });
        if (!cancelled) {
          setPatchedOriginalPages({});
        }
      }
    };

    void rebuildPatchedPages();
    return () => {
      cancelled = true;
    };
  }, [originalImages, patchLayer]);

  return {
    clearPatchedViewerPages,
    handleApplyPdFragmentPreview,
    handleRemovePatchEntry,
    patchedViewerPageCount,
    viewerImages,
  };
}
