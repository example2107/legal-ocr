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

// ── Combined OCR + quality check prompt ───────────────────────────────────────
// Single pass: recognize text AND immediately flag uncertain words
const SYS_OCR = `Ты — профессиональная система распознавания юридических документов на русском языке.

Твоя задача: точно распознать текст с изображения И одновременно пометить все места где ты не уверен в точности распознавания.

ПРАВИЛА ФОРМАТИРОВАНИЯ:
1. Сохраняй точную структуру документа: заголовки, отступы, нумерацию, разделы
2. Используй markdown разметку:
   - Заголовки: ## Заголовок
   - Подзаголовки: ### Подзаголовок
   - Важные разделы (ПОСТАНОВИЛ, УСТАНОВИЛ, РЕШИЛ и т.д.): **ТЕКСТ**
3. Для строк где текст слева и справа (город слева, дата справа): [LEFTRIGHT: левый | правый]
4. Для визуально центрированных строк (подзаголовки): [CENTER]текст[/CENTER]
5. Возвращай ТОЛЬКО текст документа. Никаких пояснений.

МАРКИРОВКА НЕТОЧНОСТЕЙ — ⚠️[НЕТОЧНО: твой вариант]:
Ставь этот маркер в ДВУХ случаях:

СЛУЧАЙ 1 — ВИЗУАЛЬНАЯ НЕУВЕРЕННОСТЬ (слово размыто, смазано, нечётко):
- Буквы нечёткие, перечёркнутые, плохо пропечатаны
- Ты угадываешь по контексту, но в оригинале могло быть написано иначе
- Пример: видишь размытое слово → пишешь ⚠️[НЕТОЧНО: своей]

СЛУЧАЙ 2 — СЕМАНТИЧЕСКАЯ ПОДОЗРИТЕЛЬНОСТЬ (слово не вписывается в контекст):
Даже если слово написано чётко — если оно семантически или грамматически неуместно:
- "в интересах супруги дочери" → "супруги" неуместно рядом с "дочери" → ⚠️[НЕТОЧНО: супруги]
- "в настоящее время проверки она имеет" → "проверки" и "имеет" нарушают смысл → ⚠️[НЕТОЧНО: проверки]
- "рассмотрев годла материалы" → "годла" не существует → ⚠️[НЕТОЧНО: годла]
- "поступило заявление от субъект дочери" → "субъект" здесь артефакт OCR → ⚠️[НЕТОЧНО: субъект]

ПРИМЕРЫ ПРАВИЛЬНОЙ РАБОТЫ:
✓ Размытое слово "сувоей" распознано как "своей" → пиши ⚠️[НЕТОЧНО: своей]
✓ Чёткое слово "проверки" стоит там где должно быть "претензий" → ⚠️[НЕТОЧНО: проверки]
✓ "судьёй дочери" вместо ожидаемого "своей дочери" → ⚠️[НЕТОЧНО: судьёй]
✗ "рассмотрев материалы проверки сообщения о преступлении" → всё логично, не помечать
✗ Имена, фамилии, аббревиатуры (УПК, МВД, КУСП) — не помечать
✗ Числа, даты, суммы — не помечать если выглядят реалистично

Если совсем нечитаемо: ⚠️[НЕЧИТАЕМО]
Лучше пометить лишний раз, чем пропустить реальную ошибку.`;

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

// ── Main recognition — OCR + quality check in single pass ─────────────────────
export async function recognizeDocument(images, apiKey, provider, onProgress) {
  const texts = [];
  const total = images.length;

  for (let i = 0; i < total; i++) {
    // Progress: OCR phase = 0-70%, split evenly across pages
    const pctStart = Math.round((i / total) * 70);
    const pctEnd = Math.round(((i + 1) / total) * 70);
    onProgress({
      stage: 'ocr',
      current: i + 1,
      total,
      percent: pctStart,
      message: 'Распознавание страницы ' + (i + 1) + ' из ' + total + '...',
    });

    const { base64, mediaType } = await compressImage(images[i].base64, images[i].mediaType);

    // Single combined OCR + quality check call
    const text = await callApi([{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'Распознай текст этого юридического документа, помечая все неточности.' },
      ],
    }], apiKey, SYS_OCR, provider);

    texts.push(text);

    onProgress({
      stage: 'ocr',
      current: i + 1,
      total,
      percent: pctEnd,
      message: 'Страница ' + (i + 1) + ' из ' + total + ' готова',
    });
  }

  const fullText = texts.join('\n\n');

  // PD analysis = 70-100%
  onProgress({ stage: 'analysis', percent: 72, message: 'Анализ персональных данных...' });
  const personalData = await analyzePD(fullText, apiKey, provider, onProgress);

  onProgress({ stage: 'done', percent: 100, message: 'Готово!' });
  return { text: fullText, personalData };
}

export async function analyzePastedText(text, apiKey, provider, onProgress) {
  onProgress({ stage: 'analysis', percent: 20, message: 'Анализ персональных данных...' });
  const personalData = await analyzePD(text, apiKey, provider, onProgress);
  onProgress({ stage: 'done', percent: 100, message: 'Готово!' });
  return { text, personalData };
}

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
