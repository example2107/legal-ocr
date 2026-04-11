import React, { useState } from 'react';

function normalizePdText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export default function PdRecordEditorModal({ pdItem, onClose, onSave }) {
  const isPerson = Object.prototype.hasOwnProperty.call(pdItem || {}, 'fullName');
  const [fullName, setFullName] = useState(pdItem?.fullName || '');
  const [role, setRole] = useState(pdItem?.role || '');
  const [value, setValue] = useState(pdItem?.value || '');

  const handleSave = () => {
    if (isPerson) {
      const nextFullName = normalizePdText(fullName);
      if (!nextFullName) return;
      onSave({
        id: pdItem.id,
        fullName: nextFullName,
        role,
      });
      return;
    }

    const nextValue = normalizePdText(value);
    if (!nextValue) return;
    onSave({
      id: pdItem.id,
      value: nextValue,
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-title">Редактирование ПД</div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {isPerson ? (
            <>
              <div>
                <label className="modal-label">ФИО</label>
                <input className="modal-input" value={fullName} onChange={(event) => setFullName(event.target.value)} />
              </div>
              <div>
                <label className="modal-label">Роль</label>
                <input className="modal-input" value={role} onChange={(event) => setRole(event.target.value)} />
              </div>
            </>
          ) : (
            <div>
              <label className="modal-label">Основное значение</label>
              <input className="modal-input" value={value} onChange={(event) => setValue(event.target.value)} />
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
