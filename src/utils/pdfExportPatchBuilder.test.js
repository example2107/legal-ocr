import { buildPdfExportPatchEntries } from './pdfExportPatchBuilder';

describe('buildPdfExportPatchEntries', () => {
  test('builds ready patch entry for anonymized mark with page separator context', () => {
    document.body.innerHTML = `
      <div id="editor">
        <div class="page-separator" data-page="2">Страница 2</div>
        <div>Текст <mark class="pd priv anon" data-pd-id="p_1" data-original="Иванов И.И.">А.</mark></div>
      </div>
    `;

    const editorEl = document.getElementById('editor');
    const entries = buildPdfExportPatchEntries({
      editorEl,
      anonymized: { p_1: true },
      pageMetadata: {
        sources: [{ pageFrom: 1, pageTo: 3, totalPages: 3 }],
      },
      coordinateLayer: {
        pages: [
          {
            pageNumber: 2,
            spans: [
              {
                index: 1,
                text: 'Иванов',
                searchText: 'Иванов',
                x: 10,
                top: 10,
                right: 40,
                bottom: 20,
              },
              {
                index: 2,
                text: 'И.И.',
                searchText: 'И.И.',
                x: 42,
                top: 10,
                right: 60,
                bottom: 20,
              },
            ],
          },
        ],
      },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].pageNumber).toBe(2);
    expect(entries[0].patchPlan.status).toBe('ready');
    expect(entries[0].patchPlan.replacementText).toBe('А.');
  });

  test('returns unsupported patch entry when coordinates are unavailable', () => {
    document.body.innerHTML = `
      <div id="editor">
        <div><mark class="pd oth anon" data-pd-id="pd_1" data-original="г. Самара">[адрес]</mark></div>
      </div>
    `;

    const editorEl = document.getElementById('editor');
    const entries = buildPdfExportPatchEntries({
      editorEl,
      anonymized: { pd_1: true },
      coordinateLayer: null,
      pageMetadata: null,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].patchPlan.status).toBe('unsupported');
  });

  test('uses absolute page number from page separator without adding source offset again', () => {
    document.body.innerHTML = `
      <div id="editor">
        <div class="page-separator" data-page="11">Страница 11</div>
        <div>Адрес <mark class="pd oth anon" data-pd-id="pd_2" data-original="г. Уфа">[адрес]</mark></div>
      </div>
    `;

    const editorEl = document.getElementById('editor');
    const entries = buildPdfExportPatchEntries({
      editorEl,
      anonymized: { pd_2: true },
      pageMetadata: {
        sources: [{ pageFrom: 11, pageTo: 11, totalPages: 63 }],
      },
      coordinateLayer: {
        pages: [
          {
            pageNumber: 11,
            spans: [
              { index: 1, text: 'г.', searchText: 'г.', x: 10, top: 10, right: 18, bottom: 20 },
              { index: 2, text: 'Уфа', searchText: 'Уфа', x: 20, top: 10, right: 42, bottom: 20 },
            ],
          },
        ],
      },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].pageNumber).toBe(11);
    expect(entries[0].patchPlan.status).not.toBe('unsupported');
  });
});
