import {
  buildDocumentPageMetadata,
  mergeDocumentPageMetadata,
  normalizeDocumentPageMetadata,
} from './documentPageMetadata';

describe('documentPageMetadata', () => {
  test('builds page metadata for a batch chunk with rendered pages', () => {
    const metadata = buildDocumentPageMetadata({
      sourceFile: {
        name: 'case.pdf',
        size: 12345,
        type: 'application/pdf',
        bucket: 'source-files',
        storagePath: 'user/proj/case.pdf',
      },
      batchFileName: 'case.pdf',
      projectId: 'proj_1',
      pageFrom: 6,
      pageTo: 10,
      totalPages: 20,
      pages: [
        { pageNum: 6, pdfWidth: 595, pdfHeight: 842, renderWidth: 893, renderHeight: 1263, mediaType: 'image/jpeg' },
        { pageNum: 7, pdfWidth: 595, pdfHeight: 842, renderWidth: 893, renderHeight: 1263, mediaType: 'image/jpeg' },
      ],
    });

    expect(metadata).toEqual({
      version: 1,
      sources: [
        {
          sourceFile: {
            name: 'case.pdf',
            size: 12345,
            type: 'application/pdf',
            bucket: 'source-files',
            storagePath: 'user/proj/case.pdf',
            uploadedAt: '',
          },
          batchFileName: 'case.pdf',
          projectId: 'proj_1',
          pageFrom: 6,
          pageTo: 10,
          totalPages: 20,
          pages: [
            {
              pageNumber: 6,
              chunkPageIndex: 1,
              pdfWidth: 595,
              pdfHeight: 842,
              renderWidth: 893,
              renderHeight: 1263,
              rotation: 0,
              mediaType: 'image/jpeg',
            },
            {
              pageNumber: 7,
              chunkPageIndex: 2,
              pdfWidth: 595,
              pdfHeight: 842,
              renderWidth: 893,
              renderHeight: 1263,
              rotation: 0,
              mediaType: 'image/jpeg',
            },
          ],
        },
      ],
    });
  });

  test('normalizes legacy document fields into page metadata', () => {
    const metadata = normalizeDocumentPageMetadata({
      originalFileName: 'legacy.pdf',
      sourceFiles: [{ name: 'legacy.pdf', size: 999, type: 'application/pdf' }],
      batchFileName: 'legacy.pdf',
      projectId: 'proj_2',
      pageFrom: 3,
      pageTo: 4,
      totalPages: 8,
    });

    expect(metadata.sources[0].pageFrom).toBe(3);
    expect(metadata.sources[0].pageTo).toBe(4);
    expect(metadata.sources[0].pages).toEqual([
      {
        pageNumber: 3,
        chunkPageIndex: 1,
        pdfWidth: null,
        pdfHeight: null,
        renderWidth: null,
        renderHeight: null,
        rotation: 0,
        mediaType: '',
      },
      {
        pageNumber: 4,
        chunkPageIndex: 2,
        pdfWidth: null,
        pdfHeight: null,
        renderWidth: null,
        renderHeight: null,
        rotation: 0,
        mediaType: '',
      },
    ]);
  });

  test('merges page metadata from multiple project parts', () => {
    const metadata = mergeDocumentPageMetadata([
      {
        pageMetadata: buildDocumentPageMetadata({
          batchFileName: 'part-a.pdf',
          pageFrom: 1,
          pageTo: 2,
          totalPages: 5,
        }),
      },
      {
        pageMetadata: buildDocumentPageMetadata({
          batchFileName: 'part-b.pdf',
          pageFrom: 3,
          pageTo: 4,
          totalPages: 5,
        }),
      },
    ]);

    expect(metadata.sources).toHaveLength(2);
    expect(metadata.sources[0].batchFileName).toBe('part-a.pdf');
    expect(metadata.sources[1].batchFileName).toBe('part-b.pdf');
  });

  test('merges page metadata from the same batch file into one source', () => {
    const metadata = mergeDocumentPageMetadata([
      {
        pageMetadata: buildDocumentPageMetadata({
          batchFileName: 'case.pdf',
          projectId: 'proj_1',
          pageFrom: 1,
          pageTo: 1,
          totalPages: 3,
        }),
      },
      {
        pageMetadata: buildDocumentPageMetadata({
          batchFileName: 'case.pdf',
          projectId: 'proj_1',
          pageFrom: 2,
          pageTo: 2,
          totalPages: 3,
        }),
      },
    ]);

    expect(metadata.sources).toHaveLength(1);
    expect(metadata.sources[0].pageFrom).toBe(1);
    expect(metadata.sources[0].pageTo).toBe(2);
    expect(metadata.sources[0].pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(metadata.sources[0].pages.map((page) => page.chunkPageIndex)).toEqual([1, 2]);
  });
});
