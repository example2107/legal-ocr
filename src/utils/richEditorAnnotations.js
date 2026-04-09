// ── Helpers ────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function extractAddressParts(value) {
  const text = (value || '').trim();
  if (!text) return null;

  const streetMatch = text.match(/(?:ул\.?|улиц[аеиы])\s*([А-ЯA-ZЁ][A-Za-zА-Яа-яЁё0-9-]*(?:\s+[А-ЯA-ZЁ][A-Za-zА-Яа-яЁё0-9-]*){0,3})/i);
  const houseMatch =
    text.match(/(?:д\.?|дом)\s*№?\s*([0-9]+(?:[A-Za-zА-Яа-яЁё/-]*[0-9A-Za-zА-Яа-яЁё]*)?)/i) ||
    (streetMatch ? text.match(/,\s*([0-9]+(?:[A-Za-zА-Яа-яЁё/-]*[0-9A-Za-zА-Яа-яЁё]*)?)\s*$/i) : null);
  const localityMatch = text.match(/(?:^|,\s*|\s+)(с\.?|пос\.?|пгт\.?|г\.?|дер\.?|д\.)\s*([А-ЯA-ZЁ][A-Za-zА-Яа-яЁё-]*(?:\s+[А-ЯA-ZЁ][A-Za-zА-Яа-яЁё-]*){0,2})/i);

  if (!streetMatch || !houseMatch) return null;

  return {
    street: streetMatch[1].trim(),
    house: houseMatch[1].trim(),
    localityType: localityMatch?.[1]?.trim() || '',
    localityName: localityMatch?.[2]?.trim() || '',
  };
}

function buildAddressPattern(value) {
  const exact = buildOtherPdPattern(value);
  const parts = extractAddressParts(value);
  if (!parts) return exact;

  const streetName = escRe(parts.street).replace(/\s+/g, '\\s+');
  const houseNum = escRe(parts.house);
  const streetLabel = '(?:ул\\.?|улиц[аеиы])';
  const houseLabel = '(?:д\\.?|дом)';
  const directHouse = `(?:${houseLabel}\\s*№?\\s*)?${houseNum}`;
  const locality = parts.localityName
    ? `${escRe(parts.localityType || '').replace(/\s+/g, '\\s*')}\\s*${escRe(parts.localityName).replace(/\s+/g, '\\s+')}`.trim()
    : '';
  const localityBefore = locality ? `(?:${locality}[,\\s]+)?` : '';
  const localityAfter = locality ? `(?:[,\\s]+${locality})?` : '';
  const separators = '(?:\\s*,\\s*|\\s+)';

  const variants = [
    exact,
    `${localityBefore}(?:по\\s+)?${streetLabel}\\s+${streetName}${separators}${directHouse}${localityAfter}`,
    `${localityBefore}(?:на\\s+)?улиц[еы]\\s+${streetName}${separators}(?:дом(?:е|а)?\\s*)?${houseNum}${localityAfter}`,
    `(?:во\\s+дворе\\s*)?(?:${houseLabel}\\s*№?\\s*)${houseNum}(?:\\s*(?:,|по)\\s*|\\s+по\\s+)${streetLabel}\\s+${streetName}${localityAfter}`,
  ];

  return `(?:${variants.join('|')})`;
}

// Build flexible regex for otherPD values: normalize whitespace
function buildOtherPdPattern(value, pdType) {
  if (pdType === 'address') return buildAddressPattern(value);
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return escRe(value);
  // Each word escaped, joined by flexible whitespace (including newlines)
  return parts.map(p => escRe(p)).join('[\\s\\n]+');
}

export function buildPdMatchPattern(value, type = 'other', pdType) {
  return type === 'person'
    ? buildPersonPattern(value)
    : buildOtherPdPattern(value, pdType);
}

function buildAmbiguousPersonPattern(value) {
  const base = buildOtherPdPattern(value);
  return `(?<![A-Za-zА-Яа-яЁё])${base}(?![A-Za-zА-Яа-яЁё])`;
}

