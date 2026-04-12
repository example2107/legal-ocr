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

function sortAndFilterMatches(matches) {
  const filtered = [];
  let lastEnd = 0;

  matches
    .sort((a, b) => a.start - b.start)
    .forEach((match) => {
      if (match.start < lastEnd) return;
      filtered.push(match);
      lastEnd = match.end;
    });

  return filtered;
}

function walkAnnotatableNodes(node, annotateNode) {
  if (node.nodeType === 3) {
    annotateNode(node);
    return;
  }

  if (node.nodeType === 1 && !['mark', 'script', 'style'].includes(node.tagName.toLowerCase())) {
    Array.from(node.childNodes).forEach((child) => walkAnnotatableNodes(child, annotateNode));
  }
}

function collectMatchesByPatterns(text, entries, buildPattern) {
  const allMatches = [];

  entries.forEach((entry) => {
    try {
      const re = new RegExp(buildPattern(entry), 'gi');
      let match;
      while ((match = re.exec(text)) !== null) {
        allMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          mt: match[0],
          entry,
        });
      }
    } catch {}
  });

  return sortAndFilterMatches(allMatches);
}

function replaceTextNode(node, matches, renderMatch) {
  if (matches.length === 0) return false;

  const text = node.textContent;
  const fragment = document.createDocumentFragment();
  let lastIdx = 0;

  matches.forEach((match) => {
    if (match.start > lastIdx) {
      fragment.appendChild(document.createTextNode(text.slice(lastIdx, match.start)));
    }
    fragment.appendChild(renderMatch(match));
    lastIdx = match.end;
  });

  if (lastIdx < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
  }

  node.parentNode.replaceChild(fragment, node);
  return true;
}

function createPdMarkElement(mark, text, anonymized) {
  const el = document.createElement('mark');
  const isAnon = !!anonymized[mark.id];
  const display = isAnon ? (mark.type === 'person' ? mark.letter : mark.replacement) : text;
  const cat = mark.type === 'person' ? (mark.cat === 'private' ? 'priv' : 'prof') : 'oth';
  el.className = 'pd ' + cat + (isAnon ? ' anon' : '');
  el.dataset.pdId = mark.id;
  el.dataset.original = text;
  el.title = isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить';
  el.textContent = display;
  return el;
}

function buildMarkDefinitions(personalData) {
  const { persons = [], otherPD = [] } = personalData;
  const marks = [];

  persons.forEach((person) => {
    (person.mentions || [person.fullName]).forEach((mention) => {
      if (mention && mention.length > 1) {
        marks.push({
          txt: mention,
          type: 'person',
          cat: person.category,
          id: person.id,
          letter: person.letter,
        });
      }
    });
  });

  otherPD.forEach((item) => {
    getOtherPdMentions(item).forEach((mention) => {
      marks.push({
        txt: mention,
        type: 'other',
        id: item.id,
        replacement: item.replacement,
        pdType: item.type,
      });
    });
  });

  return marks.sort((a, b) => b.txt.length - a.txt.length);
}

function buildLinePatternEntries(marks) {
  return marks
    .map((mark) => ({
      pattern: mark.type === 'person' ? buildPersonPattern(mark.txt) : buildOtherPdPattern(mark.txt, mark.pdType),
      mark,
    }))
    .sort((a, b) => b.mark.txt.length - a.mark.txt.length);
}

function createUncertainMarkHtml(matchText) {
  const inner = matchText.slice(3, -1);
  const isUnread = inner === 'НЕЧИТАЕМО';

  if (isUnread) {
    return '<mark class="uncertain unreadable" data-tooltip="Нечитаемый фрагмент · ПКМ — снять выделение">[НЕЧИТАЕМО]</mark>';
  }

  const content = inner.replace('НЕТОЧНО: ', '');
  const parts = content.split('|').map((value) => value.trim());
  const wrongWord = parts[0];
  const suggestion = parts[1] || '';
  const tooltip = suggestion
    ? 'Возможно неточное распознавание · ПКМ — варианты'
    : 'Возможно неточное распознавание · ПКМ — снять выделение';

  return `<mark class="uncertain" data-tooltip="${tooltip}" data-suggestion="${esc(suggestion)}">${esc(wrongWord)}</mark>`;
}

function findPatternEntry(patternEntries, text) {
  return patternEntries.find((entry) => {
    try {
      return new RegExp('^' + entry.pattern + '$', 'i').test(text);
    } catch {
      return false;
    }
  }) || null;
}

function createPdLineHtml(entry, text, anonymized) {
  const hl = entry?.mark;
  if (!hl) return applyBold(esc(text));

  const isAnon = !!anonymized[hl.id];
  const display = isAnon ? (hl.type === 'person' ? hl.letter : hl.replacement) : esc(text);
  const cat = hl.type === 'person' ? (hl.cat === 'private' ? 'priv' : 'prof') : 'oth';

  return `<mark class="pd ${cat}${isAnon ? ' anon' : ''}" data-pd-id="${hl.id}" contenteditable="false" title="${isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить'}">${display}</mark>`;
}

