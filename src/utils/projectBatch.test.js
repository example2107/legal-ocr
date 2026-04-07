import {
  PROJECT_PDF_CHUNK_SIZE,
  createProjectPdfBatchSession,
  formatProjectChunkPageRange,
  formatProjectChunkTitle,
  getProjectPdfChunkEnd,
  isSameProjectPdfBatchFile,
} from './projectBatch';

describe('project batch helpers', () => {
  const file = {
    name: 'Материалы дела.pdf',
    size: 123456,
    lastModified: 1712530000000,
  };

  test('creates project pdf batch session with 5-page chunking', () => {
    const session = createProjectPdfBatchSession(file, 12, 3);

    expect(session.fileName).toBe(file.name);
    expect(session.totalPages).toBe(12);
    expect(session.chunkSize).toBe(PROJECT_PDF_CHUNK_SIZE);
    expect(session.totalChunks).toBe(3);
    expect(session.nextPage).toBe(1);
    expect(session.nextDocumentNumber).toBe(3);
  });

  test('matches the same file for resume', () => {
    const session = createProjectPdfBatchSession(file, 12, 1);

    expect(isSameProjectPdfBatchFile(session, { ...file })).toBe(true);
    expect(isSameProjectPdfBatchFile(session, { ...file, size: file.size + 1 })).toBe(false);
    expect(isSameProjectPdfBatchFile(session, { ...file, lastModified: file.lastModified + 1 })).toBe(false);
    expect(isSameProjectPdfBatchFile(session, { ...file, name: 'Другой.pdf' })).toBe(false);
  });

  test('calculates chunk end page conservatively', () => {
    expect(getProjectPdfChunkEnd(1, 12)).toBe(5);
    expect(getProjectPdfChunkEnd(6, 12)).toBe(10);
    expect(getProjectPdfChunkEnd(11, 12)).toBe(12);
  });

  test('formats titles and page ranges for project chunks', () => {
    expect(formatProjectChunkTitle(2, 'Материалы дела.pdf')).toBe('02. Материалы дела.pdf');
    expect(formatProjectChunkPageRange(6, 10, 12)).toBe('стр. 6-10 из 12');
  });
});

