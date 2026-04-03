const STORAGE_KEY = 'legal_ocr_history';
const MAX_ITEMS = 50;

export function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveHistory(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch (e) {
    console.warn('History save failed (storage full?)', e);
  }
}

export function saveDocument(doc) {
  // doc: { id, title, text, editedHtml, personalData, anonymized, savedAt, source }
  const history = loadHistory();
  const idx = history.findIndex(h => h.id === doc.id);
  const entry = { ...doc, savedAt: new Date().toISOString() };
  if (idx >= 0) {
    history[idx] = entry;
  } else {
    history.unshift(entry);
  }
  saveHistory(history);
  return entry;
}

export function deleteDocument(id) {
  const history = loadHistory().filter(h => h.id !== id);
  saveHistory(history);
}

export function generateId() {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Экспорт документа в .юрдок файл ────────────────────────────────────────
export function exportDocument(entry) {
  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    id: entry.id,
    title: entry.title,
    originalFileName: entry.originalFileName || '',
    text: entry.text || '',
    editedHtml: entry.editedHtml || '',
    personalData: entry.personalData || { persons: [], otherPD: [] },
    anonymized: entry.anonymized || {},
    source: entry.source || 'ocr',
    savedAt: entry.savedAt || new Date().toISOString(),
  };
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const baseName = (entry.title || 'документ')
    .replace(/\.pdf$/i, '').replace(/\.docx$/i, '')
    .replace(/\.jpg$/i, '').replace(/\.png$/i, '').replace(/\.webp$/i, '');
  a.download = 'ЮрДок_' + baseName + '.юрдок';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Импорт документа из .юрдок файла ───────────────────────────────────────
export function importDocument(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        // Валидация — проверяем обязательные поля
        if (!data.title && !data.editedHtml && !data.text) {
          reject(new Error('Файл не содержит данных документа'));
          return;
        }
        // Генерируем новый id чтобы не было конфликтов с существующими
        const entry = {
          id: generateId(),
          title: data.title || 'Импортированный документ',
          originalFileName: data.originalFileName || '',
          text: data.text || '',
          editedHtml: data.editedHtml || '',
          personalData: data.personalData || { persons: [], otherPD: [] },
          anonymized: data.anonymized || {},
          source: data.source || 'ocr',
          savedAt: new Date().toISOString(),
        };
        // Сохраняем в историю
        saveDocument(entry);
        resolve(entry);
      } catch (err) {
        reject(new Error('Не удалось прочитать файл: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsText(file);
  });
}