function normalizeMarkSpacing(html) {
  return html
    .replace(/([^\s(«"'[])(<mark\s)/g, '$1 $2')
    .replace(/(<\/mark>)([^\s)\].,!?:;»"'\u2026\u2013\u2014<])/g, '$1 $2');
}

function preprocessRawText(rawText) {
  let processText = rawText.replace(
    /([А-яЁёa-zA-Z]{2,})\s+⚠️\[НЕТОЧНО:\s*([А-яЁёa-zA-Z| ]+)\]/gi,
    (full, wordBefore, inner) => {
      const markerWord = inner.split('|')[0].trim();
      const rootLen = Math.min(5, Math.min(wordBefore.length, markerWord.length));
      const sameRoot = wordBefore.slice(0, rootLen).toLowerCase() === markerWord.slice(0, rootLen).toLowerCase();
      if (sameRoot) {
        return '⚠️[НЕТОЧНО: ' + inner + ']';
      }
      return full;
    }
  );

  processText = processText.replace(/\b([А-яЁёa-zA-Z]{4,})\s+\1\b/gi, '$1');
  return processText;
}

function isSpecialMergedLine(text) {
  return !text
    || text.startsWith('## ')
    || text.startsWith('### ')
    || text === '---'
    || /^\[PAGE:\d+\]$/.test(text)
    || /^\[CENTER\]/.test(text)
    || /^\[LEFTRIGHT:/.test(text)
    || /^\[RIGHT-BLOCK\]/.test(text)
    || /^\[INDENT\]/.test(text)
    || /^\*\*(УСТАНОВИЛ|ПОСТАНОВИЛ|РЕШИЛ|ОПРЕДЕЛИЛ|ПРИГОВОРИЛ)[:\s*]/.test(text);
}

function mergeBrokenParagraphLines(rawText) {
  const lines = rawText.split('\n');
  const mergedLines = [];
  let prevWasEmpty = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      prevWasEmpty = true;
      mergedLines.push(line);
      continue;
    }

    const startsWithIndent = /^[ \t]{2,}/.test(line);
    const isNewParagraph = prevWasEmpty || startsWithIndent || isSpecialMergedLine(trimmed);

    if (!isNewParagraph && mergedLines.length > 0) {
      let lastIdx = mergedLines.length - 1;
      while (lastIdx >= 0 && !mergedLines[lastIdx].trim()) lastIdx -= 1;

      if (lastIdx >= 0 && !isSpecialMergedLine(mergedLines[lastIdx].trim())) {
        mergedLines[lastIdx] = mergedLines[lastIdx].trimEnd() + ' ' + trimmed;
        prevWasEmpty = false;
        continue;
      }
    }

    mergedLines.push(line);
    prevWasEmpty = false;
  }

  return mergedLines.join('\n');
}

function renderAnnotatedLine(line, marks, anonymized, isLegalCenter) {
  if (line.startsWith('## ')) return `<h2 style="text-align:center">${annotLine(line.slice(3), marks, anonymized)}</h2>`;
  if (line.startsWith('### ')) return `<h3 style="text-align:center">${annotLine(line.slice(4), marks, anonymized)}</h3>`;
  if (line === '---') return '<div><br/></div>';
  if (!line.trim()) return '<div><br/></div>';

  const pageMatch = line.match(/^\[PAGE:(\d+)\]$/);
  if (pageMatch) {
    return `<div class="page-separator" contenteditable="false" data-page="${pageMatch[1]}"><span class="page-separator-line"></span><span class="page-separator-label">Страница ${pageMatch[1]}</span><span class="page-separator-line"></span></div>`;
  }

  const indentMatch = line.match(/^\[INDENT\](.+)$/);
  if (indentMatch) {
    return `<div style="text-indent:2em">${annotLine(indentMatch[1], marks, anonymized)}</div>`;
  }

  const rightMatch = line.match(/^\[RIGHT-BLOCK\](.+)$/);
  if (rightMatch) {
    return `<div class="right-block">${annotLine(rightMatch[1], marks, anonymized)}</div>`;
  }

  const centerMatch = line.match(/^\[CENTER\](.+?)\[\/CENTER\]$/);
  if (centerMatch) {
    return `<div style="text-align:center">${annotLine(centerMatch[1], marks, anonymized)}</div>`;
  }

  const lrMatch = line.match(/^\[LEFTRIGHT:\s*(.+?)\s*\|\s*(.+?)\s*\]$/);
  if (lrMatch) {
    return `<div class="lr-row"><span>${annotLine(lrMatch[1], marks, anonymized)}</span><span>${annotLine(lrMatch[2], marks, anonymized)}</span></div>`;
  }

  if (isLegalCenter(line)) {
    const clean = line.replace(/\*\*/g, '').trim();
    return `<div style="text-align:center"><strong>${annotLine(clean, marks, anonymized)}</strong></div>`;
  }

  return `<div>${annotLine(line, marks, anonymized)}</div>`;
}

function annotateUnmarkedOtherPdHtml(html, otherMarks, anonymized) {
  if (otherMarks.length === 0) return html;

  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const markedIds = new Set();
  tmp.querySelectorAll('mark[data-pd-id]').forEach((el) => markedIds.add(el.dataset.pdId));
  const unmarked = otherMarks.filter((mark) => !markedIds.has(mark.id));

  if (unmarked.length === 0) return html;

  Array.from(tmp.childNodes).forEach((node) => walkAnnotatableNodes(node, (textNode) => {
    const matches = collectMatchesByPatterns(textNode.textContent, unmarked, (mark) => buildOtherPdPattern(mark.txt, mark.pdType));
    replaceTextNode(textNode, matches, ({ mt, entry }) => createPdMarkElement(entry, mt, anonymized));
  }));

  return tmp.innerHTML;
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

  Array.from(tmp.childNodes).forEach((node) => walkAnnotatableNodes(node, (textNode) => {
    const matches = collectMatchesByPatterns(textNode.textContent, ambiguousMarks, (item) => buildAmbiguousPersonPattern(item.value));
    replaceTextNode(textNode, matches, ({ mt, entry }) => {
      const el = document.createElement('mark');
      el.className = 'ambiguous-person';
      el.dataset.value = entry.value;
      el.dataset.context = entry.context;
      el.dataset.reason = entry.reason;
      el.dataset.tooltip = entry.reason;
      el.contentEditable = 'false';
      el.textContent = mt;
      return el;
    });
  }));
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
  if (/^[А-ЯЁ]\s*[.,]\s*[А-ЯЁ]?(?:\s*[.,])?\s/i.test(mention)) {
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
  const patternEntries = buildLinePatternEntries(marks);
  const patterns = [
    '⚠️\\[(НЕТОЧНО: [^\\]]*|НЕЧИТАЕМО)\\]',
    ...patternEntries.map((entry) => entry.pattern),
  ];
  let re;
  try { re = new RegExp(patterns.join('|'), 'gi'); } catch { return applyBold(esc(text)); }

  let out = '', last = 0, match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out += applyBold(esc(text.slice(last, match.index)));
    const mt = match[0].replace(/\s+$/, '');
    if (mt.startsWith('⚠️[')) {
      out += createUncertainMarkHtml(mt);
    } else {
      out += createPdLineHtml(findPatternEntry(patternEntries, mt), mt, anonymized);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out += applyBold(esc(text.slice(last)));
  return normalizeMarkSpacing(out);
}

// ── Build full annotated HTML from rawText (used only on first load) ───────────
// Аннотирует HTML от mammoth — заменяет упоминания ПД на <mark> прямо в HTML
function buildAnnotatedDocxHtml(docxHtml, personalData, anonymized) {
  const marks = buildMarkDefinitions(personalData);

  const tmp = document.createElement('div');
  tmp.innerHTML = docxHtml;

  Array.from(tmp.childNodes).forEach((node) => walkAnnotatableNodes(node, (textNode) => {
    const matches = collectMatchesByPatterns(textNode.textContent, marks, (mark) => (
      mark.type === 'person' ? buildPersonPattern(mark.txt) : buildOtherPdPattern(mark.txt, mark.pdType)
    ));
    replaceTextNode(textNode, matches, ({ mt, entry }) => createPdMarkElement(entry, mt, anonymized));
  }));

  return tmp.innerHTML;
}

export function buildAnnotatedHtml(rawText, personalData, anonymized, docxHtml) {
  if (!rawText) return '';

  const { persons = [], otherPD = [], ambiguousPersons = [] } = personalData;

  if (docxHtml) {
    const docxResult = buildAnnotatedDocxHtml(docxHtml, personalData, anonymized);
    return annotateAmbiguousPersonsHtml(docxResult, ambiguousPersons);
  }
  const marks = buildMarkDefinitions({ persons, otherPD });
  const mergedText = mergeBrokenParagraphLines(preprocessRawText(rawText));
  const LEGAL_CENTER_RE = /(УСТАНОВИЛ|ПОСТАНОВИЛ|РЕШИЛ|ОПРЕДЕЛИЛ|ПРИГОВОРИЛ|УСТАНОВИЛА|ПОСТАНОВИЛА|РЕШИЛА|ОПРЕДЕЛИЛА|ПРИГОВОРИЛА|УСТАНОВИЛО|ПОСТАНОВИЛО)[:\s]/i;
  const isLegalCenter = (line) => {
    const stripped = line.replace(/\*\*/g, '').trim();
    return LEGAL_CENTER_RE.test(stripped) && stripped.length < 60;
  };

  const htmlResult = mergedText
    .split('\n')
    .map((line) => renderAnnotatedLine(line, marks, anonymized, isLegalCenter))
    .join('');

  const otherOnlyMarks = marks.filter(m => m.type === 'other');
  const finalHtml = annotateUnmarkedOtherPdHtml(htmlResult, otherOnlyMarks, anonymized);
  return annotateAmbiguousPersonsHtml(finalHtml, ambiguousPersons);
}

export function htmlToPlainText(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.innerText || tmp.textContent || '';
}
