const PATCH_PLAN_VERSION = 1;

function buildWarnings({ coordinateMatch, patchRegion }) {
  const warnings = [];

  if (coordinateMatch?.matchMode && coordinateMatch.matchMode !== 'exact') {
    warnings.push('Совпадение с текстом найдено не точно, а по приближённому поиску.');
  }
  if (patchRegion?.estimated?.likelyFits === false) {
    warnings.push('Новый текст может не поместиться в исходную область без переразметки.');
  }
  if ((coordinateMatch?.spanCount || 0) > 4) {
    warnings.push('Фрагмент занимает несколько span-ов, локальная замена может потребовать дополнительной проверки.');
  }

  return warnings;
}

export function buildPatchPlan({
  documentId = null,
  fragmentId = null,
  originalText = '',
  replacementText = '',
  coordinateMatch = null,
  patchRegion = null,
  pageMetadataSource = null,
} = {}) {
  if (!coordinateMatch || !patchRegion) {
    return {
      version: PATCH_PLAN_VERSION,
      kind: 'text-replace',
      status: 'unsupported',
      canApplyDirectly: false,
      reason: 'Не удалось определить координаты текстового фрагмента на странице PDF.',
      warnings: [],
      documentId,
      fragmentId,
      originalText,
      replacementText,
      pageNumber: null,
      sourceFile: pageMetadataSource?.sourceFile || null,
      operations: [],
    };
  }

  const warnings = buildWarnings({ coordinateMatch, patchRegion });
  const status = patchRegion.estimated?.likelyFits === false ? 'review_required' : 'ready';

  return {
    version: PATCH_PLAN_VERSION,
    kind: 'text-replace',
    status,
    canApplyDirectly: status === 'ready',
    reason: status === 'ready'
      ? 'Фрагмент можно пробовать заменить локально в пределах найденной области.'
      : 'Замена найдена, но перед локальной перерисовкой нужна проверка вместимости.',
    warnings,
    documentId,
    fragmentId,
    originalText,
    replacementText,
    pageNumber: coordinateMatch.pageNumber,
    sourceFile: pageMetadataSource?.sourceFile || null,
    pageRange: pageMetadataSource
      ? {
          pageFrom: pageMetadataSource.pageFrom || null,
          pageTo: pageMetadataSource.pageTo || null,
          totalPages: pageMetadataSource.totalPages || null,
        }
      : null,
    match: {
      mode: coordinateMatch.matchMode,
      score: coordinateMatch.score,
      spanStartIndex: coordinateMatch.spanStartIndex,
      spanEndIndex: coordinateMatch.spanEndIndex,
      spanCount: coordinateMatch.spanCount,
    },
    region: patchRegion,
    operations: [
      {
        type: 'clear-rect',
        pageNumber: coordinateMatch.pageNumber,
        rect: patchRegion.paddedRect,
      },
      {
        type: 'draw-text',
        pageNumber: coordinateMatch.pageNumber,
        text: replacementText,
        rect: patchRegion.paddedRect,
        baselineY: coordinateMatch.spans?.[0]?.baselineY ?? null,
      },
    ],
  };
}
