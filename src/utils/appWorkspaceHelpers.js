import { PD_ANALYSIS_CHAR_LIMIT } from './claudeApi';
import { formatProjectChunkPageRange, getProjectPdfChunkEnd } from './projectBatch';

export const ALPHA_PRIVATE = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЭЮЯ'.split('').map((letter) => `${letter}.`);

export const OTHER_PD_TYPES_MAP = {
  address: 'адрес',
  phone: 'телефон',
  passport: 'паспорт',
  zagranpassport: 'загранпаспорт',
  inn: 'ИНН',
  snils: 'СНИЛС',
  card: 'карта',
  email: 'email',
  dob: 'дата рождения',
  birthplace: 'место рождения',
  vehicle_plate: 'номер авто',
  vehicle_vin: 'VIN',
  driver_license: 'вод. удостоверение',
  military_id: 'военный билет',
  oms_policy: 'полис ОМС',
  birth_certificate: 'свид. о рождении',
  imei: 'IMEI',
  other: 'ПД',
};

export const BATCH_PROGRESS_STORAGE_KEY = 'legal_ocr_batch_progress';

export function makeProfletter(index) {
  return `[ФИО ${index}]`;
}

export function normalizePdText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function dedupeMentions(values) {
  const seen = new Set();
  const result = [];
  for (const raw of values || []) {
    const value = normalizePdText(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function getPersonMentions(person) {
  return dedupeMentions([person?.fullName, ...(person?.mentions || [])]);
}

export function getOtherPdMentions(item) {
  return dedupeMentions([item?.value, ...(item?.mentions || [])]);
}

export function buildCanonicalPersonMentions(fullName) {
  const normalized = normalizePdText(fullName);
  if (!normalized) return [];

  const words = normalized.split(/\s+/).filter(Boolean);
  const surname = words[0] || '';
  const initials = words.slice(1)
    .flatMap((word) => {
      const letters = word.match(/[A-Za-zА-Яа-яЁё]/g) || [];
      if (letters.length === 0) return [];
      if (/[.,]/.test(word)) return letters.slice(0, 2);
      return [letters[0]];
    })
    .map((letter) => letter.toUpperCase())
    .slice(0, 2);
  const initialsText = initials.map((letter) => `${letter}.`).join('');

  return dedupeMentions([
    normalized,
    surname,
    initialsText ? `${surname} ${initialsText}` : '',
    initialsText ? `${initialsText} ${surname}` : '',
  ]);
}

export function formatDocumentPageProgress(doc) {
  if (!doc?.pageTo) return '';
  if (doc?.totalPages) return `${doc.pageTo} из ${doc.totalPages}`;
  return `${doc.pageTo}`;
}

export function parseCssSize(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value || '').replace('px', '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getBatchStatusTitle(status, sourceKind = 'pdf') {
  const subject = sourceKind === 'image' ? 'изображений' : 'PDF';
  if (status === 'failed') return `Обработка ${subject} остановлена`;
  if (status === 'paused') return 'Обработка приостановлена';
  if (status === 'pausing') return 'Пауза будет поставлена';
  if (status === 'running') return `Идёт обработка ${subject}`;
  return `Есть незавершённая обработка ${subject}`;
}

export function getBatchResumeText({
  nextPage,
  totalPages,
  chunkSize,
  sourceKind = 'pdf',
}) {
  return `Продолжение: ${formatProjectChunkPageRange(
    nextPage,
    getProjectPdfChunkEnd(nextPage, totalPages, chunkSize || 1),
    totalPages,
    sourceKind,
  )}.`;
}

export function getBatchSourceSelectionHint(sourceKind = 'pdf') {
  if (sourceKind === 'image') return 'Для продолжения выберите тот же набор изображений.';
  return 'Для продолжения выберите тот же PDF.';
}

export function mergeBatchUiState(prevState, nextState) {
  if (!nextState) return null;
  if (!prevState) return nextState;
  if (prevState.status !== 'pausing') return nextState;
  if (!['running', 'pausing'].includes(nextState.status)) return nextState;

  return {
    ...nextState,
    status: 'pausing',
    message: prevState.message || 'Пауза будет поставлена после текущей страницы.',
  };
}

export function assignLetters(personalData, existingPD) {
  let privateIndex = 0;
  let professionalIndex = 0;

  if (existingPD) {
    privateIndex = (existingPD.persons || []).filter((person) => person.category === 'private').length;
    professionalIndex = (existingPD.persons || []).filter((person) => person.category === 'professional').length;
  }

  return {
    ...personalData,
    persons: (personalData.persons || []).map((person) => ({
      ...person,
      letter: person.letter || (
        person.category === 'private'
          ? (ALPHA_PRIVATE[privateIndex] !== undefined ? ALPHA_PRIVATE[privateIndex++] : `Л-${++privateIndex}`)
          : makeProfletter(++professionalIndex)
      ),
    })),
  };
}

export function mergePD(existingPD, newPD) {
  const merged = {
    persons: [...(existingPD.persons || [])],
    otherPD: [...(existingPD.otherPD || [])],
  };

  const normalizeValue = (value) => normalizePdText(value).toLowerCase();

  for (const newPerson of newPD.persons || []) {
    const existingPerson = merged.persons.find(
      (person) => person.fullName.toLowerCase() === newPerson.fullName.toLowerCase(),
    );
    if (existingPerson) {
      const existingMentions = new Set(getPersonMentions(existingPerson).map((mention) => mention.toLowerCase()));
      const addedMentions = getPersonMentions(newPerson).filter(
        (mention) => !existingMentions.has(mention.toLowerCase()),
      );
      if (addedMentions.length > 0) {
        existingPerson.mentions = dedupeMentions([...(existingPerson.mentions || []), ...addedMentions]);
      }
      if (!existingPerson.role && newPerson.role) existingPerson.role = newPerson.role;
    } else {
      merged.persons.push({ ...newPerson });
    }
  }

  for (const newItem of newPD.otherPD || []) {
    const normalizedValue = normalizeValue(newItem.value);
    const existingItem = merged.otherPD.find(
      (item) => item.type === newItem.type && normalizeValue(item.value) === normalizedValue,
    );
    if (!existingItem) {
      merged.otherPD.push({ ...newItem });
      continue;
    }

    existingItem.mentions = dedupeMentions([
      ...(existingItem.mentions || []),
      ...getOtherPdMentions(newItem),
    ]);
  }

  return merged;
}

export function shouldShowLongDocWarningForEntry(entry) {
  if (!entry) return false;
  if (entry.isProjectSummary || entry.source === 'project-summary' || entry.source === 'project-batch') return false;
  return (entry.text || '').replace(/\[PAGE:\d+\]/g, '').length > PD_ANALYSIS_CHAR_LIMIT;
}

export function extractPdIdsFromHtml(html) {
  const ids = new Set();
  const pattern = /data-pd-id="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(html)) !== null) ids.add(match[1]);
  return ids;
}

export function loadBatchProgressSnapshot() {
  try {
    const raw = localStorage.getItem(BATCH_PROGRESS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveBatchProgressSnapshot(snapshot) {
  try {
    if (!snapshot) {
      localStorage.removeItem(BATCH_PROGRESS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(BATCH_PROGRESS_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {}
}

export function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date)) return '';
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
