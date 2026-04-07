export const PROJECT_PDF_CHUNK_SIZE = 5;

export function getProjectPdfBatchFileMeta(file) {
  return {
    fileName: file?.name || '',
    fileSize: Number(file?.size || 0),
    lastModified: Number(file?.lastModified || 0),
  };
}

export function isSameProjectPdfBatchFile(session, file) {
  if (!session || !file) return false;
  const meta = getProjectPdfBatchFileMeta(file);
  return (
    (session.fileName || '') === meta.fileName &&
    Number(session.fileSize || 0) === meta.fileSize &&
    Number(session.lastModified || 0) === meta.lastModified
  );
}

export function createProjectPdfBatchSession(file, totalPages, nextDocumentNumber) {
  const chunkSize = PROJECT_PDF_CHUNK_SIZE;
  return {
    ...getProjectPdfBatchFileMeta(file),
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

export function getProjectPdfChunkEnd(pageFrom, totalPages, chunkSize = PROJECT_PDF_CHUNK_SIZE) {
  return Math.min(pageFrom + chunkSize - 1, totalPages);
}

export function formatProjectChunkTitle(sequenceNumber, fileName) {
  return `${String(sequenceNumber).padStart(2, '0')}. ${fileName || 'PDF-документ'}`;
}

export function formatProjectChunkPageRange(pageFrom, pageTo, totalPages) {
  if (!pageFrom || !pageTo) return '';
  return totalPages && totalPages > 0
    ? `стр. ${pageFrom}-${pageTo} из ${totalPages}`
    : `стр. ${pageFrom}-${pageTo}`;
}

