import { useCallback, useMemo, useState } from 'react';
import {
  buildDocumentPatchLayer,
  listExportReadyPatches,
  listNonExportablePatches,
  normalizeDocumentPatchLayer,
} from '../utils/documentPatchLayer';
import {
  exportPatchedPdf,
  exportRichTextPdf,
  shouldOpenPdfPatchPreview,
  validatePatchedPdfExport,
} from '../utils/pdfExportFlow';
import { buildPdfExportPatchEntries } from '../utils/pdfExportPatchBuilder';

export function usePdfExportFlow({
  patchLayer,
  anonymized,
  coordinateLayer,
  pageMetadata,
  originalImages,
  docTitle,
  originalFileName,
  editorHtml,
  editorDomRef,
} = {}) {
  const [showPdfPatchPreview, setShowPdfPatchPreview] = useState(false);
  const [pdfPatchPreviewData, setPdfPatchPreviewData] = useState({
    exportReadyPatchEntries: [],
    nonExportablePatchEntries: [],
  });

  const normalizedPatchLayer = useMemo(
    () => normalizeDocumentPatchLayer({ patchLayer }),
    [patchLayer]
  );
  const activePatchEntries = normalizedPatchLayer?.patches || [];
  const exportReadyPatchEntries = pdfPatchPreviewData.exportReadyPatchEntries;
  const nonExportablePatchEntries = pdfPatchPreviewData.nonExportablePatchEntries;
  const canProceedPdfPatchExport = exportReadyPatchEntries.length === 0 || originalImages.length > 0;

  const collectPdfPatchPreviewData = useCallback(() => {
    const derivedExportPatchEntries = buildPdfExportPatchEntries({
      editorEl: editorDomRef?.current,
      anonymized,
      coordinateLayer,
      pageMetadata,
    });
    const combinedPatchLayer = buildDocumentPatchLayer({
      patches: [
        ...(normalizedPatchLayer?.patches || []),
        ...derivedExportPatchEntries,
      ],
    });

    return {
      exportReadyPatchEntries: listExportReadyPatches(combinedPatchLayer),
      nonExportablePatchEntries: listNonExportablePatches(combinedPatchLayer),
    };
  }, [anonymized, coordinateLayer, editorDomRef, normalizedPatchLayer, pageMetadata]);

  const handleDownloadPdf = useCallback(async ({ skipPreview = false } = {}) => {
    const nextPreviewData = skipPreview
      ? pdfPatchPreviewData
      : collectPdfPatchPreviewData();
    const readyEntries = nextPreviewData.exportReadyPatchEntries;
    const blockedEntries = nextPreviewData.nonExportablePatchEntries;

    if (shouldOpenPdfPatchPreview({
      skipPreview,
      exportReadyPatchEntries: readyEntries,
      nonExportablePatchEntries: blockedEntries,
    })) {
      setPdfPatchPreviewData(nextPreviewData);
      setShowPdfPatchPreview(true);
      return;
    }

    if (readyEntries.length > 0) {
      const validationError = validatePatchedPdfExport({
        exportReadyPatchEntries: readyEntries,
        originalImages,
      });
      if (validationError) {
        alert(validationError);
        return;
      }

      try {
        await exportPatchedPdf({
          exportReadyPatchEntries: readyEntries,
          nonExportablePatchEntries: blockedEntries,
          originalImages,
          docTitle,
          originalFileName,
        });
      } catch (error) {
        alert(error?.message || 'Не удалось подготовить PDF с локальными правками.');
      }
      return;
    }

    try {
      exportRichTextPdf({
        editorDomRef,
        editorHtml,
        nonExportablePatchEntries: blockedEntries,
        originalImages,
        docTitle,
        originalFileName,
      });
    } catch (error) {
      alert(error?.message || 'Разрешите всплывающие окна для скачивания PDF');
    }
  }, [
    collectPdfPatchPreviewData,
    docTitle,
    editorDomRef,
    editorHtml,
    originalFileName,
    originalImages,
    pdfPatchPreviewData,
  ]);

  const handleClosePdfPatchPreview = useCallback(() => {
    setShowPdfPatchPreview(false);
    setPdfPatchPreviewData({
      exportReadyPatchEntries: [],
      nonExportablePatchEntries: [],
    });
  }, []);

  const handleConfirmPdfPatchExport = useCallback(async () => {
    setShowPdfPatchPreview(false);
    await handleDownloadPdf({ skipPreview: true });
  }, [handleDownloadPdf]);

  return {
    activePatchEntries,
    canProceedPdfPatchExport,
    exportReadyPatchEntries,
    handleClosePdfPatchPreview,
    handleConfirmPdfPatchExport,
    handleDownloadPdf,
    nonExportablePatchEntries,
    normalizedPatchLayer,
    showPdfPatchPreview,
  };
}
