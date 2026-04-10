import React from 'react';

function PatchSummary({ fragment, patchRegion, patchPlan }) {
  return (
    <>
      <div>
        Предполагаемое место в оригинальном PDF: стр. {fragment.coordinateMatch.pageNumber}
        {fragment.coordinateMatch.matchMode === 'exact' ? ' · точное совпадение' : ' · приблизительное совпадение'}.
      </div>
      {patchRegion && (
        <div>
          Область замены: {patchRegion.sourceRect.width ?? '?'} × {patchRegion.sourceRect.height ?? '?'} pt
          {patchRegion.estimated.likelyFits === true && ' · новый текст, вероятно, поместится'}
          {patchRegion.estimated.likelyFits === false && ' · новый текст может не поместиться в исходную строку'}
        </div>
      )}
      <div>
        Patch plan: {
          patchPlan.status === 'ready'
            ? 'готов к локальной замене'
            : patchPlan.status === 'review_required'
              ? 'требует ручной проверки'
              : 'пока не может быть построен'
        }.
      </div>
      {patchPlan.warnings?.length > 0 && (
        <div style={{ color: 'var(--text3)' }}>
          {patchPlan.warnings[0]}
        </div>
      )}
    </>
  );
}

function PatchPreviewBlock({
  fragment,
  patchPlan,
  canRevealMatch,
  onRevealMatch,
  canBuildPreview,
  onBuildPreview,
  previewLoading,
  previewPageImage,
  previewError,
  previewState,
  onApplyPreview,
}) {
  return (
    <>
      {canRevealMatch && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn-tool"
            type="button"
            onClick={() => onRevealMatch?.(fragment.coordinateMatch)}
          >
            Показать страницу в оригинале
          </button>
          {canBuildPreview && (
            <button
              className="btn-tool"
              type="button"
              onClick={onBuildPreview}
              disabled={previewLoading}
            >
              {previewLoading ? 'Собираю черновик...' : 'Собрать черновик замены'}
            </button>
          )}
        </div>
      )}
      {!canBuildPreview && previewPageImage && patchPlan.status !== 'unsupported' && (
        <div style={{ color: 'var(--text3)' }}>
          Для черновика замены пока не хватает геометрии страницы или области patch plan.
        </div>
      )}
      {!previewPageImage && patchPlan.status !== 'unsupported' && (
        <div style={{ color: 'var(--text3)' }}>
          Черновик замены будет доступен, когда страница оригинального PDF загружена в просмотрщик.
        </div>
      )}
      {previewError && (
        <div style={{ color: 'var(--danger, #b42318)' }}>
          {previewError}
        </div>
      )}
      {previewState?.dataUrl && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ color: 'var(--text2)' }}>
            Черновик локальной замены: стр. {previewState.pageNumber}, область {Math.round(previewState.imageRect.width || 0)} × {Math.round(previewState.imageRect.height || 0)} px.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn-primary btn-sm"
              type="button"
              onClick={() => onApplyPreview?.({ fragment, patchPlan, previewState })}
            >
              Применить в просмотрщик
            </button>
            {canRevealMatch && (
              <button
                className="btn-tool"
                type="button"
                onClick={() => onRevealMatch?.(fragment.coordinateMatch)}
              >
                Открыть страницу
              </button>
            )}
          </div>
          <img
            src={previewState.dataUrl}
            alt="Черновик локальной замены на странице PDF"
            style={{
              width: '100%',
              maxHeight: 320,
              objectFit: 'contain',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: '#fff',
            }}
          />
        </div>
      )}
    </>
  );
}

export default function PdFragmentPatchDetails({
  fragment,
  patchRegion,
  patchPlan,
  canRevealMatch,
  onRevealMatch,
  canBuildPreview,
  onBuildPreview,
  previewLoading,
  previewPageImage,
  previewError,
  previewState,
  onApplyPreview,
}) {
  if (!fragment?.coordinateMatch) {
    if (fragment?.hasCoordinateLayer) {
      return (
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          Для этого фрагмента координаты на странице пока не найдены.
        </div>
      );
    }
    return null;
  }

  return (
    <div style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PatchSummary
        fragment={fragment}
        patchRegion={patchRegion}
        patchPlan={patchPlan}
      />
      <PatchPreviewBlock
        fragment={fragment}
        patchPlan={patchPlan}
        canRevealMatch={canRevealMatch}
        onRevealMatch={onRevealMatch}
        canBuildPreview={canBuildPreview}
        onBuildPreview={onBuildPreview}
        previewLoading={previewLoading}
        previewPageImage={previewPageImage}
        previewError={previewError}
        previewState={previewState}
        onApplyPreview={onApplyPreview}
      />
    </div>
  );
}
