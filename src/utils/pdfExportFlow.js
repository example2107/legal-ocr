import { openRichTextPdfPrintWindow } from './pdfPatchExport';

export function buildExportContentHtml(editorDomRef, editorHtml) {
  return (editorDomRef.current?.innerHTML || editorHtml)
    .replace(/<mark class="pd[^"]*"[^>]*>/g, '<span class="pd-export">')
    .replace(/<mark class="uncertain[^"]*"[^>]*>/g, '<span class="uncertain-export">')
    .replace(/<\/mark>/g, '</span>');
}

export function exportRichTextPdf({
  editorDomRef,
  editorHtml = '',
  docTitle = '',
  originalFileName = '',
} = {}) {
  openRichTextPdfPrintWindow({
    contentHtml: buildExportContentHtml(editorDomRef, editorHtml),
    docTitle,
    originalFileName,
  });
}
