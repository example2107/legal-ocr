import React, { useRef, useEffect, useCallback } from 'react';
import './RichEditor.css';

// ── Toolbar config ─────────────────────────────────────────────────────────────
const TOOLBAR = [
  {
    group: 'inline',
    items: [
      { cmd: 'bold',      icon: 'B', title: 'Жирный (Ctrl+B)',       style: { fontWeight: 700 } },
      { cmd: 'italic',    icon: 'К', title: 'Курсив (Ctrl+I)',        style: { fontStyle: 'italic' } },
      { cmd: 'underline', icon: 'П', title: 'Подчёркнутый (Ctrl+U)', style: { textDecoration: 'underline' } },
    ],
  },
  { type: 'sep' },
  {
    group: 'align',
    items: [
      { cmd: 'justifyLeft',   svg: 'align-left',    title: 'По левому краю' },
      { cmd: 'justifyCenter', svg: 'align-center',  title: 'По центру' },
      { cmd: 'justifyRight',  svg: 'align-right',   title: 'По правому краю' },
      { cmd: 'justifyFull',   svg: 'align-justify', title: 'По ширине' },
    ],
  },
  { type: 'sep' },
  {
    group: 'lists',
    items: [
      { cmd: 'insertOrderedList',   svg: 'list-ol', title: 'Нумерованный список' },
      { cmd: 'insertUnorderedList', svg: 'list-ul', title: 'Маркированный список' },
    ],
  },
  { type: 'sep' },
  {
    group: 'indent',
    items: [
      { cmd: 'outdent', svg: 'outdent', title: 'Уменьшить отступ (Shift+Tab)' },
      { cmd: 'indent',  svg: 'indent',  title: 'Увеличить отступ (Tab)' },
    ],
  },
  { type: 'sep' },
  {
    group: 'clear',
    items: [
      { cmd: 'removeFormat', svg: 'clear-format', title: 'Убрать форматирование' },
    ],
  },
];