function getOtherPdMentions(item) {
  const seen = new Set();
  return [item?.value, ...(item?.mentions || [])]
    .map(value => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(value => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function annotateAmbiguousPersonsHtml(html, ambiguousPersons) {
  if (!ambiguousPersons || ambiguousPersons.length === 0) return html;

  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const ambiguousMarks = ambiguousPersons
    .filter(item => item?.value && item.value.trim().length > 0)
    .map(item => ({
      value: item.value.trim(),
      context: item.context || '',
      reason: item.reason || 'Неоднозначное упоминание лица',
    }))
    .sort((a, b) => b.value.length - a.value.length);

  if (ambiguousMarks.length === 0) return html;

  function annotateAmbiguousInNode(node) {
    if (node.nodeType === 3) {
      const text = node.textContent;
      const allMatches = [];
      for (const item of ambiguousMarks) {
        try {
          const re = new RegExp(buildAmbiguousPersonPattern(item.value), 'gi');
          let m;
          while ((m = re.exec(text)) !== null) {
            allMatches.push({ start: m.index, end: m.index + m[0].length, mt: m[0], item });
          }
        } catch {}
      }
      if (allMatches.length === 0) return;
      allMatches.sort((a, b) => a.start - b.start);
      const filtered = [];
      let lastEnd = 0;
      for (const m of allMatches) {
        if (m.start >= lastEnd) { filtered.push(m); lastEnd = m.end; }
      }
      const fragment = document.createDocumentFragment();
      let lastIdx = 0;
      for (const { start, end, mt, item } of filtered) {
        if (start > lastIdx) fragment.appendChild(document.createTextNode(text.slice(lastIdx, start)));
        const el = document.createElement('mark');
        el.className = 'ambiguous-person';
        el.dataset.value = item.value;
        el.dataset.context = item.context;
        el.dataset.reason = item.reason;
        el.dataset.tooltip = item.reason;
        el.contentEditable = 'false';
        el.textContent = mt;
        fragment.appendChild(el);
        lastIdx = end;
      }
      if (lastIdx < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
      node.parentNode.replaceChild(fragment, node);
    } else if (node.nodeType === 1 && !['mark', 'script', 'style'].includes(node.tagName.toLowerCase())) {
      Array.from(node.childNodes).forEach(annotateAmbiguousInNode);
    }
  }

  Array.from(tmp.childNodes).forEach(annotateAmbiguousInNode);
  return tmp.innerHTML;
}

// Строит regex-паттерн для упоминания человека:
// - Захватывает падежные окончания каждого слова ФИО (через усечение корня)
// - Захватывает инициалы после фамилии (А., В.Г.) и перед фамилией (С.В. Фамилия)
function buildPersonPattern(mention) {
  // Совпадение не должно начинаться с хвоста предыдущего слова:
  // предотвращает кейсы вида "л. Полуянович И.В." из "пояснил. Полуянович И.В."
  const leftBoundary = '(?<![A-Za-zА-Яа-яЁё])';
  // OCR иногда путает точки и запятые внутри инициалов, поэтому допускаем оба разделителя.
  const initialSep = '\\s*[\\.,]\\s*';
  // Инициалы после:
  // - А.С. / А,С. / А.С, / А, С. / А. С. / А.
  // - А , С . / А ,с. / А. с ,  (консервативно допускаем только пробелы вокруг знаков)
  const initialsAfter = `(?:\\s+[А-ЯЁ]${initialSep}[А-ЯЁ](?:${initialSep})?|\\s+[А-ЯЁ]${initialSep})?`;
  // Инициалы перед:
  // - А.С. Фамилия
  // - А,С. Фамилия
  // - А. С. Фамилия
  // - А, С. Фамилия
  // - А. Фамилия
  // Флаг /i на regex позволяет переживать OCR-ошибки регистра: а.С., а.с., А.с.
  const initialsBefore = `(?:(?:[А-ЯЁ]${initialSep}[А-ЯЁ](?:${initialSep})?|[А-ЯЁ]${initialSep})\\s+)?`;

  // Make first letter case-insensitive to handle OCR lowercase errors
  const caseInsensitiveFirst = (word) => {
    if (!word) return word;
    const first = word[0];
    // For Cyrillic: build [АаБб...] pair for first letter
    const upper = first.toUpperCase();
    const lower = first.toLowerCase();
    const prefix = upper !== lower ? '[' + escRe(upper) + escRe(lower) + ']' : escRe(first);
    return prefix + escRe(word.slice(1));
  };
  const wordToPattern = (word) => {
    if (/[А-яЁё]/.test(word.slice(-1)) && word.length > 4) {
      return caseInsensitiveFirst(word.slice(0, -2)) + '[А-яЁё]{0,5}';
    }
    return caseInsensitiveFirst(word);
  };

  const words = mention.split(/\s+/);

  // Если mention начинается с инициалов (напр. "С.В. Лаптева")
  if (/^[А-ЯЁ]\s*[\.,]\s*[А-ЯЁ]?(?:\s*[\.,])?\s/i.test(mention)) {
    const base = words.map(wordToPattern).join('\\s+');
    return leftBoundary + base + initialsAfter;
  }

  if (words.length > 1) {
    const base = words.map(wordToPattern).join('\\s+');
    return leftBoundary + base + initialsAfter;
  }

  // Одно слово — ищем с инициалами до и после
  return leftBoundary + initialsBefore + wordToPattern(mention) + initialsAfter;
}
function applyBold(html) {
  return html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function annotLine(text, marks, anonymized) {
  // Для persons — расширенный паттерн с падежами и инициалами
  // Для otherPD — точный паттерн
  const patternEntries = marks.map(m => ({
    pattern: m.type === 'person' ? buildPersonPattern(m.txt) : buildOtherPdPattern(m.txt, m.pdType),
    mark: m,
  }));

  // Сортируем по длине исходного mention — более специфичные (длинные) идут первыми
  // Это важно: «Бокова В.Р.» должен быть в regex раньше чем «Бокова»
  patternEntries.sort((a, b) => b.mark.txt.length - a.mark.txt.length);

  const patterns = [
    '⚠️\\[(НЕТОЧНО: [^\\]]*|НЕЧИТАЕМО)\\]',
    ...patternEntries.map(e => e.pattern),
  ];
  let re;
  try { re = new RegExp(patterns.join('|'), 'gi'); } catch { return applyBold(esc(text)); }

  let out = '', last = 0, match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out += applyBold(esc(text.slice(last, match.index)));
    const mt = match[0].replace(/\s+$/, ''); // trim trailing space that may be captured by initialsAfter
    if (mt.startsWith('⚠️[')) {
      const inner = mt.slice(3, -1);
      const isUnread = inner === 'НЕЧИТАЕМО';
      if (isUnread) {
        out += `<mark class="uncertain unreadable" data-tooltip="Нечитаемый фрагмент · ПКМ — снять выделение">[НЕЧИТАЕМО]</mark>`;
      } else {
        // Парсим формат "НЕТОЧНО: слово" или "НЕТОЧНО: слово | вариант"
        const content = inner.replace('НЕТОЧНО: ', '');
        const parts = content.split('|').map(s => s.trim());
        const wrongWord = parts[0];
        const suggestion = parts[1] || '';
        const tooltip = suggestion
          ? 'Возможно неточное распознавание · ПКМ — варианты'
          : 'Возможно неточное распознавание · ПКМ — снять выделение';
        out += `<mark class="uncertain" data-tooltip="${tooltip}" data-suggestion="${esc(suggestion)}">${esc(wrongWord)}</mark>`;
      }
    } else {
      // Ищем mark по совпадению паттерна (не точная строка, т.к. падеж мог измениться)
      const entry = patternEntries.find(e => {
        try { return new RegExp('^' + e.pattern + '$', 'i').test(mt); } catch { return false; }
      });
      const hl = entry ? entry.mark : null;
      if (hl) {
        const isAnon = !!anonymized[hl.id];
        const display = isAnon ? (hl.type === 'person' ? hl.letter : hl.replacement) : esc(mt);
        const cat = hl.type === 'person' ? (hl.cat === 'private' ? 'priv' : 'prof') : 'oth';
        out += `<mark class="pd ${cat}${isAnon ? ' anon' : ''}" data-pd-id="${hl.id}" contenteditable="false" title="${isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить'}">${display}</mark>`;
      } else {
        out += applyBold(esc(mt));
      }
    }
    last = match.index + match[0].length; // advance by full match including any trailing space
  }
  if (last < text.length) out += applyBold(esc(text.slice(last)));
  // Гарантируем пробел до и после каждого <mark> чтобы при редактировании
  // курсор не застревал внутри маркера
  // Пробел перед <mark>: всегда, кроме открывающих знаков препинания ( « " ' [
  // Пробел после </mark>: всегда, кроме закрывающих знаков препинания ) , . ! ? : ; » " …
  out = out
    .replace(/([^\s(\[«"'])(<mark\s)/g, '$1 $2')
    .replace(/(<\/mark>)([^\s)\].,!?:;»"'\u2026\u2013\u2014<])/g, '$1 $2');
  return out;
}

// ── Build full annotated HTML from rawText (used only on first load) ───────────
// Аннотирует HTML от mammoth — заменяет упоминания ПД на <mark> прямо в HTML
function buildAnnotatedDocxHtml(docxHtml, personalData, anonymized) {
  const { persons = [], otherPD = [] } = personalData;
  const marks = [];
  for (const p of persons) {
    for (const mention of (p.mentions || [p.fullName])) {
      if (mention && mention.length > 1)
        marks.push({ txt: mention, type: 'person', cat: p.category, id: p.id, letter: p.letter });
    }
  }
  for (const it of otherPD) {
    for (const mention of getOtherPdMentions(it)) {
      marks.push({ txt: mention, type: 'other', id: it.id, replacement: it.replacement, pdType: it.type });
    }
  }
  marks.sort((a, b) => b.txt.length - a.txt.length);

  // Создаём временный DOM и аннотируем текстовые узлы
  const tmp = document.createElement('div');
  tmp.innerHTML = docxHtml;

  // Рекурсивно обходим текстовые узлы и заменяем упоминания на marks
  function annotateNode(node) {
    if (node.nodeType === 3) { // текстовый узел
      let text = node.textContent;
      let changed = false;
      const fragment = document.createDocumentFragment();
      let lastIdx = 0;

      // Ищем все совпадения по всем marks
      const allMatches = [];
      for (const mark of marks) {
        try {
          const finalPattern = mark.type === 'person' ? buildPersonPattern(mark.txt) : buildOtherPdPattern(mark.txt, mark.pdType);
          const re = new RegExp(finalPattern, 'gi');
          let m;
          while ((m = re.exec(text)) !== null) {
            allMatches.push({ start: m.index, end: m.index + m[0].length, mt: m[0], mark });
          }
        } catch {}
      }

      // Сортируем по позиции, убираем пересечения
      allMatches.sort((a, b) => a.start - b.start);
      const filtered = [];
      let lastEnd = 0;
      for (const m of allMatches) {
        if (m.start >= lastEnd) { filtered.push(m); lastEnd = m.end; }
      }

      for (const { start, end, mt, mark } of filtered) {
        if (start > lastIdx) fragment.appendChild(document.createTextNode(text.slice(lastIdx, start)));
        const el = document.createElement('mark');
        const isAnon = !!anonymized[mark.id];
        const display = isAnon ? (mark.type === 'person' ? mark.letter : mark.replacement) : mt;
        const cat = mark.type === 'person' ? (mark.cat === 'private' ? 'priv' : 'prof') : 'oth';
        el.className = 'pd ' + cat + (isAnon ? ' anon' : '');
        el.dataset.pdId = mark.id;
        el.dataset.original = mt;
        el.title = isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить';
        el.textContent = display;
        fragment.appendChild(el);
        lastIdx = end;
        changed = true;
      }

      if (changed) {
        if (lastIdx < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
        node.parentNode.replaceChild(fragment, node);
      }
    } else if (node.nodeType === 1 && !['mark', 'script', 'style'].includes(node.tagName.toLowerCase())) {
      Array.from(node.childNodes).forEach(annotateNode);
    }
  }

  Array.from(tmp.childNodes).forEach(annotateNode);
  return tmp.innerHTML;
}

export function buildAnnotatedHtml(rawText, personalData, anonymized, docxHtml) {
  if (!rawText) return '';

  const { persons = [], otherPD = [], ambiguousPersons = [] } = personalData;

  // Если передан HTML от mammoth (DOCX) — аннотируем его напрямую сохраняя форматирование
  if (docxHtml) {
    const docxResult = buildAnnotatedDocxHtml(docxHtml, personalData, anonymized);
    return annotateAmbiguousPersonsHtml(docxResult, ambiguousPersons);
  }
  const marks = [];
  for (const p of persons) {
    for (const mention of (p.mentions || [p.fullName])) {
      if (mention && mention.length > 1)
        marks.push({ txt: mention, type: 'person', cat: p.category, id: p.id, letter: p.letter });
    }
  }
  for (const it of otherPD) {
    for (const mention of getOtherPdMentions(it)) {
      marks.push({ txt: mention, type: 'other', id: it.id, replacement: it.replacement, pdType: it.type });
    }
  }
  marks.sort((a, b) => b.txt.length - a.txt.length);

  // Post-process 1: убираем дубль слова перед маркером ⚠️
  // Claude иногда пишет: "слово ⚠️[НЕТОЧНО: слово]" — оставляем только маркер
  // Ловим как точное совпадение, так и совпадение по корню (первые 5 букв)
  let processText = rawText.replace(
    /([А-яЁёa-zA-Z]{2,})\s+⚠️\[НЕТОЧНО:\s*([А-яЁёa-zA-Z| ]+)\]/gi,
    (full, wordBefore, inner) => {
      // Берём первое слово из маркера (до | если есть вариант)
      const markerWord = inner.split('|')[0].trim();
      // Сравниваем по корню — первые 5 букв (или меньше если слово короткое)
      const rootLen = Math.min(5, Math.min(wordBefore.length, markerWord.length));
      const sameRoot = wordBefore.slice(0, rootLen).toLowerCase() === markerWord.slice(0, rootLen).toLowerCase();
      if (sameRoot) {
        // Убираем слово перед маркером — оставляем только маркер
        return '⚠️[НЕТОЧНО: ' + inner + ']';
      }
      return full;
    }
  );
  // Post-process 2: убираем подряд идущие одинаковые слова (от 4 букв — избегаем ложных срабатываний)
  // Например: "КоординарийСпектр КоординарийСпектр" → "КоординарийСпектр"
  processText = processText.replace(
    /\b([А-яЁёa-zA-Z]{4,})\s+\1\b/gi,
    '$1'
  );
  // Инициалы после фамилий обрабатываются через buildPersonPattern в annotLine —
  // паттерн захватывает «Фамилия И.О.» и «Фамилия И.» как единое совпадение.

  // Post-process 3: склеиваем строки которые OCR разбил по переносам внутри абзаца.
  //
  // Главный признак НОВОГО АБЗАЦА (не склеиваем):
  //   1. Между строками есть пустая строка
  //   2. Текущая строка начинается с отступа (пробелы/таб) — красная строка
  //   3. Текущая строка — специальная (заголовок, маркер страницы и т.д.)
  //
  // Во всех остальных случаях — это перенос строки внутри абзаца, склеиваем.
  // Эта логика надёжнее чем угадывать по знакам препинания.

  const isSpecialLine = (t) => !t ||
    t.startsWith('## ') ||
    t.startsWith('### ') ||
    t === '---' ||
    /^\[PAGE:\d+\]$/.test(t) ||
    /^\[CENTER\]/.test(t) ||
    /^\[LEFTRIGHT:/.test(t) ||
    /^\[RIGHT-BLOCK\]/.test(t) ||
    /^\[INDENT\]/.test(t) ||
    /^\*\*(УСТАНОВИЛ|ПОСТАНОВИЛ|РЕШИЛ|ОПРЕДЕЛИЛ|ПРИГОВОРИЛ)[:\s*]/.test(t);

  const lines = processText.split('\n');
  const mergedLines = [];
  let prevWasEmpty = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Пустая строка — запоминаем, не добавляем в результат (склейщик сам управляет переносами)
    if (!trimmed) {
      prevWasEmpty = true;
      mergedLines.push(line); // сохраняем пустую строку как разделитель абзацев
      continue;
    }

    const startsWithIndent = /^[ 	]{2,}/.test(line); // 2+ пробела или таб = красная строка
    const isSpecial = isSpecialLine(trimmed);

    // Признаки нового абзаца — не склеиваем с предыдущей строкой
    const isNewParagraph = prevWasEmpty || startsWithIndent || isSpecial;

    if (!isNewParagraph && mergedLines.length > 0) {
      // Ищем последнюю непустую строку для склейки
      let lastIdx = mergedLines.length - 1;
      while (lastIdx >= 0 && !mergedLines[lastIdx].trim()) lastIdx--;

      if (lastIdx >= 0 && !isSpecialLine(mergedLines[lastIdx].trim())) {
        mergedLines[lastIdx] = mergedLines[lastIdx].trimEnd() + ' ' + trimmed;
        prevWasEmpty = false;
        continue;
      }
    }

    mergedLines.push(line);
    prevWasEmpty = false;
  }
  const mergedText = mergedLines.join('\n');

  // Auto-center patterns for typical legal document sections
  // Strip ** markdown wrapping before testing, since Claude often writes **УСТАНОВИЛ:**
  const LEGAL_CENTER_RE = /(УСТАНОВИЛ|ПОСТАНОВИЛ|РЕШИЛ|ОПРЕДЕЛИЛ|ПРИГОВОРИЛ|УСТАНОВИЛА|ПОСТАНОВИЛА|РЕШИЛА|ОПРЕДЕЛИЛА|ПРИГОВОРИЛА|УСТАНОВИЛО|ПОСТАНОВИЛО)[:\s]/i;
  const isLegalCenter = (line) => {
    const stripped = line.replace(/\*\*/g, '').trim();
    return LEGAL_CENTER_RE.test(stripped) && stripped.length < 60;
  };

  const htmlResult = mergedText.split('\n').map(line => {
    if (line.startsWith('## ')) return `<h2 style="text-align:center">${annotLine(line.slice(3), marks, anonymized)}</h2>`;
    if (line.startsWith('### ')) return `<h3 style="text-align:center">${annotLine(line.slice(4), marks, anonymized)}</h3>`;
    // Skip --- (page break artifact)
    if (line === '---') return '<div><br/></div>';
    if (!line.trim()) return '<div><br/></div>';
    // Разделитель страниц [PAGE:N]
    const pageMatch = line.match(/^\[PAGE:(\d+)\]$/);
    if (pageMatch) {
      return `<div class="page-separator" contenteditable="false" data-page="${pageMatch[1]}"><span class="page-separator-line"></span><span class="page-separator-label">Страница ${pageMatch[1]}</span><span class="page-separator-line"></span></div>`;
    }
    // Абзац с отступом первой строки [INDENT]text
    const indentMatch = line.match(/^\[INDENT\](.+)$/);
    if (indentMatch) {
      return `<div style="text-indent:2em">${annotLine(indentMatch[1], marks, anonymized)}</div>`;
    }
    // Блок шапки справа [RIGHT-BLOCK]text — реквизиты в правой части документа
    const rightMatch = line.match(/^\[RIGHT-BLOCK\](.+)$/);
    if (rightMatch) {
      return `<div class="right-block">${annotLine(rightMatch[1], marks, anonymized)}</div>`;
    }
    // [CENTER]text[/CENTER] tag from OCR prompt
    const centerMatch = line.match(/^\[CENTER\](.+?)\[\/CENTER\]$/);
    if (centerMatch) {
      return `<div style="text-align:center">${annotLine(centerMatch[1], marks, anonymized)}</div>`;
    }
    // LEFTRIGHT: left text | right text
    const lrMatch = line.match(/^\[LEFTRIGHT:\s*(.+?)\s*\|\s*(.+?)\s*\]$/);
    if (lrMatch) {
      return `<div class="lr-row"><span>${annotLine(lrMatch[1], marks, anonymized)}</span><span>${annotLine(lrMatch[2], marks, anonymized)}</span></div>`;
    }
    // Auto-center legal section headers (handles ** wrapping too)
    if (isLegalCenter(line)) {
      // Strip ** from display, keep bold via <strong>
      const clean = line.replace(/\*\*/g, '').trim();
      return `<div style="text-align:center"><strong>${annotLine(clean, marks, anonymized)}</strong></div>`;
    }
    return `<div>${annotLine(line, marks, anonymized)}</div>`;
  }).join('');

  // Post-pass: find otherPD values that were NOT marked by annotLine
  // (e.g. value spans across line breaks, or minor text differences)
  // Uses DOM-based search across text nodes — same approach as buildAnnotatedDocxHtml
  const otherOnlyMarks = marks.filter(m => m.type === 'other');
  if (otherOnlyMarks.length > 0) {
    const tmp = document.createElement('div');
    tmp.innerHTML = htmlResult;
    // Collect ids already marked
    const markedIds = new Set();
    tmp.querySelectorAll('mark[data-pd-id]').forEach(el => markedIds.add(el.dataset.pdId));
    // Only process otherPD that have no marks yet
    const unmarked = otherOnlyMarks.filter(m => !markedIds.has(m.id));
    if (unmarked.length > 0) {
      function annotateOtherInNode(node) {
        if (node.nodeType === 3) {
          const text = node.textContent;
          const allMatches = [];
          for (const mark of unmarked) {
            try {
              const pattern = buildOtherPdPattern(mark.txt, mark.pdType);
              const re = new RegExp(pattern, 'gi');
              let m;
              while ((m = re.exec(text)) !== null) {
                allMatches.push({ start: m.index, end: m.index + m[0].length, mt: m[0], mark });
              }
            } catch {}
          }
          if (allMatches.length === 0) return;
          allMatches.sort((a, b) => a.start - b.start);
          const filtered = [];
          let lastEnd = 0;
          for (const m of allMatches) {
            if (m.start >= lastEnd) { filtered.push(m); lastEnd = m.end; }
          }
          const fragment = document.createDocumentFragment();
          let lastIdx = 0;
          for (const { start, end, mt, mark } of filtered) {
            if (start > lastIdx) fragment.appendChild(document.createTextNode(text.slice(lastIdx, start)));
            const el = document.createElement('mark');
            const isAnon = !!anonymized[mark.id];
            el.className = 'pd oth' + (isAnon ? ' anon' : '');
            el.dataset.pdId = mark.id;
            el.dataset.original = mt;
            el.contentEditable = 'false';
            el.title = isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить';
            el.textContent = isAnon ? mark.replacement : mt;
            fragment.appendChild(el);
            lastIdx = end;
          }
          if (lastIdx < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
          node.parentNode.replaceChild(fragment, node);
        } else if (node.nodeType === 1 && !['mark', 'script', 'style'].includes(node.tagName.toLowerCase())) {
          Array.from(node.childNodes).forEach(annotateOtherInNode);
        }
      }
      Array.from(tmp.childNodes).forEach(annotateOtherInNode);
      return tmp.innerHTML;
    }
  }

  return annotateAmbiguousPersonsHtml(htmlResult, ambiguousPersons);
}

export function htmlToPlainText(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.innerText || tmp.textContent || '';
}
