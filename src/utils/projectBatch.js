export const PROJECT_BATCH_CHUNK_SIZE = 1;
export const PROJECT_BATCH_SOURCE_PDF = 'pdf';
export const PROJECT_BATCH_SOURCE_IMAGE = 'image';

export function getProjectBatchFileMeta(file) {
  return {
    fileName: file?.name || '',
    fileSize: Number(file?.size || 0),
    lastModified: Number(file?.lastModified || 0),
  };
}

export function getProjectPdfBatchFileMeta(file) {
  return getProjectBatchFileMeta(file);
}

export function getProjectImageBatchFilesMeta(files = []) {
  return Array.from(files || []).map((file) => getProjectBatchFileMeta(file));
}

export function isSameProjectPdfBatchFile(session, file) {
  if (!session || !file) return false;
  const meta = getProjectBatchFileMeta(file);
  return (
    (session.sourceKind || PROJECT_BATCH_SOURCE_PDF) === PROJECT_BATCH_SOURCE_PDF &&
    (session.fileName || '') === meta.fileName &&
    Number(session.fileSize || 0) === meta.fileSize &&
    Number(session.lastModified || 0) === meta.lastModified
  );
}

export function isSameProjectImageBatchFiles(session, files = []) {
  if (!session || (session.sourceKind || PROJECT_BATCH_SOURCE_PDF) !== PROJECT_BATCH_SOURCE_IMAGE) {
    return false;
  }
  const nextFiles = getProjectImageBatchFilesMeta(files);
  const existingFiles = Array.isArray(session.filesMeta) ? session.filesMeta : [];
  if (existingFiles.length !== nextFiles.length) return false;
  return existingFiles.every((entry, index) => (
    entry.fileName === nextFiles[index].fileName &&
    Number(entry.fileSize || 0) === Number(nextFiles[index].fileSize || 0) &&
    Number(entry.lastModified || 0) === Number(nextFiles[index].lastModified || 0)
  ));
}

export function createProjectPdfBatchSession(file, totalPages, nextDocumentNumber) {
  const chunkSize = PROJECT_BATCH_CHUNK_SIZE;
  return {
    ...getProjectBatchFileMeta(file),
    sourceKind: PROJECT_BATCH_SOURCE_PDF,
    totalPages,
    totalChunks: Math.ceil(totalPages / chunkSize),
    chunkSize,
    nextPage: 1,
    nextDocumentNumber,
    status: 'running',
    error: '',
    currentPageFrom: 1,
    currentPageTo: Math.min(chunkSize, totalPages),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function createProjectImageBatchSession(files, nextDocumentNumber) {
  const safeFiles = Array.from(files || []);
  const totalPages = safeFiles.length;
  const chunkSize = PROJECT_BATCH_CHUNK_SIZE;
  return {
    sourceKind: PROJECT_BATCH_SOURCE_IMAGE,
    fileName: totalPages === 1
      ? (safeFiles[0]?.name || 'Изображение')
      : `Изображения (${totalPages})`,
    filesMeta: getProjectImageBatchFilesMeta(safeFiles),
    totalPages,
    totalChunks: Math.ceil(totalPages / chunkSize),
    chunkSize,
    nextPage: 1,
    nextDocumentNumber,
    status: 'running',
    error: '',
    currentPageFrom: 1,
    currentPageTo: Math.min(chunkSize, totalPages),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function updateProjectPdfBatchSession(session, patch) {
  return {
    ...(session || {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

export function getProjectPdfChunkEnd(pageFrom, totalPages, chunkSize = PROJECT_BATCH_CHUNK_SIZE) {
  return Math.min(pageFrom + chunkSize - 1, totalPages);
}

export function formatProjectChunkTitle(sequenceNumber, fileName) {
  return `${String(sequenceNumber).padStart(2, '0')}. ${fileName || 'Документ'}`;
}

export function formatProjectChunkPageRange(pageFrom, pageTo, totalPages, sourceKind = PROJECT_BATCH_SOURCE_PDF) {
  if (!pageFrom || !pageTo) return '';

  const unitLabel = sourceKind === PROJECT_BATCH_SOURCE_IMAGE ? 'файл' : 'стр.';
  if (pageFrom === pageTo) {
    return totalPages && totalPages > 0
      ? `${unitLabel} ${pageFrom} из ${totalPages}`
      : `${unitLabel} ${pageFrom}`;
  }

  return totalPages && totalPages > 0
    ? `${unitLabel} ${pageFrom}-${pageTo} из ${totalPages}`
    : `${unitLabel} ${pageFrom}-${pageTo}`;
}