// ── SVG icons ──────────────────────────────────────────────────────────────────
const ICONS = {
  'align-left': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
    </svg>
  ),
  'align-center': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm2-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
    </svg>
  ),
  'align-right': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-4-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm4-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-4-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
    </svg>
  ),
  'align-justify': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 12.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
    </svg>
  ),
  'list-ol': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5z"/>
      <path d="M1.713 11.865v-.474H2c.217 0 .363-.137.363-.317 0-.185-.158-.31-.361-.31-.223 0-.367.152-.373.31h-.59c.016-.467.373-.787.986-.787.588-.002.954.291.957.703a.595.595 0 0 1-.492.594v.033a.615.615 0 0 1 .569.631c.003.533-.502.8-1.051.8-.656 0-1-.37-1.008-.794h.582c.008.178.186.306.422.309.254 0 .424-.145.422-.35-.002-.195-.155-.348-.414-.348h-.3zm-.004-4.699h-.604v-.035c0-.408.295-.844.958-.844.583 0 .96.326.96.756 0 .389-.257.617-.476.848l-.537.572v.03h1.054V9H1.143v-.395l.957-.99c.138-.142.293-.304.293-.508 0-.18-.147-.32-.342-.32a.33.33 0 0 0-.342.338v.041zM2.564 5h-.563v-2.5h-.018l-.51.317v-.51L1.978 2h.586V5z"/>
    </svg>
  ),
  'list-ul': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5z"/>
      <path d="M2 13.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0-4a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0-4a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
    </svg>
  ),
  // New clean indent icons: lines + arrow direction
  'outdent': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 2h12v1.5H2V2zm0 10.5h12V14H2v-1.5zm4-5.25h8V8.75H6V7.25zM4.5 8 2 5.5v5L4.5 8z"/>
    </svg>
  ),
  'indent': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 2h12v1.5H2V2zm0 10.5h12V14H2v-1.5zm4-5.25h8V8.75H6V7.25zM2 5.5 4.5 8 2 10.5v-5z"/>
    </svg>
  ),
  'clear-format': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M8.21 1.073a.5.5 0 0 1 .7-.077l5 4a.5.5 0 0 1-.626.782L8.977 2.06 2.825 8h2.656l.96 3.2.786-.393a.5.5 0 0 1 .448.894l-1.5.75a.5.5 0 0 1-.673-.227L3.6 8.8H.5a.5.5 0 0 1-.39-.811L8.21 1.073z"/>
      <path d="M10.854 9.146a.5.5 0 0 0-.707 0L9 10.293 7.854 9.146a.5.5 0 0 0-.707.707L8.293 11l-1.146 1.146a.5.5 0 0 0 .707.708L9 11.707l1.146 1.147a.5.5 0 0 0 .708-.708L9.707 11l1.147-1.146a.5.5 0 0 0 0-.708z"/>
    </svg>
  ),
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Строит regex-паттерн для упоминания человека:
// - Захватывает падежные окончания каждого слова ФИО (через усечение корня)
// - Захватывает инициалы после фамилии (А., В.Г.) и перед фамилией (С.В. Фамилия)
function buildPersonPattern(mention) {
  // Инициалы после: пробел + заглавная + точка (+ опц. ещё одна пара)
  const initialsAfter = '(?:\\s+[А-ЯЁ]\\.[А-ЯЁ]\\.?|\\s+[А-ЯЁ]\\.)?';
  // Инициалы перед: заглавная + точка (одна или две пары) + пробел
  const initialsBefore = '(?:[А-ЯЁ]\\.[А-ЯЁ]\\.?\\s+|[А-ЯЁ]\\.\\s+)?';

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
  if (/^[А-ЯЁ]\.[А-ЯЁ]?\.?\s/.test(mention)) {
    const base = words.map(wordToPattern).join('\\s+');
    return base + initialsAfter;
  }

  if (words.length > 1) {
    const base = words.map(wordToPattern).join('\\s+');
    return base + initialsAfter;
  }

  // Одно слово — ищем с инициалами до и после
  return initialsBefore + wordToPattern(mention) + initialsAfter;
}
function applyBold(html) {
  return html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function annotLine(text, marks, anonymized) {
  // Для persons — расширенный паттерн с падежами и инициалами
  // Для otherPD — точный паттерн
  const patternEntries = marks.map(m => ({
    pattern: m.type === 'person' ? buildPersonPattern(m.txt) : escRe(m.txt),
    mark: m,
  }));

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
        out += `<mark class="pd ${cat}${isAnon ? ' anon' : ''}" data-pd-id="${hl.id}" title="${isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить'}">${display}</mark>`;
      } else {
        out += applyBold(esc(mt));
      }
    }
    last = match.index + match[0].length; // advance by full match including any trailing space
  }
  if (last < text.length) out += applyBold(esc(text.slice(last)));
  // Гарантируем пробел до и после каждого <mark> чтобы при редактировании
  // курсор не застревал внутри маркера
  out = out
    .replace(/([^\s>])(<mark\s)/g, '$1 $2')              // пробел перед <mark> если любой не-пробельный символ сливается
    .replace(/(<\/mark>)([а-яёА-ЯЁa-zA-Z0-9])/g, '$1 $2'); // пробел после </mark> только если буква/цифра (знаки препинания — норма)
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
    if (it.value) marks.push({ txt: it.value, type: 'other', id: it.id, replacement: it.replacement });
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
          const pattern = buildPersonPattern(mark.txt);
          const re = new RegExp(pattern, 'g');
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

  // Если передан HTML от mammoth (DOCX) — аннотируем его напрямую сохраняя форматирование
  if (docxHtml) {
    return buildAnnotatedDocxHtml(docxHtml, personalData, anonymized);
  }
  const { persons = [], otherPD = [] } = personalData;
  const marks = [];
  for (const p of persons) {
    for (const mention of (p.mentions || [p.fullName])) {
      if (mention && mention.length > 1)
        marks.push({ txt: mention, type: 'person', cat: p.category, id: p.id, letter: p.letter });
    }
  }
  for (const it of otherPD) {
    if (it.value) marks.push({ txt: it.value, type: 'other', id: it.id, replacement: it.replacement });
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

  // Post-process 3: склеиваем строки которые OCR разбил по переносам PDF
  // Если строка не заканчивается на знак препинания — она продолжается на следующей строке
  // Склеиваем через пробел чтобы получить полные абзацы и корректный justify
  const lines = processText.split('\n');
  const mergedLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Специальные строки — не склеиваем
    const isSpecial = !trimmed ||
      trimmed.startsWith('## ') ||
      trimmed.startsWith('### ') ||
      trimmed === '---' ||
      /^\[PAGE:\d+\]$/.test(trimmed) ||
      /^\[CENTER\]/.test(trimmed) ||
      /^\[LEFTRIGHT:/.test(trimmed) ||
      /^\[RIGHT-BLOCK\]/.test(trimmed) ||
      /^\[INDENT\]/.test(trimmed) ||
      /^\*\*(УСТАНОВИЛ|ПОСТАНОВИЛ|РЕШИЛ|ОПРЕДЕЛИЛ|ПРИГОВОРИЛ)[:\s*]/.test(trimmed);

    if (isSpecial) {
      mergedLines.push(line);
      continue;
    }

    // Если предыдущая строка не заканчивается на знак препинания — склеиваем
    if (mergedLines.length > 0) {
      const prev = mergedLines[mergedLines.length - 1];
      const prevTrimmed = prev.trim();
      const prevIsSpecial = !prevTrimmed ||
        prevTrimmed.startsWith('## ') ||
        prevTrimmed.startsWith('### ') ||
        prevTrimmed === '---' ||
        /^\[PAGE:\d+\]$/.test(prevTrimmed) ||
        /^\[CENTER\]/.test(prevTrimmed) ||
        /^\[LEFTRIGHT:/.test(prevTrimmed) ||
        /^\[RIGHT-BLOCK\]/.test(prevTrimmed) ||
        /^\[INDENT\]/.test(prevTrimmed);

      // Склеиваем если предыдущая строка не заканчивается на . ! ? : ; » " и не спецстрока
      if (!prevIsSpecial && prevTrimmed && !/[.!?:;»"\]]$/.test(prevTrimmed)) {
        mergedLines[mergedLines.length - 1] = prev.trimEnd() + ' ' + trimmed;
        continue;
      }
    }
    mergedLines.push(line);
  }
  const mergedText = mergedLines.join('\n');

  // Auto-center patterns for typical legal document sections
  // Strip ** markdown wrapping before testing, since Claude often writes **УСТАНОВИЛ:**
  const LEGAL_CENTER_RE = /(УСТАНОВИЛ|ПОСТАНОВИЛ|РЕШИЛ|ОПРЕДЕЛИЛ|ПРИГОВОРИЛ|УСТАНОВИЛА|ПОСТАНОВИЛА|РЕШИЛА|ОПРЕДЕЛИЛА|ПРИГОВОРИЛА|УСТАНОВИЛО|ПОСТАНОВИЛО)[:\s]/i;
  const isLegalCenter = (line) => {
    const stripped = line.replace(/\*\*/g, '').trim();
    return LEGAL_CENTER_RE.test(stripped) && stripped.length < 60;
  };

  return mergedText.split('\n').map(line => {
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
}

export function htmlToPlainText(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.innerText || tmp.textContent || '';
}

// ── Patch existing PD marks in DOM without rebuilding entire HTML ──────────────
// This is the key fix: instead of replacing innerHTML, we surgically update
// only the <mark data-pd-id="..."> elements that changed.
export function patchPdMarks(editorEl, id, isAnon, letter, replacement) {
  if (!editorEl) return;
  const marks = editorEl.querySelectorAll(`mark[data-pd-id="${id}"]`);
  marks.forEach(mark => {
    const wasAnon = mark.classList.contains('anon');
    if (isAnon && !wasAnon) {
      mark.textContent = letter || replacement || '?';
      mark.classList.add('anon');
      mark.title = 'Нажмите, чтобы показать';
      // Пробел перед маркером
      const prev = mark.previousSibling;
      if (prev && prev.nodeType === 3 && /\S$/.test(prev.textContent)) {
        prev.textContent = prev.textContent + ' ';
      }
      // Пробел после маркера — только если следом буква/цифра (знаки препинания — норма)
      const next = mark.nextSibling;
      if (next && next.nodeType === 3 && /^[а-яёА-ЯЁa-zA-Z0-9]/.test(next.textContent)) {
        next.textContent = ' ' + next.textContent;
      }
    } else if (!isAnon && wasAnon) {
      mark.textContent = mark.dataset.original || mark.textContent;
      mark.classList.remove('anon');
      mark.title = 'Нажмите, чтобы обезличить';
      // Гарантируем пробел после — только если следом буква/цифра (знаки препинания — норма)
      const nextNode = mark.nextSibling;
      if (nextNode && nextNode.nodeType === 3 && /^[а-яёА-ЯЁa-zA-Z0-9]/.test(nextNode.textContent)) {
        nextNode.textContent = ' ' + nextNode.textContent;
      }
      // Гарантируем пробел перед
      const prevNode = mark.previousSibling;
      if (prevNode && prevNode.nodeType === 3 && /\S$/.test(prevNode.textContent)) {
        prevNode.textContent = prevNode.textContent + ' ';
      }
    }
  });
}

// Store original text on marks when editor is initialized
export function initPdMarkOriginals(editorEl) {
  if (!editorEl) return;
  editorEl.querySelectorAll('mark[data-pd-id]').forEach(mark => {
    if (!mark.dataset.original) {
      mark.dataset.original = mark.textContent;
    }
  });
}

// ── Wrap a saved Range with a PD mark ─────────────────────────────────────────
// Called from App.js when user picks a PD item from the selection popover.
// range      — a saved Range object (cloned before selection is lost)
// id, cat    — PD id and css category ('priv'|'prof'|'oth')
// isAnon     — current anonymization state
// display    — text to show if isAnon (letter or replacement), else original text
export function wrapRangeWithMark(range, id, cat, isAnon, display) {
  if (!range) return null;

  // surroundContents fails when the range crosses element boundaries —
  // e.g. selection starts inside a <strong> and ends outside it.
  // extractContents + insertNode is safe in all cases.
  let markEl;
  try {
    markEl = document.createElement('mark');
    markEl.className = `pd ${cat}${isAnon ? ' anon' : ''}`;
    markEl.dataset.pdId = id;
    markEl.title = isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить';

    const extracted = range.extractContents();
    // extracted is a DocumentFragment — get its plain text as the original value
    const originalText = extracted.textContent;
    markEl.dataset.original = originalText;
    markEl.textContent = isAnon ? display : originalText;

    range.insertNode(markEl);
  } catch (e) {
    console.warn('wrapRangeWithMark failed:', e);
    return null;
  }
  return markEl;
}

// ── RichEditor component ───────────────────────────────────────────────────────
// ── Context menu for uncertain marks ─────────────────────────────────────────
function UncertainContextMenu({ x, y, onRemove, onApplySuggestion, suggestion, onClose }) {
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    const handler = () => onClose();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [onClose]);

  // Корректируем позицию если меню выходит за край экрана
  React.useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8)
      el.style.left = Math.max(8, window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight - 8)
      el.style.top = Math.max(8, y - rect.height - 8) + 'px';
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="uncertain-menu"
      style={{ position: 'fixed', top: y + 4, left: x, zIndex: 9999 }}
      onMouseDown={e => e.stopPropagation()}
    >
      {suggestion && (
        <div className="uncertain-menu-item uncertain-menu-suggestion" onClick={onApplySuggestion}>
          ✏️ Заменить на: <strong>{suggestion}</strong>
        </div>
      )}
      <div className="uncertain-menu-item" onClick={onRemove}>
        ✓ Исправлено — снять выделение
      </div>
    </div>
  );
}

export function RichEditor({ html, onHtmlChange, onPdClick, onSelectionChange, editorRef: externalRef, highlightUncertain }) {
  const internalRef = useRef(null);
  const editorRef = externalRef || internalRef;
  const lastHtml = useRef('');
  const isComposing = useRef(false);
  const [ctxMenu, setCtxMenu] = React.useState(null); // {x, y, mark}

  // Only set innerHTML when html prop changes from OUTSIDE (new doc, not user typing)
  useEffect(() => {
    if (!editorRef.current) return;
    // Only update DOM if content truly differs (avoids cursor jump on every keystroke)
    if (html !== lastHtml.current) {
      editorRef.current.innerHTML = html || '';
      lastHtml.current = html || '';
      // Store originals for de-anonymization
      initPdMarkOriginals(editorRef.current);
    }
  }, [html, editorRef]);

  const notifyChange = useCallback(() => {
    if (!editorRef.current) return;
    const current = editorRef.current.innerHTML;
    if (current !== lastHtml.current) {
      lastHtml.current = current;
      onHtmlChange?.(current);
      pushUndoSnapshot(false); // дебаунс 500мс для набора текста
    }
  }, [onHtmlChange, editorRef, pushUndoSnapshot]);

  const exec = useCallback((cmd, value = null) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    // If nothing is selected and command needs a selection (formatBlock, fontSize),
    // select all content in the current block so the command applies
    const sel = window.getSelection();
    if (sel && sel.rangeCount === 0) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    document.execCommand(cmd, false, value);
    notifyChange();
  }, [notifyChange, editorRef]);

  const handleClick = useCallback((e) => {
    const mark = e.target.closest('mark[data-pd-id]');
    if (mark) {
      e.preventDefault();
      e.stopPropagation();
      onPdClick?.(mark.dataset.pdId);
    }
  }, [onPdClick]);

  const handleContextMenu = useCallback((e) => {
    const mark = e.target.closest('mark.uncertain');
    if (mark) {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, mark });
    }
  }, []);

  const removeUncertainMark = useCallback(() => {
    if (!ctxMenu?.mark) return;
    const mark = ctxMenu.mark;
    const text = document.createTextNode(mark.textContent);
    mark.parentNode.replaceChild(text, mark);
    notifyChange();
    setCtxMenu(null);
  }, [ctxMenu, notifyChange]);

  const applyUncertainSuggestion = useCallback(() => {
    if (!ctxMenu?.mark) return;
    const mark = ctxMenu.mark;
    const suggestion = mark.dataset.suggestion;
    if (!suggestion) return;
    // Заменяем mark на текст с предложенным вариантом
    const text = document.createTextNode(suggestion);
    mark.parentNode.replaceChild(text, mark);
    notifyChange();
    setCtxMenu(null);
  }, [ctxMenu, notifyChange]);

  const handleMouseUp = useCallback((e) => {
    if (!onSelectionChange) return;
    // Small timeout so browser has time to update selection after click
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        onSelectionChange(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const text = sel.toString().trim();
      if (!text) { onSelectionChange(null); return; }

      // Don't show popover if selection is entirely inside an existing PD mark
      const container = range.commonAncestorContainer;
      const el = container.nodeType === 3 ? container.parentElement : container;
      if (el.closest('mark[data-pd-id]')) { onSelectionChange(null); return; }

      // Clone range before it gets lost
      const cloned = range.cloneRange();
      const rect = range.getBoundingClientRect();
      onSelectionChange({ range: cloned, rect, text });
    }, 0);
  }, [onSelectionChange]);

  // ── Custom undo stack ──────────────────────────────────────────────────────
  // Браузерный undo не знает о patchPdMarks и wrapRangeWithMark (DOM-операции).
  // Храним свои снимки innerHTML. Дебаунс 500мс группирует набор текста.
  const UNDO_LIMIT = 200;
  const undoStack = useRef([]);   // массив строк innerHTML
  const undoIndex = useRef(-1);   // текущая позиция в стеке
  const debounceTimer = useRef(null);
  const isPushingUndo = useRef(false); // флаг чтобы не пушить при восстановлении

  // Инициализируем стек при загрузке нового документа
  useEffect(() => {
    if (!editorRef.current) return;
    if (html !== lastHtml.current) return; // только если уже обновили innerHTML
    // При новом документе сбрасываем стек
    undoStack.current = [html || ''];
    undoIndex.current = 0;
  }, [html]); // html — единственная внешняя зависимость, refs не нужны в deps

  const pushUndoSnapshot = useCallback((immediate = false) => {
    if (isPushingUndo.current) return;
    if (!editorRef.current) return;

    const doSnapshot = () => {
      const current = editorRef.current?.innerHTML || '';
      // Не пушим если контент не изменился относительно последнего снимка
      const top = undoStack.current[undoIndex.current];
      if (current === top) return;

      // Обрезаем всё что «после» текущей позиции (redo-ветка)
      undoStack.current = undoStack.current.slice(0, undoIndex.current + 1);
      undoStack.current.push(current);

      // Ограничиваем размер стека
      if (undoStack.current.length > UNDO_LIMIT) {
        undoStack.current.shift();
      }
      undoIndex.current = undoStack.current.length - 1;
    };

    if (immediate) {
      clearTimeout(debounceTimer.current);
      doSnapshot();
    } else {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(doSnapshot, 500);
    }
  }, [editorRef]);

  // Публичный метод — вызывается из App.js после patchPdMarks / wrapRangeWithMark
  // через ref на RichEditor. Immediate=true чтобы не объединять с набором текста.
  const pushUndoImmediate = useCallback(() => {
    pushUndoSnapshot(true);
  }, [pushUndoSnapshot]);

  // Expose через ref чтобы App.js мог вызывать
  useEffect(() => {
    if (externalRef && typeof externalRef === 'object') {
      externalRef._pushUndo = pushUndoImmediate;
    }
  }, [externalRef, pushUndoImmediate]);

  const handleUndo = useCallback(() => {
    if (undoIndex.current <= 0) return; // нечего отменять
    isPushingUndo.current = true;
    clearTimeout(debounceTimer.current);
    undoIndex.current -= 1;
    const snapshot = undoStack.current[undoIndex.current];
    if (editorRef.current) {
      editorRef.current.innerHTML = snapshot;
      lastHtml.current = snapshot;
      onHtmlChange?.(snapshot);
      initPdMarkOriginals(editorRef.current);
    }
    isPushingUndo.current = false;
  }, [editorRef, onHtmlChange]);

  const handleKeyDown = useCallback((e) => {
    // Перехватываем Ctrl/Cmd+Z — используем свой стек
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      exec(e.shiftKey ? 'outdent' : 'indent');
    }
  }, [exec, handleUndo]);

  // Выносим курсор за пределы <mark class="pd"> при вводе текста
  const escapeFromPdMark = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    // Ищем ближайший mark.pd вокруг курсора
    const mark = node.nodeType === 3
      ? node.parentElement?.closest('mark.pd')
      : node.closest?.('mark.pd');
    if (!mark) return;
    // Курсор внутри mark — выносим его сразу после mark
    const newRange = document.createRange();
    newRange.setStartAfter(mark);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }, []);

  return (
    <div className="rich-editor-wrap">
      <div className="rich-toolbar" onMouseDown={e => e.preventDefault()}>
        {TOOLBAR.map((entry, i) => {
          if (entry.type === 'sep') return <div key={`sep-${i}`} className="rich-sep" />;
          return entry.items.map((item, j) => {
            if (item.type === 'select') return null; // selects removed
            return (
              <button
                key={`btn-${i}-${j}`}
                className="rich-btn"
                title={item.title}
                onMouseDown={e => { e.preventDefault(); exec(item.cmd); }}
              >
                {item.svg
                  ? <span className="rich-icon">{ICONS[item.svg]}</span>
                  : <span style={item.style}>{item.icon}</span>
                }
              </button>
            );
          });
        })}
      </div>

      <div
        ref={editorRef}
        className={"rich-content" + (highlightUncertain ? " uncertain-highlight-active" : "")}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={() => {
          escapeFromPdMark();
          if (!isComposing.current) notifyChange();
        }}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => { isComposing.current = false; notifyChange(); }}
        onBlur={notifyChange}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseUp={handleMouseUp}
      />
      {ctxMenu && (
        <UncertainContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          suggestion={ctxMenu.mark?.dataset?.suggestion || ''}
          onRemove={removeUncertainMark}
          onApplySuggestion={applyUncertainSuggestion}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
