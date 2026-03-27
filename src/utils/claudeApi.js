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

// ── Промпт 1: OCR — только распознавание ─────────────────────────────────────
const SYS_OCR = `Ты — профессиональная система распознавания юридических документов на русском языке.

Твоя задача: ТОЧНО распознать текст с изображения. Только распознавание — никакого анализа.

ПРАВИЛА ФОРМАТИРОВАНИЯ:
1. Главное название документа (ПОСТАНОВЛЕНИЕ, РЕШЕНИЕ, ОПРЕДЕЛЕНИЕ и т.д.) стоящее по центру: ## НАЗВАНИЕ
2. Подзаголовок под названием (например "об отказе в возбуждении уголовного дела"): [CENTER]текст[/CENTER]
3. Важные разделы (ПОСТАНОВИЛ, УСТАНОВИЛ, РЕШИЛ, ОПРЕДЕЛИЛ и т.д.): **ТЕКСТ**
4. Строки где текст одновременно слева и справа (город слева, дата справа): [LEFTRIGHT: левый | правый]
   НЕ используй [LEFTRIGHT] для подписей, должностей и ФИО — они идут обычным текстом слева
5. Возвращай ТОЛЬКО текст документа. Без пояснений.

ПРАВИЛА РАСПОЗНАВАНИЯ:
- Воспроизводи текст максимально точно как написано в документе
- НЕ исправляй ошибки и опечатки — если в документе написано с ошибкой, воспроизводи как есть
- Если слово нечёткое, смазанное или плохо пропечатано: ⚠️[НЕТОЧНО: твой вариант]
- Если текст совсем нечитаем: ⚠️[НЕЧИТАЕМО]
- Если не уверен — лучше поставь маркер, чем пропустить

ПРИМЕР правильного форматирования:
## ПОСТАНОВЛЕНИЕ
[CENTER]об отказе в возбуждении уголовного дела[/CENTER]
[LEFTRIGHT: г. Самара | «12» марта 2026 года.]
**УСТАНОВИЛ:**
**ПОСТАНОВИЛ:**`;

// ── Промпт 2: Проверка качества — только семантика ───────────────────────────
const PROMPT_QUALITY = `Ты — опытный редактор юридических документов на русском языке.

Тебе дан текст полученный через OCR (автоматическое распознавание с изображения). OCR иногда ошибается: заменяет слова на похожие, пропускает слова, искажает буквы.

Твоя задача: найти места где OCR явно ошибся. Не исправляй — только добавляй маркер ⚠️[НЕТОЧНО: слово].

ИЩИ ТРИ ТИПА ОШИБОК:

1. ГРАММАТИЧЕСКАЯ НЕВОЗМОЖНОСТЬ — фраза грамматически неправильная:
   - "В изучения материала" → предлог "в" не сочетается с "изучения" (родит. падеж), скорее всего пропущено слово → ⚠️[НЕТОЧНО: изучения]
   - "поступило заявление от сувоей дочери" → "сувоей" не существует → ⚠️[НЕТОЧНО: сувоей]
   - "она просит дальнейшую проверку прекратить, не возбуждать" → грамматически не связано → пометить подозрительное слово

2. ЛОГИЧЕСКОЕ НЕСООТВЕТСТВИЕ — слово противоречит смыслу предложения или контексту:
   - "В настоящее время проверки она имеет" в контексте "просит прекратить проверку, уголовного дела не возбуждать" → "проверки" вместо "претензий" и "имеет" без отрицания → ⚠️[НЕТОЧНО: проверки] и ⚠️[НЕТОЧНО: имеет]
   - "в интересах супруги дочери" → "супруги" неуместно рядом с "дочери" → ⚠️[НЕТОЧНО: супруги]
   - "могла похитить с банковской карты, оформленный на имя" → "оформленный" не согласуется с "карты" → ⚠️[НЕТОЧНО: оформленный]

3. НАРУШЕНИЕ ЮРИДИЧЕСКОГО ШАБЛОНА — в типовой юридической фразе стоит неподходящее слово:
   - "отказать в возбуждении утюга дела" → "утюга" вместо "уголовного" → ⚠️[НЕТОЧНО: утюга]
   - "руководствуясь статьёй кошка УПК" → "кошка" вместо номера статьи → ⚠️[НЕТОЧНО: кошка]

НЕ ПОМЕЧАЙ:
- Имена, фамилии, отчества людей
- Аббревиатуры (УПК, МВД, ОП, КУСП, РФ и т.д.)
- Числа, даты, суммы денег
- Фразы которые грамматически и логически корректны
- Слова уже помеченные маркером ⚠️[НЕТОЧНО: ...]

Верни полный текст с добавленными маркерами там где нашёл ошибки.
Если ошибок нет — верни текст без изменений.
Не добавляй никаких пояснений — только текст.

Текст для проверки:
`;

// ── Промпт 3: Анализ персональных данных ─────────────────────────────────────
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
- "professional" — профессиональные участники (судьи, следователи, прокуроры, адвокаты, нотариусы)

