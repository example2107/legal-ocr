import { useCallback, useMemo, useState } from 'react';
import {
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

export function usePdfExportFlow({
  patchLayer,
  originalImages,
  docTitle,
  originalFileName,
  editorHtml,
  editorDomRef,
} = {}) {
  const [showPdfPatchPreview, setShowPdfPatchPreview] = useState(false);

  const normalizedPatchLayer = useMemo(
    () => normalizeDocumentPatchLayer({ patchLayer }),
    [patchLayer]
  );
  const activePatchEntries = normalizedPatchLayer?.patches || [];
  const exportReadyPatchEntries = useMemo(
    () => listExportReadyPatches(normalizedPatchLayer),
    [normalizedPatchLayer]
  );
  const nonExportablePatchEntries = useMemo(
    () => listNonExportablePatches(normalizedPatchLayer),
    [normalizedPatchLayer]
  );
  const canProceedPdfPatchExport = exportReadyPatchEntries.length === 0 || originalImages.length > 0;

  const handleDownloadPdf = useCallback(async ({ skipPreview = false } = {}) => {
    if (shouldOpenPdfPatchPreview({
      skipPreview,
      exportReadyPatchEntries,
      nonExportablePatchEntries,
    })) {
      setShowPdfPatchPreview(true);
      return;
    }

    if (exportReadyPatchEntries.length > 0) {
      const validationError = validatePatchedPdfExport({
        exportReadyPatchEntries,
        originalImages,
      });
      if (validationError) {
        alert(validationError);
        return;
      }

      try {
        await exportPatchedPdf({
          exportReadyPatchEntries,
          nonExportablePatchEntries,
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
        nonExportablePatchEntries,
        originalImages,
        docTitle,
        originalFileName,
      });
    } catch (error) {
      alert(error?.message || 'Разрешите всплывающие окна для скачивания PDF');
    }
  }, [
    docTitle,
    editorDomRef,
    editorHtml,
    exportReadyPatchEntries,
    nonExportablePatchEntries,
    originalFileName,
    originalImages,
  ]);

  const handleClosePdfPatchPreview = useCallback(() => {
    setShowPdfPatchPreview(false);
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
