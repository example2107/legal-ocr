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
// Знаки после которых НЕ ставим пробел перед маркером
const NO_SPACE_BEFORE_MARK = /[\s(\[«"']/;
// Знаки перед которыми НЕ ставим пробел после маркера
const NO_SPACE_AFTER_MARK  = /^[\s)\].,!?:;»"'\u2026\u2013\u2014]/;

function ensureSpaceAroundMark(mark) {
  // Пробел ДО маркера
  const prev = mark.previousSibling;
  if (prev && prev.nodeType === 3) {
    const txt = prev.textContent;
    if (txt && !NO_SPACE_BEFORE_MARK.test(txt.slice(-1))) {
      prev.textContent = txt + ' ';
    }
  }
  // Пробел ПОСЛЕ маркера
  const next = mark.nextSibling;
  if (next && next.nodeType === 3) {
    const txt = next.textContent;
    if (txt && !NO_SPACE_AFTER_MARK.test(txt)) {
      next.textContent = ' ' + txt;
    }
  }
}

function removeSpaceAroundMark(mark) {
  // Убираем пробел ДО маркера если мы его добавили
  const prev = mark.previousSibling;
  if (prev && prev.nodeType === 3) {
    const txt = prev.textContent;
    if (txt && txt.endsWith(' ') && txt.length > 1 && !NO_SPACE_BEFORE_MARK.test(txt.slice(-2, -1))) {
      prev.textContent = txt.slice(0, -1);
    }
  }
  // Убираем пробел ПОСЛЕ маркера если мы его добавили
  const next = mark.nextSibling;
  if (next && next.nodeType === 3) {
    const txt = next.textContent;
    if (txt && txt.startsWith(' ') && !NO_SPACE_AFTER_MARK.test(txt.slice(1, 2))) {
      next.textContent = txt.slice(1);
    }
  }
}

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
      ensureSpaceAroundMark(mark);
    } else if (!isAnon && wasAnon) {
      mark.textContent = mark.dataset.original || mark.textContent;
      mark.classList.remove('anon');
      mark.title = 'Нажмите, чтобы обезличить';
      ensureSpaceAroundMark(mark);
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

// ── RichEditor component ───────────────────────────────────────────────────────
// ── Context menu for uncertain marks ─────────────────────────────────────────
function UncertainContextMenu({ x, y, type, onRemove, onApplySuggestion, suggestion, onClose }) {
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
      {type === 'pd' ? (
        <div className="uncertain-menu-item" onClick={onRemove}>
          ✕ Не является ПД
        </div>
      ) : (
        <>
          {suggestion && (
            <div className="uncertain-menu-item uncertain-menu-suggestion" onClick={onApplySuggestion}>
              ✏️ Заменить на: <strong>{suggestion}</strong>
            </div>
          )}
          <div className="uncertain-menu-item" onClick={onRemove}>
            ✓ Исправлено — снять выделение
          </div>
        </>
      )}
    </div>
  );
}

export function RichEditor({ html, onHtmlChange, onPdClick, onRemovePdMark, editorRef: externalRef, highlightUncertain }) {
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
    }
  }, [onHtmlChange, editorRef]);

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
    const uncertainMark = e.target.closest('mark.uncertain');
    const pdMark = e.target.closest('mark[data-pd-id]');
    if (uncertainMark) {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, mark: uncertainMark, type: 'uncertain' });
    } else if (pdMark) {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, mark: pdMark, type: 'pd' });
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

  const removePdMark = useCallback(() => {
    if (!ctxMenu?.mark) return;
    const mark = ctxMenu.mark;
    const id = mark.dataset.pdId;
    const text = document.createTextNode(mark.textContent);
    mark.parentNode.replaceChild(text, mark);
    notifyChange();
    setCtxMenu(null);
    onRemovePdMark?.(id);
  }, [ctxMenu, notifyChange, onRemovePdMark]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      exec(e.shiftKey ? 'outdent' : 'indent');
    }
  }, [exec]);

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
      />
      {ctxMenu && (
        <UncertainContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          type={ctxMenu.type}
          suggestion={ctxMenu.mark?.dataset?.suggestion || ''}
          onRemove={ctxMenu.type === 'pd' ? removePdMark : removeUncertainMark}
          onApplySuggestion={applyUncertainSuggestion}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
