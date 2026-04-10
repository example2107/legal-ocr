import { buildPatchPlan } from './documentPatchPlan';

const coordinateMatch = {
  pageNumber: 7,
  matchMode: 'exact',
  score: 1,
  spanStartIndex: 10,
  spanEndIndex: 11,
  spanCount: 2,
  spans: [{ baselineY: 412.5 }],
};

const patchRegion = {
  pageNumber: 7,
  sourceRect: { left: 100, top: 400, right: 180, bottom: 414, width: 80, height: 14 },
  paddedRect: { left: 98, top: 397, right: 182, bottom: 417 },
  estimated: {
    likelyFits: true,
    fitRatio: 0.94,
  },
};

describe('documentPatchPlan', () => {
  test('builds ready patch plan for directly applicable replacement', () => {
    const plan = buildPatchPlan({
      documentId: 'doc_1',
      fragmentId: 'pd_1',
      originalText: 'Иванов И.И.',
      replacementText: 'Петров П.П.',
      coordinateMatch,
      patchRegion,
      pageMetadataSource: {
        sourceFile: { name: 'case.pdf', storagePath: 'u/p/case.pdf' },
        pageFrom: 6,
        pageTo: 10,
        totalPages: 63,
      },
    });

    expect(plan).toMatchObject({
      version: 1,
      kind: 'text-replace',
      status: 'ready',
      canApplyDirectly: true,
      pageNumber: 7,
      sourceFile: { name: 'case.pdf', storagePath: 'u/p/case.pdf' },
      match: {
        mode: 'exact',
        spanStartIndex: 10,
        spanEndIndex: 11,
      },
      operations: [
        {
          type: 'clear-rect',
          pageNumber: 7,
        },
        {
          type: 'draw-text',
          pageNumber: 7,
          text: 'Петров П.П.',
          baselineY: 412.5,
        },
      ],
    });
    expect(plan.warnings).toEqual([]);
  });

  test('marks risky replacement as review required', () => {
    const plan = buildPatchPlan({
      originalText: 'Короткий текст',
      replacementText: 'Очень длинный текст замены',
      coordinateMatch: { ...coordinateMatch, matchMode: 'loose', spanCount: 5 },
      patchRegion: {
        ...patchRegion,
        estimated: { likelyFits: false, fitRatio: 1.4 },
      },
    });

    expect(plan.status).toBe('review_required');
    expect(plan.canApplyDirectly).toBe(false);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  test('returns unsupported plan when no coordinates are available', () => {
    const plan = buildPatchPlan({
      originalText: 'Текст',
      replacementText: 'Новый текст',
      coordinateMatch: null,
      patchRegion: null,
    });

    expect(plan).toMatchObject({
      status: 'unsupported',
      canApplyDirectly: false,
      pageNumber: null,
      operations: [],
    });
  });
});
