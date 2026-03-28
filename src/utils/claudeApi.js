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
5. Нумерованные и маркированные списки — воспроизводи точно как в документе, сохраняя номера и отступы
6. Таблицы — передавай построчно в виде обычного текста, ячейки разделяй через " | "
7. Возвращай ТОЛЬКО текст документа. Без пояснений.

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

Твоя задача: найти места где OCR явно ошибся и добавить маркер с предложением исправления.

ФОРМАТ МАРКЕРА:
- Если знаешь правильный вариант: ⚠️[НЕТОЧНО: ошибочное_слово | правильный_вариант]
- Если не уверен в правильном варианте: ⚠️[НЕТОЧНО: ошибочное_слово]

ИЩИ ТРИ ТИПА ОШИБОК:

1. ГРАММАТИЧЕСКАЯ НЕВОЗМОЖНОСТЬ — фраза грамматически неправильная:
   - "поступило заявление от сувоей дочери" → "сувоей" не существует → ⚠️[НЕТОЧНО: сувоей | своей]
   - "оформленный на имя карты" → не согласуется → ⚠️[НЕТОЧНО: оформленный | оформленной]

2. ЛОГИЧЕСКОЕ НЕСООТВЕТСТВИЕ — слово противоречит смыслу или контексту:
   - "в интересах супруги дочери" → "супруги" неуместно → ⚠️[НЕТОЧНО: супруги | судебной]
   - "могла похитить с банковской карты, оформленный на имя" → ⚠️[НЕТОЧНО: оформленный | оформленной]

3. НАРУШЕНИЕ ЮРИДИЧЕСКОГО ШАБЛОНА — в типовой юридической фразе неподходящее слово:
   - "отказать в возбуждении утюга дела" → ⚠️[НЕТОЧНО: утюга | уголовного]
   - "руководствуясь статьёй кошка УПК" → ⚠️[НЕТОЧНО: кошка]

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

