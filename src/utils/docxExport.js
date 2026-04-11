const DOCX_FONT_PROPS = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="28"/><w:szCs w:val="28"/>';
const DOCX_DEFAULT_EMPTY_RUN = '<w:r><w:t></w:t></w:r>';
const CITY_DATE_MONTH_RE = /января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря/;
const CITY_DATE_YEAR_RE = /\d{4}/;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeNodeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildRunProps({ bold = false, italic = false, underline = false } = {}) {
  return [
    DOCX_FONT_PROPS,
    bold ? '<w:b/><w:bCs/>' : '',
    italic ? '<w:i/><w:iCs/>' : '',
    underline ? '<w:u w:val="single"/>' : '',
  ].join('');
}

function buildTextRun(text, options = {}) {
  const normalized = String(text || '').replace(/  +/g, ' ');
  if (!normalized || !normalized.trim()) return '';
  return `<w:r><w:rPr>${buildRunProps(options)}</w:rPr><w:t xml:space="preserve">${escapeXml(normalized)}</w:t></w:r>`;
}

function buildBreakRun() {
  return '<w:r><w:br/></w:r>';
}

function getNodeFormatting(tag, formatting) {
  return {
    bold: formatting.bold || tag === 'STRONG' || tag === 'B',
    italic: formatting.italic || tag === 'EM' || tag === 'I',
    underline: formatting.underline || tag === 'U',
  };
}

function buildRunsFromChildNodes(childNodes, formatting) {
  let runs = '';
  for (const child of childNodes) {
    runs += buildRunsFromNode(child, formatting);
  }
  return runs;
}

function buildRunsFromElement(node, formatting) {
  const tag = node.tagName?.toUpperCase() || '';
  if (tag === 'BR') return buildBreakRun();
  return buildRunsFromChildNodes(node.childNodes, getNodeFormatting(tag, formatting));
}

function buildRunsFromNode(node, formatting = { bold: false, italic: false, underline: false }) {
  if (node.nodeType === 3) {
    return buildTextRun(node.textContent, formatting);
  }
  if (node.nodeType === 1) {
    return buildRunsFromElement(node, formatting);
  }
  return '';
}

function getNodeAlign(element) {
  const textAlign = element.style?.textAlign || '';
  const tag = element.tagName?.toUpperCase() || '';

  if (textAlign === 'center' || tag === 'H1' || tag === 'H2' || tag === 'H3') return 'center';
  if (textAlign === 'right') return 'right';
  return 'both';
}

function isCityDateRow(leftText, rightText) {
  const hasDateLeft = CITY_DATE_YEAR_RE.test(leftText) || CITY_DATE_MONTH_RE.test(leftText);
  const hasDateRight = CITY_DATE_YEAR_RE.test(rightText) || CITY_DATE_MONTH_RE.test(rightText);
  return (hasDateLeft || hasDateRight) && leftText.length > 0 && rightText.length > 0;
}

