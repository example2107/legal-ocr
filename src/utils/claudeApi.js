const MODEL = 'claude-sonnet-4-20250514';

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
5. Возвращай ТОЛЬКО текст документа. Никаких пояснений. Начинай сразу с текста.`;

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

async function callApi(messages, apiKey, system) {
  const body = { model: MODEL, max_tokens: 4096, messages };
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
    throw new Error(err.error?.message || `Ошибка API: ${resp.status}`);
  }
  const data = await resp.json();
  return data.content[0].text;
}

// Compress image to stay within API limits (~4MB base64)
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
      resolve({
        base64: canvas.toDataURL('image/jpeg', 0.80).split(',')[1],
        mediaType: 'image/jpeg',
      });
    };
    img.src = `data:${mediaType || 'image/jpeg'};base64,${base64}`;
  });
}

export async function recognizeDocument(images, apiKey, onProgress) {
  const texts = [];

  for (let i = 0; i < images.length; i++) {
    onProgress({
      stage: 'ocr',
      current: i + 1,
      total: images.length,
      message: `Распознавание страницы ${i + 1} из ${images.length}...`,
    });

    const { base64, mediaType } = await compressImage(images[i].base64, images[i].mediaType);

    const text = await callApi([{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'Распознай текст этого юридического документа.' },
      ],
    }], apiKey, SYS_OCR);

    texts.push(text);
  }

  const fullText = texts.join('\n\n---\n\n');
  return await analyzePD(fullText, apiKey, onProgress);
}

export async function analyzePastedText(text, apiKey, onProgress) {
  return await analyzePD(text, apiKey, onProgress);
}

const PROMPT_SPELL = `Ты анализируешь текст юридического документа, который был получен через OCR (автоматическое распознавание текста с изображения).

При OCR часто возникают ошибки: система может заменить неразборчивое слово на похожее существующее слово, но с другим смыслом. Например: "сувоей" → "судьёй", "зорегистрировано" → "зарегистрировано", "поотерпевшей" → "потерпевшей".

Твоя задача: найти места в тексте, где слово выглядит синтаксически или семантически неуместным в контексте предложения — как будто OCR ошибся и подставил не то слово.

ВАЖНО:
- НЕ исправляй слова — только находи подозрительные места
- НЕ отмечай имена собственные, аббревиатуры, юридические термины
- НЕ отмечай числа, даты, номера статей
- Отмечай только слова, которые явно не вписываются в контекст или выглядят как OCR-артефакт
- Если текст выглядит нормально — верни пустой список

Верни ТОЛЬКО JSON без markdown и пояснений:
{
  "suspicious": [
    {
      "word": "точное слово из текста как оно написано",
      "context": "3-5 слов вокруг для идентификации места",
      "reason": "почему подозрительно (1 предложение)"
    }
  ]
}

Если подозрительных мест нет — верни: {"suspicious": []}

Текст документа:
`;

async function analyzePD(fullText, apiKey, onProgress) {
  onProgress({ stage: 'analysis', current: 0, total: 1, message: 'Анализ персональных данных...' });

  let personalData = { persons: [], otherPD: [] };
  try {
    const textForPD = fullText.length > 8000 ? fullText.slice(0, 8000) + '\n...' : fullText;
    const pdRaw = await callApi(
      [{ role: 'user', content: PROMPT_PD + textForPD }],
      apiKey,
      null
    );
    const m = pdRaw.match(/\{[\s\S]*\}/);
    if (m) personalData = JSON.parse(m[0]);
  } catch (e) {
    console.warn('PD parse error', e);
  }

  // Spell / OCR-error detection pass
  onProgress({ stage: 'analysis', current: 0, total: 1, message: 'Проверка качества распознавания...' });
  let annotatedText = fullText;
  try {
    const textForSpell = fullText.length > 6000 ? fullText.slice(0, 6000) + '
...' : fullText;
    const spellRaw = await callApi(
      [{ role: 'user', content: PROMPT_SPELL + textForSpell }],
      apiKey,
      null
    );
    const m2 = spellRaw.match(/\{[\s\S]*\}/);
    if (m2) {
      const { suspicious = [] } = JSON.parse(m2[0]);
      for (const item of suspicious) {
        if (!item.word || item.word.length < 2) continue;
        // Escape special regex chars
        const escaped = item.word.replace(/[.*+?^${}()|[\]\]/g, '\$&');
        // Match whole word, not already inside a ⚠️ marker
        const re = new RegExp(`(?<!⚠️\[НЕТОЧНО: [^\]]{0,200})\b${escaped}\b`, 'g');
        // Mark as uncertain — keep the word as-is, just flag it
        annotatedText = annotatedText.replace(re, (match) => {
          // Don't double-wrap
          return `⚠️[НЕТОЧНО: ${match}]`;
        });
      }
    }
  } catch (e) {
    console.warn('Spell/OCR check error', e);
  }

  onProgress({ stage: 'done', current: 1, total: 1, message: 'Готово!' });
  return { text: annotatedText, personalData };
}
