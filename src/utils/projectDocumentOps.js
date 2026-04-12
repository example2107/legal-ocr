import { buildAnnotatedHtml } from '../components/RichEditor';
import { addDocumentToProjectRecord, deleteDocumentRecord, saveDocumentRecord, updateProjectSharedPDRecord } from './dataStore';
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFlexibleMentionPattern(value) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return escapeRegExp(value);
  return parts.map((part) => escapeRegExp(part)).join('[\\s\\n]+');
}

function collectPatternMatches({ text, pattern, buildMatch }) {
  const matches = [];

  try {
    const re = new RegExp(pattern, 'gi');
    let match;
    while ((match = re.exec(text)) !== null) {
      matches.push(buildMatch(match));
    }
  } catch {}

  return matches;
}

function collectPersonMatches(text, persons, initialAnon) {
  return persons.flatMap((person) => {
    const cat = person.category === 'professional' ? 'prof' : 'priv';
    return (person.mentions || [person.fullName]).flatMap((mention) => {
      if (!mention || mention.length < 2) return [];
      return collectPatternMatches({
        text,
        pattern: escapeRegExp(mention),
        buildMatch: (match) => ({
          start: match.index,
          end: match.index + match[0].length,
          mt: match[0],
          id: person.id,
          cat,
          letter: person.letter,
          isAnon: !!initialAnon[person.id],
          type: 'person',
        }),
      });
    });
  });
}

function collectOtherPdMatches(text, otherPd, initialAnon, getOtherPdMentions) {
  return otherPd.flatMap((item) => (
    getOtherPdMentions(item).flatMap((mention) => collectPatternMatches({
      text,
      pattern: buildFlexibleMentionPattern(mention),
      buildMatch: (match) => ({
        start: match.index,
        end: match.index + match[0].length,
        mt: match[0],
        id: item.id,
        cat: 'oth',
        replacement: item.replacement,
        isAnon: !!initialAnon[item.id],
        type: 'other',
      }),
    }))
  ));
}

function filterNonOverlappingMatches(matches) {
  const filtered = [];
  let lastEnd = 0;

  matches
    .sort((a, b) => a.start - b.start)
    .forEach((match) => {
      if (match.start < lastEnd) return;
      filtered.push(match);
      lastEnd = match.end;
    });

  return filtered;
}

function buildAnnotatedMark(match) {
  const el = document.createElement('mark');
  el.className = 'pd ' + match.cat + (match.isAnon ? ' anon' : '');
  el.dataset.pdId = match.id;
  el.dataset.original = match.mt;
  el.contentEditable = 'false';
  el.title = match.isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить';
  el.textContent = match.isAnon
    ? (match.type === 'person' ? match.letter : match.replacement)
    : match.mt;
  return el;
}

function annotateTextNodeWithMatches(node, matches) {
  const text = node.textContent;
  const fragment = document.createDocumentFragment();
  let lastIdx = 0;

  matches.forEach((match) => {
    if (match.start > lastIdx) {
      fragment.appendChild(document.createTextNode(text.slice(lastIdx, match.start)));
    }
    fragment.appendChild(buildAnnotatedMark(match));
    lastIdx = match.end;
  });

  if (lastIdx < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
  }

  node.parentNode.replaceChild(fragment, node);
}

function annotateNodeChildren(node, annotateNode) {
  Array.from(node.childNodes).forEach(annotateNode);
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

  function annotateTextNode(node) {
    const text = node.textContent;
    const matches = filterNonOverlappingMatches([
      ...collectPersonMatches(text, newPersons, initialAnon),
      ...collectOtherPdMatches(text, newOtherPD, initialAnon, getOtherPdMentions),
    ]);

    if (matches.length === 0) return;
    annotateTextNodeWithMatches(node, matches);
  }

  function annotateNewInNode(node) {
    if (node.nodeType === 3) {
      annotateTextNode(node);
      return;
    }

    if (node.nodeType === 1 && !['mark', 'script', 'style'].includes(node.tagName.toLowerCase())) {
      annotateNodeChildren(node, annotateNewInNode);
    }
  }

  annotateNodeChildren(tmp, annotateNewInNode);
  return tmp.innerHTML;
}

function buildMergedAnonymizedState(existingDoc, pageEntry) {
  return {
    ...(existingDoc?.anonymized || {}),
    ...(pageEntry?.anonymized || {}),
  };
}

function buildBatchEntryHtml(entry, pd, initialAnon, getOtherPdMentions) {
  if (!entry) return '';
  if (!entry.editedHtml) {
    return buildAnnotatedHtml(entry.text || '', pd, initialAnon);
  }

  return annotateMergedDocumentHtml({
    html: entry.editedHtml,
    pd,
    initialAnon,
    getOtherPdMentions,
  });
}

function buildMergedBatchText(existingDoc, pageEntry) {
  return [existingDoc?.text || '', pageEntry.text || ''].filter(Boolean).join('\n');
}

function resolveBatchDocumentTitle(existingDoc, pageEntry) {
  return existingDoc?.title
    || pageEntry.originalFileName
    || pageEntry.batchFileName
    || pageEntry.title
    || 'PDF-документ';
}

function resolveBatchPageDetails(existingDoc, pageEntry, primarySource) {
  return {
    pageFrom: existingDoc?.pageFrom || pageEntry.pageFrom || primarySource?.pageFrom || null,
    pageTo: pageEntry.pageTo || existingDoc?.pageTo || primarySource?.pageTo || null,
    totalPages: pageEntry.totalPages || existingDoc?.totalPages || primarySource?.totalPages || null,
  };
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

  const mergedAnon = buildMergedAnonymizedState(existingDoc, pageEntry);
  const existingHtml = buildBatchEntryHtml(existingDoc, pd, mergedAnon, getOtherPdMentions);
  const nextPageHtml = buildBatchEntryHtml(pageEntry, pd, mergedAnon, getOtherPdMentions);
  const documentsToMerge = [existingDoc, pageEntry].filter(Boolean);
  const pageMetadata = mergeDocumentPageMetadata(documentsToMerge);
  const primarySource = pageMetadata?.sources?.[0] || null;
  const pageDetails = resolveBatchPageDetails(existingDoc, pageEntry, primarySource);

  return {
    ...(existingDoc || {}),
    ...pageEntry,
    id: existingDoc?.id || pageEntry.id || generateId(),
    title: resolveBatchDocumentTitle(existingDoc, pageEntry),
    originalFileName: pageEntry.originalFileName || existingDoc?.originalFileName || '',
    text: buildMergedBatchText(existingDoc, pageEntry),
    editedHtml: [existingHtml, nextPageHtml].filter(Boolean).join(''),
    personalData: pd,
    anonymized: mergedAnon,
    source: 'project-batch',
    projectId: currentProjectId || pageEntry.projectId || existingDoc?.projectId || null,
    ...pageDetails,
    chunkIndex: null,
    chunkSize: 1,
    batchFileName: pageEntry.batchFileName || existingDoc?.batchFileName || '',
    sourceFiles: mergeSourceFiles(existingDoc?.sourceFiles, pageEntry.sourceFiles),
    pageMetadata,
    isProjectSummary: false,
    savedAt: new Date().toISOString(),
  };
}