Верни результат ТОЛЬКО в формате JSON (без markdown, без \`\`\`, без пояснений):
{
  "persons": [
    {
      "id": "уникальный_id",
      "fullName": "Иванов Иван Иванович",
      "role": "обвиняемый",
      "category": "private",
      "mentions": ["Иванов Иван Иванович", "Иванов И.И.", "Иванов", "И.И."]
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

ТИПЫ для otherPD: address, phone, passport, inn, snils, card, email, dob, birthplace, social_id, other
- card — номер банковской карты, номер банковского счёта (например "40817 810 8 00491338639"), реквизиты счёта
- birthplace — место рождения (город, регион, страна рождения)
- social_id — идентификатор пользователя в мессенджере или соцсети: числовой ID (id1942346643), username (@marvihram), никнейм/псевдоним аккаунта по которому можно идентифицировать человека

ПРАВИЛА:
- Поле letter НЕ нужно — оно не используется
- Один человек = одна запись, все упоминания в mentions[]
- В mentions[] включай ВСЕ варианты упоминания человека: полное имя, фамилия+инициалы (например "Сергеев С.С."), только фамилия, только инициалы если они однозначно идентифицируют человека
- В mentions[] пиши фамилию ТОЛЬКО в именительном падеже (кто? что?) — систему сама найдёт все падежные формы. Например: если в тексте «Завгородней» — в mentions[] пиши «Завгородняя»
- Не включай названия организаций
- НЕ включай процессуальные роли и должности как персональные данные (подсудимый, потерпевший, свидетель, обвиняемый, истец, ответчик, судья, прокурор и подобные) — они не являются ПД
- НЕ включай описания родственных связей без имени (двоюродный брат, жена подсудимого, мать и т.п.) — они не являются ПД
- НЕ включай место вынесения приговора/решения/постановления как адрес (например «г. Самара» в строке «г. Самара    22 ноября 2021 года» — это место суда, а не адрес человека). Адрес человека всегда идёт после слов «проживает», «зарегистрирован», «по адресу» и содержит улицу, дом, квартиру
- НЕ включай адреса организаций, банков, судов, учреждений — только адреса конкретных физических лиц
- Тип birthplace (место рождения) — ТОЛЬКО если в тексте явно написано «родился в», «родилась в», «уроженец», «уроженка», «место рождения». Просто упоминание города в другом контексте — НЕ является местом рождения
- Вернуть ТОЛЬКО JSON

ПРАВИЛА ДЛЯ АДРЕСОВ (очень важно!):
Адрес является персональными данными ТОЛЬКО если содержит улицу и/или номер дома.
Просто город ("г. Самара"), регион ("Самарская область") или район без улицы — НЕ ПД, не включай.

Находи адреса включая:
- адрес регистрации ("зарегистрирован по адресу:", "зарегистрированного по адресу:")
- адрес проживания ("проживает по адресу:", "фактически проживающего по адресу:")
- место нахождения ("находится по адресу:")
Если у одного человека два адреса — это ДВЕ отдельные записи в otherPD.

Примеры:
- "зарегистрированного по адресу: г. Самара, ул. Дзержинского, 2-40" → value="г. Самара, ул. Дзержинского, 2-40", replacement="[адрес]" (есть улица — включаем)
- "уроженца г. Самара" → НЕ включать как адрес (просто город, нет улицы)
- "проживающего в г. Самара" → НЕ включать как адрес (просто город)
- "зарегистрирован: Самарская обл., Приволжский р-н, с. Общаровка, ул. Школьная, д. 20, кв. 5" → value="Самарская обл., Приволжский р-н, с. Общаровка, ул. Школьная, д. 20, кв. 5", replacement="[адрес]" (есть улица и дом — включаем)

ПРАВИЛО ДЛЯ replacement (очень важно!):
Поле replacement НЕ должно дублировать смысл предшествующего слова в тексте.
Примеры:
- "проживающей по адресу: г. Самара..." → value="г. Самара...", replacement="[адрес]"
- "зарегистрирован по адресу: г. Москва..." → value="г. Москва...", replacement="[адрес]"
- "дата рождения: 08.03.1994 г.р." → value="08.03.1994 г.р.", replacement="[дата рождения]"
- "телефон: +7 999 123-45-67" → value="+7 999 123-45-67", replacement="[телефон]"
- "родился в г. Мирный Архангельской обл." → value="г. Мирный Архангельской обл.", replacement="[место рождения]"
- "имеющий id 1194234643" → value="1194234643", replacement="[id пользователя]"
- "(id1942346643)" → value="id1942346643", replacement="[id пользователя]"
- "аккаунт \"Другой Укупник\" (@marvihram)" → value="@marvihram", replacement="[аккаунт]"
То есть: если перед значением в тексте уже стоит поясняющее слово ("адресу", "телефон", "родился" и т.д.) — value содержит только само значение, replacement — просто метку.

Текст документа:
`;

// ── Universal API caller ───────────────────────────────────────────────────────
async function callApi(messages, apiKey, system, provider) {
  if (provider === 'openai') return callOpenAI(messages, apiKey, system);
  if (provider === 'gemini') return callGemini(messages, apiKey, system);
  return callClaude(messages, apiKey, system);
}

async function callClaude(messages, apiKey, system) {
  const body = { model: PROVIDERS.claude.model, max_tokens: 64000, messages };
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
    body: JSON.stringify({ model: PROVIDERS.openai.model, max_tokens: 64000, messages: oaiMessages }),
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
// Убирает переносы слов через дефис которые OCR генерирует сам
function dehyphenate(text) {
  return text
    .replace(/([А-яЁёa-zA-Z])-\r?\n([а-яёa-z])/g, '$1$2')  // Са-\nмара → Самара
    .replace(/([А-яЁёa-zA-Z])- ([а-яёa-z])/g, '$1$2');       // Са- мара → Самара
}

export async function recognizeDocument(images, apiKey, provider, onProgress) {
  const texts = [];
  const total = images.length;

  // OCR: 0–75% (наибольший вес — самый долгий этап)
  for (let i = 0; i < total; i++) {
    const pctStart = Math.round((i / total) * 75);
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
      percent: Math.round(((i + 1) / total) * 75),
      message: 'Страница ' + (i + 1) + ' из ' + total + ' готова',
    });
  }

  // Умная склейка страниц:
  // 1. Убираем одиночные цифры (номера страниц) — строка содержит только цифру
  // 2. Если страница заканчивается без знака препинания — склеиваем без двойного переноса
  const cleanedTexts = texts.map(t => {
    // Убираем переносы слов через дефис которые OCR добавляет сам:
    // «Са-\nмарского» → «Самарского», «зарегистриро-\nванного» → «зарегистрированного»
    // Только строчная буква после переноса — дефисы в составных словах сохраняются
    const dehyphenated = dehyphenate(t)
    return dehyphenated.split('\n')
     .filter(line => !/^\s*\d{1,3}\s*$/.test(line)) // убираем строки с одной цифрой (номера страниц)
     .join('\n')
     .trim();
  });

  const fullText = cleanedTexts.reduce((acc, page, i) => {
    if (i === 0) return page;
    const prevEnds = acc.trimEnd();
    const lastChar = prevEnds.slice(-1);
    // Если предыдущая страница заканчивается на букву/цифру — склеиваем без пустой строки
    const textSep = /[а-яёА-ЯЁa-zA-Z0-9]/.test(lastChar) ? '\n' : '\n\n';
    // Разделитель страниц — специальный маркер с номером следующей страницы
    const pageMarker = '\n[PAGE:' + (i + 1) + ']\n';
    return prevEnds + pageMarker + page;
  }, '');

  // Шаг 2: Проверка качества — 75–87%
  onProgress({ stage: 'quality', percent: 76, message: 'Начало проверки качества...' });
  const checkedText = await runQualityCheck(fullText, apiKey, provider, onProgress);

  // Шаг 3: Анализ ПД — 87–100%
  onProgress({ stage: 'analysis', percent: 88, message: 'Анализ персональных данных...' });
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
  // Разбиваем текст на страницы по [PAGE:N] маркерам
  // Проверяем каждую страницу отдельно — так прогресс обновляется равномерно
  const parts = fullText.split(/(\[PAGE:\d+\])/);
  // parts = [текст стр.1, '[PAGE:2]', текст стр.2, '[PAGE:3]', текст стр.3, ...]

  // Собираем страницы: { marker, text }
  const pages = [];
  let currentText = '';
  let currentMarker = null;
  for (const part of parts) {
    if (/^\[PAGE:\d+\]$/.test(part)) {
      pages.push({ marker: currentMarker, text: currentText });
      currentText = '';
      currentMarker = part;
    } else {
      currentText += part;
    }
  }
  pages.push({ marker: currentMarker, text: currentText });
  // pages[0] = { marker: null, text: 'текст страницы 1' }
  // pages[1] = { marker: '[PAGE:2]', text: 'текст страницы 2' }

  const total = pages.length;

  // Если страница одна — один запрос без разбивки
  if (total <= 1) {
    try {
      const textForCheck = fullText.replace(/\[PAGE:\d+\]/g, '');
      const checked = await callApi(
        [{ role: 'user', content: PROMPT_QUALITY + textForCheck }],
        apiKey, null, provider
      );
      if (checked && checked.length > 50) return dehyphenate(checked);
    } catch (e) { console.warn('Quality check error:', e); }
    return fullText;
  }

  // Проверяем постранично — quality check для каждой страницы отдельно
  const checkedParts = [];
  for (let i = 0; i < total; i++) {
    const { marker, text } = pages[i];
    const pageText = text.trim();
    // Прогресс: quality check занимает 75–87%, делим равномерно по страницам
    const pct = Math.round(75 + ((i + 1) / total) * 12);
    onProgress({
      stage: 'quality',
      percent: pct,
      message: total > 1
        ? 'Проверка качества: страница ' + (i + 1) + ' из ' + total + '...'
        : 'Проверка качества распознавания...',
    });

    if (!pageText) {
      checkedParts.push((marker ? '\n' + marker + '\n' : '') + text);
      continue;
    }

    try {
      const checked = await callApi(
        [{ role: 'user', content: PROMPT_QUALITY + pageText }],
        apiKey, null, provider
      );
      const result = dehyphenate((checked && checked.length > 30) ? checked : pageText);
      checkedParts.push((marker ? '\n' + marker + '\n' : '') + result);
    } catch (e) {
      console.warn('Quality check error page ' + (i + 1) + ':', e);
      checkedParts.push((marker ? '\n' + marker + '\n' : '') + pageText);
    }
  }

  return checkedParts.join('');
}

