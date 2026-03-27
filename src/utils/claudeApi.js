// ── Provider configs ──────────────────────────────────────────────────────────
export const PROVIDERS = {
  claude: {
    label: 'Claude (Anthropic)',
    model: 'claude-sonnet-4-20250514',
    placeholder: 'sk-ant-...',
  },
  openai: {
    label: 'ChatGPT (OpenAI)',
    model: 'gpt-5.4',
    placeholder: 'sk-...',
  },
  gemini: {
    label: 'Gemini (Google)',
    model: 'gemini-3.1-pro-preview',
    placeholder: 'AIza...',
  },
};

// ── System prompts ─────────────────────────────────────────────────────────────
const SYS_OCR = `Ты — профессиональная система распознавания юридических документов на русском языке.

Твоя задача: точно распознать текст с изображения юридического документа (решение суда, постановление, следственный документ, протокол и т.д.).

ПРАВИЛА ФОРМАТИРОВАНИЯ ОТВЕТА:
1. Сохраняй точную структуру документа: заголовки, отступы, нумерацию, разделы
2. Используй markdown разметку для структуры:
   - Заголовки документа: ## Заголовок
   - Подзаголовки: ### Подзаголовок
   - Важные разделы (ПОСТАНОВИЛ, РЕШИЛ, ОПРЕДЕЛИЛ и т.д.): **ТЕКСТ**
3. Если часть текста нечитаема или распознана неуверенно: ⚠️[НЕТОЧНО: предполагаемый текст]
4. Если текст совсем нечитаем: ⚠️[НЕЧИТАЕМО]
5. Для строк где текст одновременно слева и справа (например город слева, дата справа): [LEFTRIGHT: левый текст | правый текст]
6. Возвращай ТОЛЬКО текст документа. Никаких пояснений. Начинай сразу с текста.

ВАЖНО — КОГДА СТАВИТЬ МАРКЕР ⚠️[НЕТОЧНО: ...]:
- Слово на изображении размыто, смазано, перечёркнуто или нечётко напечатано
- Буквы слова нестандартно написаны или нетипичны для данного контекста
- Ты угадываешь слово по контексту, но не уверен что именно так написано в оригинале
- Слово выглядит как OCR-артефакт: похоже на существующее слово, но что-то "не так"
- Ты подставляешь слово которое "подходит по смыслу", но оригинал неразборчив

ПРИМЕРЫ когда НУЖЕН маркер:
- Размытое слово читается как "своей" но могло быть "сувоей" → пиши ⚠️[НЕТОЧНО: своей]
- Нечёткое слово угадано как "зарегистрировано" → пиши ⚠️[НЕТОЧНО: зарегистрировано]
- Слово явно искажено печатью/сканом → пиши ⚠️[НЕТОЧНО: предположение]

Лучше поставить маркер лишний раз, чем пропустить реальную ошибку распознавания.`;

const PROMPT_PD = `Проанализируй текст юридического документа и найди все персональные данные.

Верни результат ТОЛЬКО в формате JSON (без markdown, без пояснений):
{
  "persons": [
    {
      "id": "уникальный_id",
      "fullName": "Иванов Иван Иванович",
      "role": "обвиняемый",
      "category": "private",
      "mentions": ["Иванов Иван Иванович", "Иванов И.И.", "Иванов"],
      "letter": "А"
    }
  ],
  "otherPD": [
    {
      "id": "уникальный_id",
      "type": "address",
      "label": "адрес",
      "value": "г. Москва, ул. Ленина, д. 5, кв. 12",
      "replacement": "[адрес]"
    }
  ]
}

КАТЕГОРИИ для persons:
- "private" — обычные граждане (обвиняемые, потерпевшие, свидетели, истцы, ответчики)
- "professional" — профессиональные участники процесса (судьи, следователи, прокуроры, адвокаты, секретари, участковые, нотариусы)

ТИПЫ для otherPD: address, phone, passport, inn, snils, card, email, dob, other

ПРАВИЛА:
- Буквы для private назначай по алфавиту: А, Б, В, Г, Д... (один человек = одна буква навсегда)
- Для professional поле letter оставь пустым ""
- Один человек = одна запись, все его упоминания в mentions[]
- Не включай названия организаций и учреждений
- Вернуть ТОЛЬКО JSON

Текст документа:
`;

