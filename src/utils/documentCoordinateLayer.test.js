import {
  buildDocumentCoordinateLayer,
  mergeDocumentCoordinateLayer,
  normalizeDocumentCoordinateLayer,
} from './documentCoordinateLayer';

describe('documentCoordinateLayer', () => {
  test('builds coordinate layer from pdf.js text items', () => {
    const layer = buildDocumentCoordinateLayer({
      pages: [
        {
          pageNum: 2,
          pdfWidth: 595,
          pdfHeight: 842,
          rotation: 0,
          textSource: 'pdfjs-text-content',
          textItems: [
            {
              str: 'Иванов И.И.',
              dir: 'ltr',
              transform: [12, 0, 0, 12, 100, 200],
              width: 64.2,
              height: 12,
              fontName: 'f1',
              hasEOL: false,
            },
            {
              str: ' ',
              dir: 'ltr',
              transform: [12, 0, 0, 12, 165, 200],
              width: 3,
              height: 12,
              fontName: 'f1',
              hasEOL: false,
            },
          ],
        },
      ],
    });

    expect(layer).toEqual({
      version: 1,
      provider: 'pdfjs-text-content',
      pages: [
        {
          pageNumber: 2,
          chunkPageIndex: 1,
          pdfWidth: 595,
          pdfHeight: 842,
          rotation: 0,
          textSource: 'pdfjs-text-content',
          hasText: true,
          spanCount: 1,
          spans: [
            {
              index: 1,
              text: 'Иванов И.И.',
              searchText: 'Иванов И.И.',
              dir: 'ltr',
              fontName: 'f1',
              hasEOL: false,
              x: 100,
              baselineY: 200,
              top: 188,
              width: 64.2,
              height: 12,
              right: 164.2,
              bottom: 200,
              transform: [12, 0, 0, 12, 100, 200],
            },
          ],
        },
      ],
    });
  });

  test('normalizes persisted coordinate layer and keeps empty pages', () => {
    const layer = normalizeDocumentCoordinateLayer({
      coordinateLayer: {
        provider: 'pdfjs-text-content',
        pages: [
          {
            pageNumber: 1,
            pdfWidth: 595,
            pdfHeight: 842,
            textSource: 'missing-text-layer',
            spans: [],
          },
        ],
      },
    });

    expect(layer.pages[0]).toEqual({
      pageNumber: 1,
      chunkPageIndex: 1,
      pdfWidth: 595,
      pdfHeight: 842,
      rotation: 0,
      textSource: 'missing-text-layer',
      hasText: false,
      spanCount: 0,
      spans: [],
    });
  });

  test('merges coordinate pages from multiple documents', () => {
    const layer = mergeDocumentCoordinateLayer([
      {
        coordinateLayer: {
          provider: 'pdfjs-text-content',
          pages: [{ pageNumber: 1, spans: [{ index: 1, text: 'A', searchText: 'A' }] }],
        },
      },
      {
        coordinateLayer: {
          provider: 'pdfjs-text-content',
          pages: [{ pageNumber: 2, spans: [{ index: 1, text: 'B', searchText: 'B' }] }],
        },
      },
    ]);

    expect(layer.pages).toHaveLength(2);
    expect(layer.pages[0].pageNumber).toBe(1);
    expect(layer.pages[1].pageNumber).toBe(2);
  });
});