// ── Шаг 3: Анализ персональных данных ────────────────────────────────────────
async function analyzePD(fullText, apiKey, provider, onProgress) {
  let personalData = { persons: [], otherPD: [] };
  try {
    const cleanForPD = fullText.replace(/\[PAGE:\d+\]/g, '');
    const textForPD = cleanForPD.length > 25000 ? cleanForPD.slice(0, 25000) + '\n...' : cleanForPD;
    onProgress({ stage: 'analysis', percent: 91, message: 'Поиск персональных данных...' });
    const pdRaw = await callApi(
      [{ role: 'user', content: PROMPT_PD + textForPD }],
      apiKey, null, provider
    );
    // Убираем code-fence если модель обернула JSON в ```json...```
    const pdClean = pdRaw.replace(/^```[\w]*\n?/m, '').replace(/```\s*$/m, '').trim();
    const m = pdClean.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      // Фильтруем некорректные записи otherPD на уровне кода:
      // Адрес без улицы — не ПД (просто город/регион)
      // Место рождения без явного указания (просто город) — не ПД
      if (parsed.otherPD) {
        parsed.otherPD = parsed.otherPD.filter(item => {
          if (item.type === 'address') {
            // Адрес должен содержать улицу: ул., пр., пер., д., кв., проспект и т.д.
            const hasStreet = /ул\.?|пр\.?|пер\.?|пр-т|бульв|шоссе|д\.\s*\d|кв\.\s*\d|проспект|переулок|улица/i.test(item.value || '');
            return hasStreet;
          }
          if (item.type === 'birthplace') {
            // Место рождения должно быть явно указано — не просто город
            // Если value это просто "г. Самара" или "Москва" — фильтруем
            const val = (item.value || '').trim();
            const isJustCity = /^(г\.?\s*)?[А-ЯЁ][а-яё]+(-[А-ЯЁ][а-яё]+)?(\s+(обл|область|края|край|респ|республика)\.?)?$/i.test(val);
            return !isJustCity;
          }
          return true;
        });
      }
      personalData = parsed;
    }
  } catch (e) {
    console.warn('PD parse error', e);
  }
  onProgress({ stage: 'analysis', percent: 97, message: 'Финализация...' });
  return personalData;
}
