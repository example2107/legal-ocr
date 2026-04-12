import { normalizeDocumentPageMetadata } from './documentPageMetadata';

const STORAGE_KEY = 'legal_ocr_history';
const MAX_ITEMS = 50;
const EMPTY_PD = { persons: [], otherPD: [], ambiguousPersons: [] };

function buildExportData(entry) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    id: entry.id,
    title: entry.title,
    originalFileName: entry.originalFileName || '',
    text: entry.text || '',
    editedHtml: entry.editedHtml || '',
    personalData: entry.personalData || EMPTY_PD,
    anonymized: entry.anonymized || {},
    source: entry.source || 'ocr',
    pageFrom: entry.pageFrom || null,
    pageTo: entry.pageTo || null,
    totalPages: entry.totalPages || null,
    chunkIndex: entry.chunkIndex || null,
    chunkSize: entry.chunkSize || null,
    batchFileName: entry.batchFileName || '',
    pageMetadata: normalizeDocumentPageMetadata(entry),
    savedAt: entry.savedAt || new Date().toISOString(),
  };
}

function buildImportedEntry(data) {
  return {
    id: generateId(),
    title: data.title || 'Импортированный документ',
    originalFileName: data.originalFileName || '',
    text: data.text || '',
    editedHtml: data.editedHtml || '',
    personalData: data.personalData || EMPTY_PD,
    anonymized: data.anonymized || {},
    source: data.source || 'ocr',
    pageFrom: data.pageFrom || null,
    pageTo: data.pageTo || null,
    totalPages: data.totalPages || null,
    chunkIndex: data.chunkIndex || null,
    chunkSize: data.chunkSize || null,
    batchFileName: data.batchFileName || '',
    pageMetadata: normalizeDocumentPageMetadata(data),
    savedAt: new Date().toISOString(),
  };
}

function parseImportedDocument(rawText) {
  const data = JSON.parse(rawText);
  if (!data.title && !data.editedHtml && !data.text) {
    throw new Error('Файл не содержит данных документа');
  }
  return buildImportedEntry(data);
}

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
  const exportData = buildExportData(entry);
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
        resolve(parseImportedDocument(e.target.result));
      } catch (err) {
        reject(new Error(`Не удалось прочитать файл: ${err.message}`));
      }
    };
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsText(file);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Проекты ──────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
const PROJECTS_KEY = 'legal_ocr_projects';
const MAX_PROJECTS = 30;

export function loadProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveProjects(items) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(items.slice(0, MAX_PROJECTS)));
  } catch (e) {
    console.warn('Projects save failed (storage full?)', e);
  }
}

export function saveProject(project) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === project.id);
  const entry = { ...project, updatedAt: new Date().toISOString() };
  if (idx >= 0) {
    projects[idx] = entry;
  } else {
    entry.createdAt = entry.createdAt || new Date().toISOString();
    projects.unshift(entry);
  }
  saveProjects(projects);
  return entry;
}

export function deleteProject(id) {
  const projects = loadProjects().filter(p => p.id !== id);
  saveProjects(projects);
}

export function getProject(id) {
  return loadProjects().find(p => p.id === id) || null;
}

export function createProject(title) {
  const project = {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: title || 'Новый проект',
    documentIds: [],
    sharedPD: { persons: [], otherPD: [] },
    batchSession: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveProject(project);
  return project;
}

export function addDocumentToProject(projectId, docId) {
  const project = getProject(projectId);
  if (!project) return null;
  if (!project.documentIds.includes(docId)) {
    project.documentIds.push(docId);
  }
  return saveProject(project);
}

export function removeDocumentFromProject(projectId, docId) {
  const project = getProject(projectId);
  if (!project) return null;
  project.documentIds = project.documentIds.filter(id => id !== docId);
  return saveProject(project);
}

export function updateProjectSharedPD(projectId, sharedPD) {
  const project = getProject(projectId);
  if (!project) return null;
  project.sharedPD = sharedPD;
  return saveProject(project);
}

export function updateProjectBatchSession(projectId, batchSession) {
  const project = getProject(projectId);
  if (!project) return null;
  project.batchSession = batchSession || null;
  return saveProject(project);
}
