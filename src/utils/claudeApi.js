import { callApi } from './claudeApiClient';
import {
  PD_ANALYSIS_CHAR_LIMIT,
  PROMPT_PD,
  SYS_OCR,
} from './claudeApiConfig';
import { compressImage, dehyphenate } from './claudeApiImage';
import { runQualityCheck } from './claudeApiQuality';

export { PD_ANALYSIS_CHAR_LIMIT, PROVIDERS } from './claudeApiConfig';

function stripPageMarkers(text) {
  return text.replace(/\[PAGE:\d+\]/g, '');
}

function cleanOcrPages(texts) {
  return texts.map((text) => {
    const dehyphenated = dehyphenate(text);
    return dehyphenated
      .split('\n')
      .filter((line) => !/^\s*\d{1,3}\s*$/.test(line))
      .join('\n')
      .trim();
  });
}

function mergeRecognizedPages(cleanedTexts, images) {
  return cleanedTexts
    .map((pageText, index) => `[PAGE:${images[index]?.pageNum || index + 1}]\n${pageText}`)
    .join('\n');
}

function buildExistingPdPrompt(existingPD) {
  if (!existingPD || ((!existingPD.persons || existingPD.persons.length === 0) && (!existingPD.otherPD || existingPD.otherPD.length === 0))) {
    return `${PROMPT_PD}\n`;
  }

  const existingJson = JSON.stringify({
    persons: (existingPD.persons || []).map((person) => ({
      id: person.id,
      fullName: person.fullName,
      role: person.role,
      category: person.category,
      mentions: person.mentions,
    })),
    otherPD: (existingPD.otherPD || []).map((item) => ({
      id: item.id,
      type: item.type,
      value: item.value,
      replacement: item.replacement,
    })),
  }, null, 2);

  return `${PROMPT_PD}

ВАЖНО — СУЩЕСТВУЮЩАЯ БАЗА ПЕРСОНАЛЬНЫХ ДАННЫХ:
Этот документ является продолжением ранее обработанного. Вот уже известные персональные данные:
${existingJson}

Правила работы с существующей базой:

Persons (лица):
- Если в новом тексте встречается человек из существующей базы (совпадает fullName или одно из mentions) — используй его СУЩЕСТВУЮЩИЙ id. Добавь новые mentions если нашлись новые варианты написания. НЕ создавай для него новую запись
- Если в новом тексте встречается новый человек, которого НЕТ в существующей базе — создай для него НОВУЮ запись с новым уникальным id

OtherPD (адреса, телефоны, паспорта, даты рождения и т.д.):
- Если в новом тексте встречается ПД, совпадающее по value (или очень близкое — тот же адрес, тот же номер телефона, тот же паспорт) с записью из существующей базы — используй СУЩЕСТВУЮЩИЙ id, НЕ создавай дубликат
- Если в новом тексте встречается новое ПД, которого НЕТ в существующей базе (новый адрес, новый номер телефона, новый паспорт и т.д.) — создай для него НОВУЮ запись с новым id
- Типы otherPD, которые нужно проверять на совпадение: address, phone, passport, zagranpassport, inn, snils, card, email, dob, birthplace, social_id, vehicle_plate, vehicle_vin, driver_license, military_id, oms_policy, birth_certificate, imei, org_link

В результирующем JSON верни ТОЛЬКО НОВЫЕ записи (которых нет в существующей базе) и ОБНОВЛЁННЫЕ существующие записи (с добавленными mentions для persons). Не включай неизменённые записи из существующей базы.

Текст документа:
`;
}

function normalizeAmbiguousMentions(parsed) {
  if (!parsed.ambiguousPersons?.length || !parsed.persons?.length) {
    return parsed;
  }

  const ambiguousValues = new Set(
    parsed.ambiguousPersons
      .map((item) => (item?.value || '').trim().toLowerCase())
      .filter(Boolean),
  );

  if (ambiguousValues.size === 0) {
    return parsed;
  }

  return {
    ...parsed,
    persons: parsed.persons.map((person) => ({
      ...person,
      mentions: (person.mentions || []).filter((mention) => !ambiguousValues.has((mention || '').trim().toLowerCase())),
    })),
  };
}

function hasAddressDetail(value) {
  return /ул\.?|пр\.?|пер\.?|пр-т|б-р|бульв|шоссе|наб\.?|пл\.?|д\.\s*\d|дом\s*\d|кв\.\s*\d|квартира\s*\d|проспект|переулок|улица|бульвар|набережная|площадь|тупик|проезд|тер\.?|территори(?:я|и)|снт|днт|тсн|сад\b|коллективный\s+сад|участ(?:ок|ка)\b|владен(?:ие|ия)\b|домовладен(?:ие|ия)\b|\d+[-/]\d+/.test(value || '');
}

