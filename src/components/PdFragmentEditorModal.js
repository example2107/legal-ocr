import React, { useState } from 'react';

export default function PdFragmentEditorModal({
  fragment,
  onClose,
  onSave,
}) {
  const [text, setText] = useState(fragment?.text || '');
  const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();

  const handleSave = () => {
    if (!normalizedText) return;
    onSave({ id: fragment.id, text: normalizedText });
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