ТИПЫ для otherPD: address, phone, passport, inn, snils, card, email, dob, other

ПРАВИЛА:
- Для professional поле letter оставь пустым ""
- Один человек = одна запись, все упоминания в mentions[]
- Не включай названия организаций
- Вернуть ТОЛЬКО JSON

ПРАВИЛО ДЛЯ replacement (очень важно!):
Поле replacement НЕ должно дублировать смысл предшествующего слова в тексте.
Примеры:
- "проживающей по адресу: г. Самара..." → value="по адресу: г. Самара...", replacement="[адрес]" (убираем "по адресу:", заменяем на просто метку)
- "дата рождения: 08.03.1994 г.р." → value="08.03.1994 г.р.", replacement="[дата рождения]"
- "телефон: +7 999 123-45-67" → value="+7 999 123-45-67", replacement="[телефон]"
То есть: если перед значением в тексте уже стоит поясняющее слово ("адресу", "телефон" и т.д.) — в replacement пиши просто метку без повтора этого слова.

Текст документа:
`;

// ── Universal API caller ───────────────────────────────────────────────────────
async function callApi(messages, apiKey, system, provider) {
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
  const oaiMessages = [];
  if (system) oaiMessages.push({ role: 'system', content: system });
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      const parts = msg.content.map(c => {
        if (c.type === 'image') {
          return { type: 'image_url', image_url: { url: 'data:' + c.source.media_type + ';base64,' + c.source.data } };
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
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
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
    throw new Error(err.error?.message || 'Ошибка Gemini API: ' + resp.status);
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

// ── Шаг 1: OCR всех страниц ───────────────────────────────────────────────────
export async function recognizeDocument(images, apiKey, provider, onProgress) {
  const texts = [];
  const total = images.length;

  for (let i = 0; i < total; i++) {
    const pctStart = Math.round((i / total) * 55);
    onProgress({
      stage: 'ocr',
      current: i + 1,
      total,
      percent: pctStart,
      message: 'Распознавание страницы ' + (i + 1) + ' из ' + total + '...',
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

    onProgress({
      stage: 'ocr',
      current: i + 1,
      total,
      percent: Math.round(((i + 1) / total) * 55),
      message: 'Страница ' + (i + 1) + ' из ' + total + ' готова',
    });
  }

  const fullText = texts.join('\n\n');

  // Шаг 2: Проверка качества
  onProgress({ stage: 'quality', percent: 58, message: 'Проверка качества распознавания...' });
  const checkedText = await runQualityCheck(fullText, apiKey, provider, onProgress);

  // Шаг 3: Анализ ПД
  onProgress({ stage: 'analysis', percent: 75, message: 'Анализ персональных данных...' });
  const personalData = await analyzePD(checkedText, apiKey, provider, onProgress);

  onProgress({ stage: 'done', percent: 100, message: 'Готово!' });
  return { text: checkedText, personalData };
}

export async function analyzePastedText(text, apiKey, provider, onProgress) {
  onProgress({ stage: 'quality', percent: 15, message: 'Проверка качества текста...' });
  const checkedText = await runQualityCheck(text, apiKey, provider, onProgress);

  onProgress({ stage: 'analysis', percent: 55, message: 'Анализ персональных данных...' });
  const personalData = await analyzePD(checkedText, apiKey, provider, onProgress);

  onProgress({ stage: 'done', percent: 100, message: 'Готово!' });
  return { text: checkedText, personalData };
}

// ── Шаг 2: Проверка качества (отдельный запрос) ───────────────────────────────
async function runQualityCheck(fullText, apiKey, provider, onProgress) {
  try {
    const textForCheck = fullText.length > 7000 ? fullText.slice(0, 7000) + '\n...' : fullText;
    const checked = await callApi(
      [{ role: 'user', content: PROMPT_QUALITY + textForCheck }],
      apiKey, null, provider
    );
    // If model returned something reasonable (not empty, not error message)
    if (checked && checked.length > 50) {
      return checked;
    }
  } catch (e) {
    console.warn('Quality check error:', e);
  }
  return fullText; // fallback to original if check fails
}

// ── Шаг 3: Анализ персональных данных ────────────────────────────────────────
async function analyzePD(fullText, apiKey, provider, onProgress) {
  let personalData = { persons: [], otherPD: [] };
  try {
    const textForPD = fullText.length > 8000 ? fullText.slice(0, 8000) + '\n...' : fullText;
    onProgress({ stage: 'analysis', percent: 82, message: 'Поиск персональных данных...' });
    const pdRaw = await callApi(
      [{ role: 'user', content: PROMPT_PD + textForPD }],
      apiKey, null, provider
    );
    const m = pdRaw.match(/\{[\s\S]*\}/);
    if (m) personalData = JSON.parse(m[0]);
  } catch (e) {
    console.warn('PD parse error', e);
  }
  onProgress({ stage: 'analysis', percent: 97, message: 'Финализация...' });
  return personalData;
}
