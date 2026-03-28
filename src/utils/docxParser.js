// ── DOCX Parser — читает XML напрямую через JSZip ────────────────────────────
// Извлекает текст с форматированием из word/document.xml
// Возвращает текст в нашем формате: ##, [CENTER], [LEFTRIGHT], **ТЕКСТ**

// Загружаем JSZip если ещё не загружен
async function ensureJSZip() {
  if (window.JSZip) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Получаем текстовое содержимое элемента XML (все w:t внутри)
function getText(el) {
  return Array.from(el.querySelectorAll('t'))
    .map(t => t.textContent)
    .join('');
}

// Проверяем жирность runs в параграфе
function isBold(pEl) {
  const runs = pEl.querySelectorAll('r');
  if (!runs.length) return false;
  // Считаем жирным если большинство runs жирные
  let boldCount = 0;
  runs.forEach(r => {
    if (r.querySelector('b') || r.querySelector('rPr b')) boldCount++;
  });
  return boldCount > runs.length / 2;
}

// Получаем выравнивание параграфа
function getAlignment(pEl) {
  const jc = pEl.querySelector('pPr jc');
  if (!jc) return 'left';
  const val = jc.getAttribute('w:val') || jc.getAttribute('val') || '';
  return val; // center, right, both (justify), left
}

// Проверяем является ли параграф заголовком
function getHeadingLevel(pEl) {
  const pStyle = pEl.querySelector('pPr pStyle');
  if (!pStyle) return 0;
  const val = pStyle.getAttribute('w:val') || pStyle.getAttribute('val') || '';
  if (val === 'Heading1' || val === '1' || val.includes('1')) return 1;
  if (val === 'Heading2' || val === '2' || val.includes('2')) return 2;
  if (val === 'Heading3' || val === '3' || val.includes('3')) return 3;
  return 0;
}

// Парсим параграф и возвращаем строку в нашем формате
function parseParagraph(pEl) {
  const text = getText(pEl).trim();
  if (!text) return '';

  const align = getAlignment(pEl);
  const headingLevel = getHeadingLevel(pEl);
  const bold = isBold(pEl);

  // Заголовки
  if (headingLevel === 1 || (bold && align === 'center' && text.length < 60)) {
    return '## ' + text;
  }
  if (headingLevel === 2 || (bold && align === 'center')) {
    return '[CENTER]' + text + '[/CENTER]';
  }

  // Центрированный текст
  if (align === 'center') {
    return '[CENTER]' + text + '[/CENTER]';
  }

  // Жирный текст (разделы типа УСТАНОВИЛ, ПОСТАНОВИЛ)
  if (bold) {
    return '**' + text + '**';
  }

  return text;
}

// Проверяем есть ли в параграфе таблица-шапка (текст слева и справа через таб)
function hasTabStop(pEl) {
  return pEl.querySelector('tab') !== null;
}

// Парсим строку с табуляцией (город | дата)
function parseTabLine(pEl) {
  const runs = Array.from(pEl.querySelectorAll('r'));
  let left = '';
  let right = '';
  let seenTab = false;
  for (const r of runs) {
    const tab = r.querySelector('tab');
    if (tab) { seenTab = true; continue; }
    const t = r.querySelector('t');
    if (!t) continue;
    if (seenTab) right += t.textContent;
    else left += t.textContent;
  }
  left = left.trim();
  right = right.trim();
  if (left && right) return '[LEFTRIGHT: ' + left + ' | ' + right + ']';
  if (left) return left;
  if (right) return right;
  return '';
}

// Основная функция — парсим DOCX и возвращаем текст в нашем формате
export async function parseDocx(file) {
  await ensureJSZip();
  const arrayBuffer = await file.arrayBuffer();
  const zip = await window.JSZip.loadAsync(arrayBuffer);

  // Читаем word/document.xml
  const docXml = await zip.file('word/document.xml').async('string');

  // Парсим XML
  const parser = new DOMParser();
  const doc = parser.parseFromString(docXml, 'application/xml');

  // Получаем все параграфы и строки таблиц
  const body = doc.querySelector('body');
  if (!body) return '';

  const lines = [];

  // Обходим все дочерние элементы body
  for (const child of body.children) {
    const tag = child.tagName.replace(/^w:/, '');

    if (tag === 'p') {
      // Обычный параграф
      const text = getText(child).trim();
      if (!text) {
        lines.push('');
        continue;
      }
      if (hasTabStop(child)) {
        lines.push(parseTabLine(child));
      } else {
        lines.push(parseParagraph(child));
      }
    } else if (tag === 'tbl') {
      // Таблица — читаем построчно, ячейки через |
      const rows = child.querySelectorAll('tr');
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('tc'));
        const cellTexts = cells.map(c => getText(c).trim()).filter(Boolean);
        if (cellTexts.length > 1) {
          lines.push(cellTexts.join(' | '));
        } else if (cellTexts.length === 1) {
          lines.push(cellTexts[0]);
        }
      }
    }
  }

  // Убираем множественные пустые строки
  const result = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return result;
}
