import {
  addDocumentToProject as localAddDocumentToProject,
  createProject as localCreateProject,
  deleteDocument as localDeleteDocument,
  deleteProject as localDeleteProject,
  loadHistory as localLoadHistory,
  loadProjects as localLoadProjects,
  saveDocument as localSaveDocument,
  saveProject as localSaveProject,
} from './history';
import {
  isSupabaseConfigured,
  STORAGE_BUCKET_SOURCE_FILES,
  supabase,
} from './supabaseClient';

function canUseCloud(user) {
  return Boolean(user?.id && isSupabaseConfigured && supabase);
}

function generateProjectId() {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function mapProjectRow(row) {
  return {
    id: row.id,
    title: row.title,
    documentIds: row.document_ids || [],
    sharedPD: row.shared_pd || { persons: [], otherPD: [] },
    batchSession: row.batch_session || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function projectToRow(userId, project) {
  return {
    id: project.id,
    user_id: userId,
    title: project.title,
    document_ids: project.documentIds || [],
    shared_pd: project.sharedPD || { persons: [], otherPD: [] },
    batch_session: project.batchSession || null,
    created_at: project.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function mapDocumentRow(row) {
  return {
    id: row.id,
    title: row.title,
    originalFileName: row.original_file_name || '',
    text: row.text || '',
    editedHtml: row.edited_html || '',
    personalData: row.personal_data || { persons: [], otherPD: [], ambiguousPersons: [] },
    anonymized: row.anonymized || {},
    source: row.source || 'ocr',
    projectId: row.project_id || null,
    isProjectSummary: !!row.is_project_summary,
    pageFrom: row.page_from,
    pageTo: row.page_to,
    totalPages: row.total_pages,
    chunkIndex: row.chunk_index,
    chunkSize: row.chunk_size,
    batchFileName: row.batch_file_name || '',
    sourceFiles: row.source_files || [],
    savedAt: row.saved_at || row.updated_at,
  };
}

function documentToRow(userId, doc) {
  return {
    id: doc.id,
    user_id: userId,
    title: doc.title || 'Документ',
    original_file_name: doc.originalFileName || '',
    text: doc.text || '',
    edited_html: doc.editedHtml || '',
    personal_data: doc.personalData || { persons: [], otherPD: [], ambiguousPersons: [] },
    anonymized: doc.anonymized || {},
    source: doc.source || 'ocr',
    project_id: doc.projectId || null,
    is_project_summary: !!doc.isProjectSummary,
    page_from: doc.pageFrom || null,
    page_to: doc.pageTo || null,
    total_pages: doc.totalPages || null,
    chunk_index: doc.chunkIndex || null,
    chunk_size: doc.chunkSize || null,
    batch_file_name: doc.batchFileName || '',
    source_files: doc.sourceFiles || [],
    saved_at: doc.savedAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function requireRow(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function listDocuments(user) {
  if (!canUseCloud(user)) return localLoadHistory();
  const rows = await requireRow(
    supabase
      .from('documents')
      .select('*')
      .order('saved_at', { ascending: false })
  );
  return rows.map(mapDocumentRow);
}

export async function listProjects(user) {
  if (!canUseCloud(user)) return localLoadProjects();
  const rows = await requireRow(
    supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false })
  );
  return rows.map(mapProjectRow);
}

export async function saveDocumentRecord(user, doc) {
  if (!canUseCloud(user)) return localSaveDocument(doc);
  const row = documentToRow(user.id, doc);
  const saved = await requireRow(
    supabase
      .from('documents')
      .upsert(row, { onConflict: 'id' })
      .select()
      .single()
  );
  return mapDocumentRow(saved);
}

export async function deleteDocumentRecord(user, documentId) {
  if (!canUseCloud(user)) {
    localDeleteDocument(documentId);
    return;
  }
  const { error } = await supabase.from('documents').delete().eq('id', documentId);
  if (error) throw error;
}

export async function createProjectRecord(user, title) {
  if (!canUseCloud(user)) return localCreateProject(title);
  const project = {
    id: generateProjectId(),
    title: title || 'Новый проект',
    documentIds: [],
    sharedPD: { persons: [], otherPD: [] },
    batchSession: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const row = projectToRow(user.id, project);
  const saved = await requireRow(
    supabase
      .from('projects')
      .insert(row)
      .select()
      .single()
  );
  return mapProjectRow(saved);
}

export async function saveProjectRecord(user, project) {
  if (!canUseCloud(user)) return localSaveProject(project);
  const row = projectToRow(user.id, project);
  const saved = await requireRow(
    supabase
      .from('projects')
      .upsert(row, { onConflict: 'id' })
      .select()
      .single()
  );
  return mapProjectRow(saved);
}

export async function deleteProjectRecord(user, projectId) {
  if (!canUseCloud(user)) {
    localDeleteProject(projectId);
    return;
  }
  const { error } = await supabase.from('projects').delete().eq('id', projectId);
  if (error) throw error;
}

async function loadProjectRecord(user, projectId) {
  if (!canUseCloud(user)) {
    return localLoadProjects().find((item) => item.id === projectId) || null;
  }
  const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).maybeSingle();
  if (error) throw error;
  return data ? mapProjectRow(data) : null;
}

export async function addDocumentToProjectRecord(user, projectId, documentId) {
  if (!canUseCloud(user)) return localAddDocumentToProject(projectId, documentId);
  const project = await loadProjectRecord(user, projectId);
  if (!project) return null;
  const nextIds = project.documentIds.includes(documentId)
    ? project.documentIds
    : [...project.documentIds, documentId];
  return saveProjectRecord(user, { ...project, documentIds: nextIds });
}

export async function removeDocumentFromProjectRecord(user, projectId, documentId) {
  const project = await loadProjectRecord(user, projectId);
  if (!project) return null;
  return saveProjectRecord(user, {
    ...project,
    documentIds: (project.documentIds || []).filter((id) => id !== documentId),
  });
}

export async function updateProjectSharedPDRecord(user, projectId, sharedPD) {
  const project = await loadProjectRecord(user, projectId);
  if (!project) return null;
  return saveProjectRecord(user, { ...project, sharedPD });
}

export async function updateProjectBatchSessionRecord(user, projectId, batchSession) {
  const project = await loadProjectRecord(user, projectId);
  if (!project) return null;
  return saveProjectRecord(user, { ...project, batchSession: batchSession || null });
}

function sanitizeFileName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export function buildSourceFileKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

export async function uploadSourceFile(user, file, options = {}) {
  if (!canUseCloud(user)) {
    return {
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      storagePath: '',
      uploadedAt: new Date().toISOString(),
    };
  }

  const projectSegment = options.projectId || 'personal';
  const path = `${user.id}/${projectSegment}/${Date.now()}-${sanitizeFileName(file.name)}`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET_SOURCE_FILES)
    .upload(path, file, {
      upsert: false,
      cacheControl: '3600',
      contentType: file.type || undefined,
    });

  if (error) throw error;

  return {
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    storagePath: path,
    bucket: STORAGE_BUCKET_SOURCE_FILES,
    uploadedAt: new Date().toISOString(),
  };
}
