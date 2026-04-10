import React, { useState } from 'react';
import { usePdFragmentPatchPreview } from '../hooks/usePdFragmentPatchPreview';
import PdFragmentPatchDetails from './PdFragmentPatchDetails';

export default function PdFragmentEditorModal({
  fragment,
  onClose,
  onSave,
  onRevealMatch,
  canRevealMatch,
  previewPageImage,
  onApplyPreview,
}) {
  const [text, setText] = useState(fragment?.text || '');
  const {
    normalizedText,
    patchPlan,
    patchRegion,
    canBuildPreview,
    previewError,
    previewLoading,
    previewState,
    handleBuildPreview,
  } = usePdFragmentPatchPreview({
    fragment,
    text,
    previewPageImage,
  });

  const handleSave = () => {
    if (!normalizedText) return;
    onSave({ id: fragment.id, text: normalizedText, patchPlan });
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 680 }}>
        <div className="modal-title">Исправить текст фрагмента</div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="modal-label">Текст в документе</label>
            <input className="modal-input" value={text} onChange={e => setText(e.target.value)} autoFocus />
          </div>
          <PdFragmentPatchDetails
            fragment={fragment}
            patchRegion={patchRegion}
            patchPlan={patchPlan}
            canRevealMatch={canRevealMatch}
            onRevealMatch={onRevealMatch}
            canBuildPreview={canBuildPreview}
            onBuildPreview={handleBuildPreview}
            previewLoading={previewLoading}
            previewPageImage={previewPageImage}
            previewError={previewError}
            previewState={previewState}
            onApplyPreview={onApplyPreview}
          />
          {fragment?.pdItem && (
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>
              Изменение будет применено к текущему фрагменту и добавлено в mentions этой записи ПД.
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-primary btn-sm" onClick={handleSave}>Сохранить</button>
          <button className="btn-tool" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
