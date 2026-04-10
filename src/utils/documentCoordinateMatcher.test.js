import { findBestCoordinateMatch, findCoordinateMatches } from './documentCoordinateMatcher';

const coordinateLayer = {
  version: 1,
  provider: 'pdfjs-text-content',
  pages: [
    {
      pageNumber: 1,
      spans: [
        { index: 1, text: 'Приговор', searchText: 'Приговор', x: 10, top: 10, right: 70, bottom: 24 },
        { index: 2, text: 'Иванов', searchText: 'Иванов', x: 10, top: 40, right: 55, bottom: 52 },
        { index: 3, text: 'И.И.', searchText: 'И.И.', x: 58, top: 40, right: 86, bottom: 52 },
        { index: 4, text: ',', searchText: ',', x: 87, top: 40, right: 90, bottom: 52 },
        { index: 5, text: 'проживает', searchText: 'проживает', x: 94, top: 40, right: 160, bottom: 52 },
      ],
    },
    {
      pageNumber: 2,
      spans: [
        { index: 1, text: 'Иванов', searchText: 'Иванов', x: 12, top: 18, right: 58, bottom: 30 },
        { index: 2, text: 'И.И.', searchText: 'И.И.', x: 60, top: 18, right: 89, bottom: 30 },
        { index: 3, text: 'пояснил', searchText: 'пояснил', x: 92, top: 18, right: 146, bottom: 30 },
      ],
    },
  ],
};

describe('documentCoordinateMatcher', () => {
  test('finds exact match across multiple spans on a page', () => {
    const match = findBestCoordinateMatch({
      fragmentText: 'Иванов И.И.',
      coordinateLayer,
    });

    expect(match).toMatchObject({
      pageNumber: 1,
      matchMode: 'exact',
      spanStartIndex: 2,
      spanEndIndex: 3,
      spanCount: 2,
      bbox: {
        left: 10,
        top: 40,
        right: 86,
        bottom: 52,
      },
    });
  });

  test('matches text with punctuation across multiple spans', () => {
    const match = findBestCoordinateMatch({
      fragmentText: 'Иванов И.И., проживает',
      coordinateLayer,
    });

    expect(match).toMatchObject({
      pageNumber: 1,
      spanStartIndex: 2,
      spanEndIndex: 5,
    });
  });

  test('prefers the hinted page when the same fragment repeats', () => {
    const match = findBestCoordinateMatch({
      fragmentText: 'Иванов И.И.',
      coordinateLayer,
      preferredPageNumber: 2,
    });

    expect(match).toMatchObject({
      pageNumber: 2,
      spanStartIndex: 1,
      spanEndIndex: 2,
    });
  });

  test('returns multiple matches ordered by score and page', () => {
    const matches = findCoordinateMatches({
      fragmentText: 'Иванов И.И.',
      coordinateLayer,
      maxMatches: 3,
    });

    expect(matches).toHaveLength(2);
    expect(matches[0].pageNumber).toBe(1);
    expect(matches[1].pageNumber).toBe(2);
  });

  test('returns no matches for empty layer or fragment', () => {
    expect(findCoordinateMatches({ fragmentText: '', coordinateLayer })).toEqual([]);
    expect(findCoordinateMatches({ fragmentText: 'Иванов', coordinateLayer: null })).toEqual([]);
  });
});
