import { buildAnnotatedHtml } from '../components/RichEditor';
import { addDocumentToProjectRecord, deleteDocumentRecord, saveDocumentRecord, updateProjectSharedPDRecord } from './dataStore';
import { mergeDocumentCoordinateLayer } from './documentCoordinateLayer';
import { mergeDocumentPageMetadata } from './documentPageMetadata';
import { generateId } from './history';

function mergeSourceFiles(existingFiles = [], nextFiles = []) {
  const files = [...(existingFiles || []), ...(nextFiles || [])];
  const seen = new Set();
  return files.filter((file, index) => {
    const key = file?.storagePath || file?.name || `file_${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function annotateMergedDocumentHtml({ html, pd, initialAnon, getOtherPdMentions }) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const markedIds = new Set();
  tmp.querySelectorAll('mark[data-pd-id]').forEach((el) => markedIds.add(el.dataset.pdId));

  const newPersons = pd.persons.filter((person) => !markedIds.has(person.id));
  const newOtherPD = pd.otherPD.filter((item) => !markedIds.has(item.id));

  if (newPersons.length === 0 && newOtherPD.length === 0) {
    return html;
  }

  const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const buildPattern = (value) => {
    const parts = value.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return escapeRegExp(value);
    return parts.map((part) => escapeRegExp(part)).join('[\\s\\n]+');
  };

  function annotateNewInNode(node) {
    if (node.nodeType === 3) {
      const text = node.textContent;
      const matches = [];

      for (const person of newPersons) {
        for (const mention of (person.mentions || [person.fullName])) {
          if (!mention || mention.length < 2) continue;
          try {
            const re = new RegExp(escapeRegExp(mention), 'gi');
            let match;
            while ((match = re.exec(text)) !== null) {
              const cat = person.category === 'professional' ? 'prof' : 'priv';
              matches.push({
                start: match.index,
                end: match.index + match[0].length,
                mt: match[0],
                id: person.id,
                cat,
                letter: person.letter,
                isAnon: !!initialAnon[person.id],
                type: 'person',
              });
            }
          } catch {}
        }
      }

      for (const item of newOtherPD) {
        for (const mention of getOtherPdMentions(item)) {
          try {
            const re = new RegExp(buildPattern(mention), 'gi');
            let match;
            while ((match = re.exec(text)) !== null) {
              matches.push({
                start: match.index,
                end: match.index + match[0].length,
                mt: match[0],
                id: item.id,
                cat: 'oth',
                replacement: item.replacement,
                isAnon: !!initialAnon[item.id],
                type: 'other',
              });
            }
          } catch {}
        }
      }

      if (matches.length === 0) return;
      matches.sort((a, b) => a.start - b.start);
      const filtered = [];
      let lastEnd = 0;
      for (const match of matches) {
        if (match.start >= lastEnd) {
          filtered.push(match);
          lastEnd = match.end;
        }
      }

      const fragment = document.createDocumentFragment();
      let lastIdx = 0;
      for (const match of filtered) {
        if (match.start > lastIdx) {
          fragment.appendChild(document.createTextNode(text.slice(lastIdx, match.start)));
        }
        const el = document.createElement('mark');
        el.className = 'pd ' + match.cat + (match.isAnon ? ' anon' : '');
        el.dataset.pdId = match.id;
        el.dataset.original = match.mt;
        el.contentEditable = 'false';
        el.title = match.isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить';
        el.textContent = match.isAnon
          ? (match.type === 'person' ? match.letter : match.replacement)
          : match.mt;
        fragment.appendChild(el);
        lastIdx = match.end;
      }
      if (lastIdx < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
      }
      node.parentNode.replaceChild(fragment, node);
      return;
    }

    if (node.nodeType === 1 && !['mark', 'script', 'style'].includes(node.tagName.toLowerCase())) {
      Array.from(node.childNodes).forEach(annotateNewInNode);
    }
  }

  Array.from(tmp.childNodes).forEach(annotateNewInNode);
  return tmp.innerHTML;
}

export async function mergeProjectDocument({
  user,
  currentProjectId,
  docEntry,
  projectDocs,
  mergePD,
  assignLetters,
  getOtherPdMentions,
  refreshHistory,
  refreshProjects,
}) {
  let existingPD = null;
  if (projectDocs.length > 0) {
    const lastDoc = projectDocs[projectDocs.length - 1];
    if (lastDoc.personalData) existingPD = lastDoc.personalData;
  }

  const pd = existingPD
    ? assignLetters(mergePD(existingPD, docEntry.personalData || { persons: [], otherPD: [] }), existingPD)
    : assignLetters(docEntry.personalData || { persons: [], otherPD: [] });

  const initialAnon = docEntry.anonymized || {};
  const html = docEntry.editedHtml
    ? annotateMergedDocumentHtml({
        html: docEntry.editedHtml,
        pd,
        initialAnon,
        getOtherPdMentions,
      })
    : buildAnnotatedHtml(docEntry.text || '', pd, initialAnon);

  const updatedDoc = {
    ...docEntry,
    personalData: pd,
    editedHtml: html,
    projectId: currentProjectId,
    savedAt: new Date().toISOString(),
  };

  await saveDocumentRecord(user, updatedDoc);
  await addDocumentToProjectRecord(user, currentProjectId, updatedDoc.id);
  await updateProjectSharedPDRecord(user, currentProjectId, pd);
  await refreshHistory();
  await refreshProjects();

  return updatedDoc;
}

export function getProjectSummaryDocEntry(history, currentProjectId) {
  return history.find((entry) => entry.projectId === currentProjectId && entry.isProjectSummary) || null;
}

export async function saveProjectSummaryDocument({
  user,
  currentProject,
  currentProjectId,
  docs,
  history,
  refreshHistory,
  refreshProjects,
}) {
  if (!currentProjectId || docs.length === 0) return null;

  const htmlParts = docs.map((doc, idx) => {
    const docHtml = doc.editedHtml || '';
    if (idx === 0) return docHtml;
    const separator = `<div class="part-separator" contenteditable="false"><span class="part-separator-line"></span><span class="part-separator-label">Часть ${idx + 1}: ${doc.title || ''}</span><span class="part-separator-line"></span></div>`;
    return separator + docHtml;
  });
  const mergedHtml = htmlParts.join('');

  const lastDoc = docs[docs.length - 1];
  const pd = lastDoc.personalData || { persons: [], otherPD: [] };

  const mergedAnon = {};
  docs.forEach((doc) => {
    Object.entries(doc.anonymized || {}).forEach(([id, value]) => {
      if (value) mergedAnon[id] = true;
    });
  });

  const mergedText = docs.map((doc, idx) => {
    const text = doc.text || '';
    if (idx === 0) return text;
    return `\n[PART:${idx + 1}]\n${text}`;
  }).join('');

  const summaryDoc = {
    id: generateId(),
    title: '📋 Итоговый документ — ' + (currentProject?.title || 'Проект'),
    originalFileName: '',
    text: mergedText,
    editedHtml: mergedHtml,
    personalData: pd,
    anonymized: mergedAnon,
    source: 'project-summary',
    projectId: currentProjectId,
    isProjectSummary: true,
    pageMetadata: mergeDocumentPageMetadata(docs),
    coordinateLayer: mergeDocumentCoordinateLayer(docs),
    savedAt: new Date().toISOString(),
  };

  const oldSummary = getProjectSummaryDocEntry(history, currentProjectId);
  if (oldSummary) {
    await deleteDocumentRecord(user, oldSummary.id);
  }

  await saveDocumentRecord(user, summaryDoc);
  await refreshHistory();
  await refreshProjects();
  return summaryDoc;
}

export function buildProjectBatchDocumentEntry({
  existingDoc = null,
  pageEntry,
  currentProjectId,
  pd,
  getOtherPdMentions,
} = {}) {
  if (!pageEntry) return null;

  const mergedAnon = {
    ...(existingDoc?.anonymized || {}),
    ...(pageEntry?.anonymized || {}),
  };
  const existingHtml = existingDoc?.editedHtml
    ? annotateMergedDocumentHtml({
        html: existingDoc.editedHtml,
        pd,
        initialAnon: mergedAnon,
        getOtherPdMentions,
      })
    : '';
  const nextPageHtml = pageEntry.editedHtml
    ? annotateMergedDocumentHtml({
        html: pageEntry.editedHtml,
        pd,
        initialAnon: mergedAnon,
        getOtherPdMentions,
      })
    : buildAnnotatedHtml(pageEntry.text || '', pd, mergedAnon);
  const documentsToMerge = [existingDoc, pageEntry].filter(Boolean);
  const pageMetadata = mergeDocumentPageMetadata(documentsToMerge);
  const primarySource = pageMetadata?.sources?.[0] || null;

  return {
    ...(existingDoc || {}),
    ...pageEntry,
    id: existingDoc?.id || pageEntry.id || generateId(),
    title: existingDoc?.title || pageEntry.originalFileName || pageEntry.batchFileName || pageEntry.title || 'PDF-документ',
    originalFileName: pageEntry.originalFileName || existingDoc?.originalFileName || '',
    text: [existingDoc?.text || '', pageEntry.text || ''].filter(Boolean).join('\n'),
    editedHtml: [existingHtml, nextPageHtml].filter(Boolean).join(''),
    personalData: pd,
    anonymized: mergedAnon,
    source: 'project-batch',
    projectId: currentProjectId || pageEntry.projectId || existingDoc?.projectId || null,
    pageFrom: existingDoc?.pageFrom || pageEntry.pageFrom || primarySource?.pageFrom || null,
    pageTo: pageEntry.pageTo || existingDoc?.pageTo || primarySource?.pageTo || null,
    totalPages: pageEntry.totalPages || existingDoc?.totalPages || primarySource?.totalPages || null,
    chunkIndex: null,
    chunkSize: 1,
    batchFileName: pageEntry.batchFileName || existingDoc?.batchFileName || '',
    sourceFiles: mergeSourceFiles(existingDoc?.sourceFiles, pageEntry.sourceFiles),
    pageMetadata,
    coordinateLayer: mergeDocumentCoordinateLayer(documentsToMerge),
    patchLayer: existingDoc?.patchLayer || null,
    isProjectSummary: false,
    savedAt: new Date().toISOString(),
  };
}
