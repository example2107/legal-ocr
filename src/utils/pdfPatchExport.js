function buildPdfTitle(docTitle, originalFileName) {
  return 'ЮрДок_' + (docTitle || originalFileName || 'документ')
    .replace(/\.pdf$/i, '')
    .replace(/\.docx$/i, '')
    .replace(/\.jpg$/i, '')
    .replace(/\.png$/i, '')
    .replace(/\.webp$/i, '');
}

function openPrintWindow(printHtml, windowFeatures = 'width=1000,height=1000') {
  const printWindow = window.open('', '_blank', windowFeatures);
  if (!printWindow) {
    throw new Error('Разрешите всплывающие окна для скачивания PDF.');
  }

  printWindow.document.write(printHtml);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.print();
    setTimeout(() => printWindow.close(), 1000);
  }, 500);
}

export function openRichTextPdfPrintWindow({ contentHtml = '', docTitle = '', originalFileName = '' } = {}) {
  const title = buildPdfTitle(docTitle, originalFileName);
  const printHtml = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"/><title>${title}</title>
<style>
  @page { size: A4; margin: 20mm 25mm; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 14pt;
    line-height: 1.7;
    color: #000;
    margin: 0;
    width: 160mm;
  }
  h1 { font-size: 14pt; font-weight: 700; text-align: center; margin: 0; line-height: 1.7; }
  h2 { font-size: 14pt; font-weight: 600; text-align: center; margin: 0; line-height: 1.7; }
  h3 { font-size: 14pt; font-weight: 600; margin: 0; }
  div { min-height: 1.7em; margin: 0; padding: 0; text-align: justify; }
  p { text-indent: 1.5em; margin: 0; padding: 0; text-align: justify; }
  .right-block { margin-left: 55%; text-align: justify; min-height: 1.7em; }
  .page-separator { display: none; }
  .lr-row { display: flex; justify-content: space-between; align-items: baseline; text-align: left; }
  .lr-row span:last-child { text-align: right; }
  hr { border: none; border-top: 1px solid #ccc; margin: 6pt 0; }
  ol, ul { padding-left: 2em; }
  .pd-export { font-weight: bold; }
  .uncertain-export { text-decoration: underline dotted; }
</style></head>
<body>
${contentHtml}
</body></html>`;

  openPrintWindow(printHtml, 'width=850,height=950');
}
