import { buildDocumentCoordinateLayer } from './documentCoordinateLayer';
import { buildDocumentPageMetadata } from './documentPageMetadata';
import { buildProjectBatchDocumentEntry } from './projectDocumentOps';

describe('projectDocumentOps', () => {
  test('builds one growing batch document without part separators', () => {
    const firstPage = {
      id: 'doc_1',
      title: 'case.pdf',
      originalFileName: 'case.pdf',
      text: 'Первая страница',
      editedHtml: '<div class="page-separator" data-page="1">Страница 1</div><p>Первая страница</p>',
      personalData: { persons: [{ id: 'p1', fullName: 'Иванов И.И.', mentions: ['Иванов И.И.'], category: 'private', letter: 'А.' }], otherPD: [] },
      anonymized: {},
      projectId: 'proj_1',
      pageFrom: 1,
      pageTo: 1,
      totalPages: 3,
      batchFileName: 'case.pdf',
      sourceFiles: [{ name: 'case.pdf', storagePath: 'u/p/case.pdf' }],
      pageMetadata: buildDocumentPageMetadata({ batchFileName: 'case.pdf', projectId: 'proj_1', pageFrom: 1, pageTo: 1, totalPages: 3 }),
      coordinateLayer: buildDocumentCoordinateLayer({ pages: [{ pageNum: 1, textItems: [{ str: 'Первая', transform: [12, 0, 0, 12, 10, 20], width: 20, height: 12 }] }] }),
    };
    const secondPage = {
      id: 'doc_2',
      title: 'case.pdf',
      originalFileName: 'case.pdf',
      text: 'Вторая страница',
      editedHtml: '<div class="page-separator" data-page="2">Страница 2</div><p>Вторая страница</p>',
      personalData: firstPage.personalData,
      anonymized: {},
      projectId: 'proj_1',
      pageFrom: 2,
      pageTo: 2,
      totalPages: 3,
      batchFileName: 'case.pdf',
      sourceFiles: [{ name: 'case.pdf', storagePath: 'u/p/case.pdf' }],
      pageMetadata: buildDocumentPageMetadata({ batchFileName: 'case.pdf', projectId: 'proj_1', pageFrom: 2, pageTo: 2, totalPages: 3 }),
      coordinateLayer: buildDocumentCoordinateLayer({ pages: [{ pageNum: 2, textItems: [{ str: 'Вторая', transform: [12, 0, 0, 12, 10, 20], width: 20, height: 12 }] }] }),
    };

    const merged = buildProjectBatchDocumentEntry({
      existingDoc: firstPage,
      pageEntry: secondPage,
      currentProjectId: 'proj_1',
      pd: firstPage.personalData,
      getOtherPdMentions: (item) => [item?.value, ...(item?.mentions || [])].filter(Boolean),
    });

    expect(merged.source).toBe('project-batch');
    expect(merged.pageFrom).toBe(1);
    expect(merged.pageTo).toBe(2);
    expect(merged.text).toContain('Первая страница');
    expect(merged.text).toContain('Вторая страница');
    expect(merged.editedHtml).not.toContain('part-separator');
    expect(merged.pageMetadata.sources).toHaveLength(1);
    expect(merged.pageMetadata.sources[0].pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(merged.coordinateLayer.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
  });
});