function isGenericBirthplace(value) {
  const normalized = (value || '').trim();
  return /^(г\.?\s*)?[А-ЯЁ][а-яё]+(-[А-ЯЁ][а-яё]+)?(\s+(обл|область|края|край|респ|республика)\.?)?$/i.test(normalized);
}

function filterOtherPd(items = []) {
  return items.filter((item) => {
    if (item.type === 'address') {
      return hasAddressDetail(item.value || '');
    }
    if (item.type === 'birthplace') {
      return !isGenericBirthplace(item.value || '');
    }
    return true;
  });
}

function parsePdResponse(pdRaw) {
  const cleaned = pdRaw.replace(/^```[\w]*\n?/m, '').replace(/```\s*$/m, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  const parsed = normalizeAmbiguousMentions(JSON.parse(match[0]));
  if (parsed.otherPD) {
    parsed.otherPD = filterOtherPd(parsed.otherPD);
  }
  return parsed;
}

async function recognizePage({ image, index, total, apiKey, provider, onProgress }) {
  const percent = Math.round((index / total) * 75);
  onProgress({
    stage: 'ocr',
    current: index + 1,
    total,
    percent,
    message: total > 1
      ? `Распознавание страницы ${index + 1} из ${total}...`
      : 'Распознавание страницы...',
  });

  const { base64, mediaType, cropRect, cropped } = await compressImage(image.base64, image.mediaType);
  const actualPageNumber = image?.pageNum || index + 1;

  try {
    const text = await callApi([{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'Распознай текст этого юридического документа.' },
      ],
    }], apiKey, SYS_OCR, provider);

    onProgress({
      stage: 'ocr',
      current: index + 1,
      total,
      percent: Math.round(((index + 1) / total) * 75),
      message: total > 1 ? `Страница ${index + 1} из ${total} готова` : 'Страница готова',
    });

    return text;
  } catch (error) {
    console.error('OCR page request failed', {
      provider,
      pageIndexInBatch: index + 1,
      pageNumber: actualPageNumber,
      totalPagesInBatch: total,
      totalPagesInDocument: image?.totalPages || null,
      originalMediaType: image?.mediaType || null,
      sentMediaType: mediaType,
      originalBase64Length: image?.base64?.length || 0,
      compressedBase64Length: base64.length,
      cropped,
      cropRect,
      textSource: image?.textSource || null,
      renderWidth: image?.renderWidth || null,
      renderHeight: image?.renderHeight || null,
      errorMessage: error?.message || String(error),
    });
    throw error;
  }
}

export async function recognizeDocument(images, apiKey, provider, onProgress, existingPD) {
  const texts = [];
  const total = images.length;

  for (let index = 0; index < total; index += 1) {
    const text = await recognizePage({
      image: images[index],
      index,
      total,
      apiKey,
      provider,
      onProgress,
    });
    texts.push(text);
  }

  const fullText = mergeRecognizedPages(cleanOcrPages(texts), images);

  onProgress({ stage: 'quality', percent: 76, message: 'Проверка качества' });
  const checkedText = await runQualityCheck(fullText, apiKey, provider, onProgress);

  onProgress({ stage: 'analysis', percent: 88, message: 'Анализ персональных данных...' });
  const personalData = await analyzePD(checkedText, apiKey, provider, onProgress, existingPD);

  onProgress({ stage: 'done', percent: 100, message: 'Готово!' });
  return { text: checkedText, personalData };
}

export async function analyzePastedText(text, apiKey, provider, onProgress) {
  const plainText = text || '';
  onProgress({ stage: 'quality', percent: 15, message: 'Проверка качества текста...' });
  onProgress({ stage: 'analysis', percent: 55, message: 'Анализ персональных данных...' });
  const personalData = await analyzePD(plainText, apiKey, provider, onProgress);
  onProgress({ stage: 'done', percent: 100, message: 'Готово!' });
  return { text: plainText, personalData };
}

export async function analyzePD(fullText, apiKey, provider, onProgress, existingPD) {
  let personalData = { persons: [], otherPD: [], ambiguousPersons: [] };

  try {
    const cleanForPd = stripPageMarkers(fullText);
    const textForPd = cleanForPd.length > PD_ANALYSIS_CHAR_LIMIT
      ? `${cleanForPd.slice(0, PD_ANALYSIS_CHAR_LIMIT)}\n...`
      : cleanForPd;

    onProgress({ stage: 'analysis', percent: 91, message: 'Поиск персональных данных...' });

    const pdRaw = await callApi(
      [{ role: 'user', content: `${buildExistingPdPrompt(existingPD)}${textForPd}` }],
      apiKey,
      null,
      provider,
    );

    const parsed = parsePdResponse(pdRaw);
    if (parsed) {
      personalData = parsed;
    }
  } catch (error) {
    console.warn('PD parse error', error);
  }

  onProgress({ stage: 'analysis', percent: 97, message: 'Финализация...' });
  return personalData;
}