const PROMPT_SPELL = `Ты анализируешь текст юридического документа, полученный через OCR (автоматическое распознавание текста с изображения).

При OCR система видит размытые или нечёткие буквы и заменяет слово на похожее существующее — но семантически или грамматически неподходящее. Твоя задача: найти такие места.

КРИТЕРИИ для пометки (достаточно одного):

1. ГРАММАТИЧЕСКОЕ НЕСОГЛАСОВАНИЕ — слово не согласуется с соседними по падежу, роду, числу, управлению:
   - "в интересах субъект дочери" → "субъект" стоит в именительном падеже там, где нужен родительный ("своей")
   - "рассмотрев годла материалы" → "годла" не является формой никакого слова
   - "поступило заявление от сувоей" → "сувоей" не существует, но похоже на "своей"

2. СЕМАНТИЧЕСКАЯ НЕСОВМЕСТИМОСТЬ — слово существует, но абсурдно в данном контексте:
   - "в период времени с горла по 09.02.2026" → "горла" вместо даты
   - "обвиняемый проживает по адресу: столица" → "столица" вместо конкретного адреса

3. НАРУШЕНИЕ ЮРИДИЧЕСКОГО ШАБЛОНА — в типовой фразе стоит неподходящее слово:
   - "руководствуясь статьёй кошка УПК РФ" → "кошка" вместо номера статьи
   - "ПОСТАНОВИЛ: отказать в возбуждении утюга дела" → "утюга" вместо "уголовного"

4. СЛОВО-ПРИЗРАК — OCR-артефакт в виде существующего слова:
   - "в интересах субъект дочери" → "субъект" здесь — артефакт вместо "своей"
   - "период времени с 24.12.2025 годла по" → "годла" — явный артефакт

НЕ ПОМЕЧАЙ: имена, аббревиатуры (УПК, МВД, ОП, КУСП), номера статей, даты, суммы, слова уместные по смыслу.

Верни ТОЛЬКО JSON без markdown:
{
  "suspicious": [
    {
      "word": "точное слово из текста как оно написано",
      "context": "5-7 слов вокруг для точной идентификации места",
      "reason": "краткое объяснение почему это OCR-ошибка"
    }
  ]
}

Если подозрительных мест нет — верни: {"suspicious": []}

Текст документа:
`;

// ── Universal API caller ───────────────────────────────────────────────────────
async function callApi(messages, apiKey, system, provider = 'claude') {
  if (provider === 'openai') return callOpenAI(messages, apiKey, system);
  if (provider === 'gemini') return callGemini(messages, apiKey, system);
  return callClaude(messages, apiKey, system);
}

async function callClaude(messages, apiKey, system) {
  const body = { model: PROVIDERS.claude.model, max_tokens: 4096, messages };
  if (system) body.system = system;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Ошибка Claude API: ' + resp.status);
  }
  const data = await resp.json();
  return data.content[0].text;
}

async function callOpenAI(messages, apiKey, system) {
  // Convert messages to OpenAI format
  const oaiMessages = [];
  if (system) oaiMessages.push({ role: 'system', content: system });
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      // Has image
      const parts = msg.content.map(c => {
        if (c.type === 'image') {
          return {
            type: 'image_url',
            image_url: { url: 'data:' + c.source.media_type + ';base64,' + c.source.data },
          };
        }
        return { type: 'text', text: c.text };
      });
      oaiMessages.push({ role: msg.role, content: parts });
    } else {
      oaiMessages.push({ role: msg.role, content: msg.content });
    }
  }
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify({ model: PROVIDERS.openai.model, max_tokens: 4096, messages: oaiMessages }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Ошибка OpenAI API: ' + resp.status);
  }
  const data = await resp.json();
  return data.choices[0].message.content;
}

