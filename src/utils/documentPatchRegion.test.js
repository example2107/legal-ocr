import { buildPatchRegion } from './documentPatchRegion';

describe('documentPatchRegion', () => {
  const coordinateMatch = {
    pageNumber: 4,
    spanStartIndex: 3,
    spanEndIndex: 4,
    spanCount: 2,
    matchedText: 'Иванов И.И.',
    searchText: 'Иванов И.И.',
    bbox: {
      left: 100,
      top: 200,
      right: 180,
      bottom: 214,
    },
  };

  test('builds patch region metrics for replacement text', () => {
    const region = buildPatchRegion({
      coordinateMatch,
      originalText: 'Иванов И.И.',
      replacementText: 'Петров П.П.',
    });

    expect(region).toMatchObject({
      pageNumber: 4,
      spanStartIndex: 3,
      spanEndIndex: 4,
      sourceRect: {
        left: 100,
        top: 200,
        right: 180,
        bottom: 214,
        width: 80,
        height: 14,
      },
      estimated: {
        likelyFits: true,
      },
    });
    expect(region.paddedRect.left).toBeLessThan(region.sourceRect.left);
    expect(region.paddedRect.right).toBeGreaterThan(region.sourceRect.right);
  });

  test('marks obviously longer replacement as risky', () => {
    const region = buildPatchRegion({
      coordinateMatch,
      originalText: 'Иванов И.И.',
      replacementText: 'Очень длинная замена текста для того же участка',
    });

    expect(region.estimated.likelyFits).toBe(false);
    expect(region.estimated.fitRatio).toBeGreaterThan(1.12);
  });

  test('returns null when there is no match bbox', () => {
    expect(buildPatchRegion({ coordinateMatch: null, replacementText: 'abc' })).toBeNull();
  });
});
