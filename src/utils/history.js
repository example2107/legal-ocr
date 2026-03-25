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