async function callGemini(messages, apiKey, system) {
  // Convert messages to Gemini format
  const parts = [];
  if (system) parts.push({ text: system + '\n\n' });
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c.type === 'image') {
          parts.push({ inlineData: { mimeType: c.source.media_type, data: c.source.data } });
        } else if (c.type === 'text') {
          parts.push({ text: c.text });
        }
      }
    } else {
      parts.push({ text: msg.content });
    }
  }
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    PROVIDERS.gemini.model + ':generateContent?key=' + apiKey;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(
      (err.error?.message) || 'Ошибка Gemini API: ' + resp.status
    );
  }
  const data = await resp.json();
  return data.candidates[0].content.parts[0].text;
}

// ── Image compression ──────────────────────────────────────────────────────────
async function compressImage(base64, mediaType) {
  const sizeKb = (base64.length * 3) / 4 / 1024;
  if (sizeKb <= 3800) return { base64, mediaType: mediaType || 'image/jpeg' };
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 2400;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve({ base64: canvas.toDataURL('image/jpeg', 0.80).split(',')[1], mediaType: 'image/jpeg' });
    };
    img.src = 'data:' + (mediaType || 'image/jpeg') + ';base64,' + base64;
  });
}

// ── Main recognition ───────────────────────────────────────────────────────────
export async function recognizeDocument(images, apiKey, provider, onProgress) {
  const texts = [];
  for (let i = 0; i < images.length; i++) {
    onProgress({
      stage: 'ocr', current: i + 1, total: images.length,
      message: 'Распознавание страницы ' + (i + 1) + ' из ' + images.length + '...',
    });
    const { base64, mediaType } = await compressImage(images[i].base64, images[i].mediaType);
    const text = await callApi([{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'Распознай текст этого юридического документа.' },
      ],
    }], apiKey, SYS_OCR, provider);
    texts.push(text);
  }
  const fullText = texts.join('\n\n---\n\n');
  return await analyzePD(fullText, apiKey, provider, onProgress);
}

export async function analyzePastedText(text, apiKey, provider, onProgress) {
  return await analyzePD(text, apiKey, provider, onProgress);
}

async function analyzePD(fullText, apiKey, provider, onProgress) {
  onProgress({ stage: 'analysis', current: 0, total: 1, message: 'Анализ персональных данных...' });
  let personalData = { persons: [], otherPD: [] };
  try {
    const textForPD = fullText.length > 8000 ? fullText.slice(0, 8000) + '\n...' : fullText;
    const pdRaw = await callApi(
      [{ role: 'user', content: PROMPT_PD + textForPD }],
      apiKey, null, provider
    );
    const m = pdRaw.match(/\{[\s\S]*\}/);
    if (m) personalData = JSON.parse(m[0]);
  } catch (e) {
    console.warn('PD parse error', e);
  }

  onProgress({ stage: 'analysis', current: 0, total: 1, message: 'Проверка качества распознавания...' });
  let annotatedText = fullText;
  try {
    const textForSpell = fullText.length > 6000 ? fullText.slice(0, 6000) + '\n...' : fullText;
    const spellRaw = await callApi(
      [{ role: 'user', content: PROMPT_SPELL + textForSpell }],
      apiKey, null, provider
    );
    const m2 = spellRaw.match(/\{[\s\S]*\}/);
    if (m2) {
      const { suspicious = [] } = JSON.parse(m2[0]);
      for (const item of suspicious) {
        if (!item.word || item.word.length < 2) continue;
        const escaped = item.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('\\b' + escaped + '\\b', 'g');
        annotatedText = annotatedText.replace(re, (match) => {
          if (annotatedText.includes('\u26a0\ufe0f[НЕТОЧНО: ' + match + ']')) return match;
          return '\u26a0\ufe0f[НЕТОЧНО: ' + match + ']';
        });
      }
    }
  } catch (e) {
    console.warn('Spell/OCR check error', e);
  }

  onProgress({ stage: 'done', current: 1, total: 1, message: 'Готово!' });
  return { text: annotatedText, personalData };
}