function buildLeftAlignedParagraph(text) {
  return '<w:p><w:pPr><w:jc w:val="left"/><w:spacing w:after="0" w:before="0"/></w:pPr>'
    + `<w:r><w:rPr>${DOCX_FONT_PROPS}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function buildCityDateParagraph(leftText, rightText) {
  return '<w:p>'
    + '<w:pPr><w:jc w:val="left"/><w:spacing w:after="0" w:before="0"/><w:tabs><w:tab w:val="right" w:pos="9072"/></w:tabs></w:pPr>'
    + `<w:r><w:rPr>${DOCX_FONT_PROPS}</w:rPr><w:t xml:space="preserve">${escapeXml(leftText)}</w:t></w:r>`
    + `<w:r><w:rPr>${DOCX_FONT_PROPS}</w:rPr><w:tab/></w:r>`
    + `<w:r><w:rPr>${DOCX_FONT_PROPS}</w:rPr><w:t xml:space="preserve">${escapeXml(rightText)}</w:t></w:r>`
    + '</w:p>';
}

function buildLrRowParagraphs(node) {
  const spans = node.querySelectorAll('span');
  const leftText = normalizeNodeText(spans[0] ? spans[0].textContent : '');
  const rightText = normalizeNodeText(spans[1] ? spans[1].textContent : '');

  if (isCityDateRow(leftText, rightText)) {
    return buildCityDateParagraph(leftText, rightText);
  }

  let paragraphs = '';
  if (leftText) paragraphs += buildLeftAlignedParagraph(leftText);
  if (rightText) paragraphs += buildLeftAlignedParagraph(rightText);
  return paragraphs;
}

function shouldSkipNode(node) {
  const tag = node.tagName?.toUpperCase() || '';
  if (tag === 'HR') return true;
  if (node.classList?.contains('page-separator')) return true;
  return false;
}

function getParagraphProps(node) {
  const isRightBlock = node.classList?.contains('right-block');
  const hasTextIndent = Boolean(node.style?.textIndent);
  const align = getNodeAlign(node);

  if (isRightBlock) {
    return '<w:pPr><w:jc w:val="both"/><w:spacing w:after="0" w:before="0"/><w:ind w:left="5100"/></w:pPr>';
  }
  if (hasTextIndent) {
    return '<w:pPr><w:jc w:val="both"/><w:spacing w:after="0" w:before="0"/><w:ind w:firstLine="709"/></w:pPr>';
  }
  return `<w:pPr><w:jc w:val="${align}"/><w:spacing w:after="0" w:before="0"/></w:pPr>`;
}

function getRunStyleForTag(tag) {
  if (tag === 'H1' || tag === 'H2') {
    return '<w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>';
  }
  if (tag === 'H3') {
    return '<w:rPr><w:b/><w:bCs/></w:rPr>';
  }
  return '';
}

function buildStyledRuns(node) {
  const tag = node.tagName?.toUpperCase() || '';
  const runs = buildRunsFromNode(node) || DOCX_DEFAULT_EMPTY_RUN;
  const runStyle = getRunStyleForTag(tag);
  return runStyle ? runs.replace(/<w:r>/g, `<w:r>${runStyle}`) : runs;
}

function buildStandardParagraph(node) {
  return `<w:p>${getParagraphProps(node)}${buildStyledRuns(node)}</w:p>`;
}

function buildParagraphsFromHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  let paragraphs = '';

  for (const node of tmp.childNodes) {
    if (node.nodeType !== 1 || shouldSkipNode(node)) continue;
    if (node.classList?.contains('lr-row')) {
      paragraphs += buildLrRowParagraphs(node);
      continue;
    }
    paragraphs += buildStandardParagraph(node);
  }

  return paragraphs;
}

async function ensureJsZipLoaded() {
  if (window.JSZip) return;

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function buildDocxBlobParts(paragraphs) {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
${paragraphs}
<w:sectPr>
  <w:pgSz w:w="11906" w:h="16838"/>
  <w:pgMar w:top="1134" w:right="1418" w:bottom="1134" w:left="1418"/>
</w:sectPr>
</w:body>
</w:document>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const wordRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  return {
    docXml,
    relsXml,
    wordRelsXml,
    contentTypesXml,
  };
}

function buildDocxDownloadName(docTitle, originalFileName) {
  const baseName = (docTitle || originalFileName || 'документ')
    .replace(/\.pdf$/i, '')
    .replace(/\.docx$/i, '')
    .replace(/\.jpg$/i, '')
    .replace(/\.png$/i, '')
    .replace(/\.webp$/i, '');
  return `ЮрДок_${baseName}.docx`;
}

export async function exportRichTextDocx({
  html,
  docTitle,
  originalFileName,
}) {
  const paragraphs = buildParagraphsFromHtml(html);
  const {
    docXml,
    relsXml,
    wordRelsXml,
    contentTypesXml,
  } = buildDocxBlobParts(paragraphs);

  await ensureJsZipLoaded();

  const zip = new window.JSZip();
  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', relsXml);
  zip.file('word/document.xml', docXml);
  zip.file('word/_rels/document.xml.rels', wordRelsXml);

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildDocxDownloadName(docTitle, originalFileName);
  link.click();
  URL.revokeObjectURL(url);
}
