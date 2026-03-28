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

// Сериализуем XML элемент в строку для regex-поиска
function ser(el) {
  return new XMLSerializer().serializeToString(el);
}

// Получаем текстовое содержимое элемента XML (все w:t внутри)
function getText(el) {
  const s = ser(el);
  const matches = [...s.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)];
  return matches.map(m => m[1]).join('');
}

// Проверяем жирность runs в параграфе
function isBold(pEl) {
  const s = ser(pEl);
  const runMatches = [...s.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)];
  let textRuns = 0, boldCount = 0;
  for (const m of runMatches) {
    const r = m[0];
    if (!r.includes('<w:t')) continue;
    textRuns++;
    if (/<w:b[\s\/>]/.test(r)) {
      const valM = r.match(/<w:b[^>]*w:val="([^"]+)"/);
      const val = valM ? valM[1] : '1';
      if (val !== '0' && val !== 'false') boldCount++;
    }
  }
  if (!textRuns) return false;
  return boldCount > textRuns / 2;
}

// Получаем выравнивание параграфа
function getAlignment(pEl) {
  const s = ser(pEl);
  const m = s.match(/<w:jc[^>]*w:val="([^"]+)"/);
  return m ? m[1] : 'left';
}

// Проверяем есть ли большой левый отступ (реквизиты в правой части)
function hasLargeIndent(pEl) {
  const s = ser(pEl);
  const m = s.match(/<w:ind[^>]*w:left="([^"]+)"/);
  if (!m) return false;
  return parseFloat(m[1]) > 3000;
}

// Проверяем отступ первой строки абзаца
function hasFirstLineIndent(pEl) {
  const s = ser(pEl);
  const m = s.match(/<w:ind[^>]*w:firstLine="([^"]+)"/);
  if (!m) return false;
  return parseFloat(m[1]) > 300; // > ~0.5см — значимый отступ
}

// Получаем уровень заголовка
function getHeadingLevel(pEl) {
  const s = ser(pEl);
  const m = s.match(/<w:pStyle[^>]*w:val="([^"]+)"/);
  if (!m) return 0;
  const val = m[1];
  if (val === 'Heading1' || val === '1') return 1;
  if (val === 'Heading2' || val === '2') return 2;
  if (val === 'Heading3' || val === '3') return 3;
  return 0;
}

// Проверяем есть ли табуляция в параграфе
function hasTabStop(pEl) {
  return ser(pEl).includes('<w:tab');
}

// Парсим строку с табуляцией (город | дата)
function parseTabLine(pEl) {
  const s = ser(pEl);
  const runs = [...s.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)].map(m => m[0]);
  let left = '', right = '', seenTab = false;
  for (const r of runs) {
    if (r.includes('<w:tab')) { seenTab = true; continue; }
    const tm = r.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
    if (!tm) continue;
    if (seenTab) right += tm[1];
    else left += tm[1];
  }
  left = left.trim(); right = right.trim();
  if (left && right) return '[LEFTRIGHT: ' + left + ' | ' + right + ']';
  if (left) return left;
  return right;
}

// Парсим параграф и возвращаем строку в нашем формате
function parseParagraph(pEl) {
  const text = getText(pEl).trim();
  if (!text) return '';

  const align = getAlignment(pEl);
  const headingLevel = getHeadingLevel(pEl);
  const bold = isBold(pEl);
  const largeIndent = hasLargeIndent(pEl);
  const firstLineIndent = hasFirstLineIndent(pEl);

  // Заголовок H1
  if (headingLevel === 1) {
    return '## ' + text;
  }

  // Жирный + по центру = центрированный заголовок/подзаголовок
  if (bold && align === 'center') {
    return '[CENTER]**' + text + '**[/CENTER]';
  }

  // Просто по центру
  if (align === 'center') {
    return '[CENTER]' + text + '[/CENTER]';
  }

  // Большой отступ = реквизиты справа (шапка документа)
  if (largeIndent) {
    return bold ? '**' + text + '**' : text;
  }

  // Жирный текст (разделы типа УСТАНОВИЛ, ПОСТАНОВИЛ)
  if (bold) {
    return '**' + text + '**';
  }

  // Абзацный отступ первой строки — добавляем маркер [INDENT]
  if (firstLineIndent) {
    return '[INDENT]' + text;
  }

  return text;
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
