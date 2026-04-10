import { renderPatchEntriesOnImages } from './documentPageCompositor';
import { openPatchedPdfPrintWindow, openRichTextPdfPrintWindow } from './pdfPatchExport';

export function buildExportContentHtml(editorDomRef, editorHtml) {
  return (editorDomRef.current?.innerHTML || editorHtml)
    .replace(/<mark class="pd[^"]*"[^>]*>/g, '<span class="pd-export">')
    .replace(/<mark class="uncertain[^"]*"[^>]*>/g, '<span class="uncertain-export">')
    .replace(/<\/mark>/g, '</span>');
}

export function shouldOpenPdfPatchPreview({ skipPreview = false, exportReadyPatchEntries = [], nonExportablePatchEntries = [] } = {}) {
  if (skipPreview) return false;
  return exportReadyPatchEntries.length > 0 || nonExportablePatchEntries.length > 0;
}

export function validatePatchedPdfExport({ exportReadyPatchEntries = [], originalImages = [] } = {}) {
  if (exportReadyPatchEntries.length === 0) return null;
  if (!Array.isArray(originalImages) || originalImages.length === 0) {
    return 'Для PDF-экспорта с локальными правками сначала загрузите оригинальный PDF в просмотрщик.';
  }
  return null;
}

export async function exportPatchedPdf({
  exportReadyPatchEntries = [],
  nonExportablePatchEntries = [],
  originalImages = [],
  docTitle = '',
  originalFileName = '',
} = {}) {
  const exportImages = await renderPatchEntriesOnImages({
    originalImages,
    patchEntries: exportReadyPatchEntries,
  });
  if (exportImages.length !== originalImages.length) {
    throw new Error('Не удалось подготовить все страницы для PDF-экспорта.');
  }

  openPatchedPdfPrintWindow({
    pageImages: exportImages,
    docTitle,
    originalFileName,
  });

  if (nonExportablePatchEntries.length > 0) {
    setTimeout(() => {
      alert(`В PDF применены только надёжные правки: ${exportReadyPatchEntries.length}. Правок, требующих ручной проверки: ${nonExportablePatchEntries.length}.`);
    }, 700);
  }
}

export function exportRichTextPdf({
  editorDomRef,
  editorHtml = '',
  docTitle = '',
  originalFileName = '',
  nonExportablePatchEntries = [],
  originalImages = [],
} = {}) {
  if (nonExportablePatchEntries.length > 0 && (!Array.isArray(originalImages) || originalImages.length === 0)) {
    alert('В документе есть только рискованные локальные правки. Они не будут включены в PDF автоматически.');
  }

  openRichTextPdfPrintWindow({
    contentHtml: buildExportContentHtml(editorDomRef, editorHtml),
    docTitle,
    originalFileName,
  });
}
