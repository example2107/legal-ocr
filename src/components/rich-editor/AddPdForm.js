import React, { useEffect, useRef, useState } from 'react';
import { OTHER_PD_TYPES } from './richEditorToolbarConfig';

function positionFloatingMenu(element, x, y) {
  if (!element) return;

  const rect = element.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) {
    element.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
  }
  if (rect.bottom > window.innerHeight - 8) {
    element.style.top = `${Math.max(8, y - rect.height - 8)}px`;
  }
}

export default function AddPdForm({
  x,
  y,
  onAdd,
  onClose,
  categories = ['private', 'professional', 'other'],
}) {
  const defaultCategory = categories.includes('private') ? 'private' : categories[0];
  const [category, setCategory] = useState(defaultCategory);
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('');
  const [otherType, setOtherType] = useState('address');
  const [otherCustom, setOtherCustom] = useState('');
  const formRef = useRef(null);

  useEffect(() => {
    const handleMouseDown = (event) => {
      if (formRef.current && !formRef.current.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  useEffect(() => {
    positionFloatingMenu(formRef.current, x, y);
  });

  const handleSubmit = () => {
    if (category === 'private' || category === 'professional') {
      if (!fullName.trim()) return;
      onAdd({
        category,
        fullName: fullName.trim(),
        role: role.trim(),
      });
    } else {
      const type = otherType === 'other' ? (otherCustom.trim() || 'other') : otherType;
      onAdd({ category: 'other', type });
    }

    onClose();
  };

  return (
    <div
      ref={formRef}
      className="ctx-menu"
      style={{ position: 'fixed', top: y + 4, left: x, zIndex: 9999, width: 240 }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="ctx-menu-title">Добавить ПД</div>
      <div className="ctx-form-body">
        <div className="ctx-form-row">
          <label className="ctx-form-label">Тип</label>
          <select className="ctx-form-select" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="private">Частное лицо</option>
            <option value="professional">Профучастник</option>
            <option value="other">Другое</option>
          </select>
        </div>

        {(category === 'private' || category === 'professional') && (
          <>
            <div className="ctx-form-row">
              <label className="ctx-form-label">Фамилия и инициалы</label>
              <input
                className="ctx-form-input"
                placeholder="Иванов И.И."
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && handleSubmit()}
                autoFocus
              />
            </div>
            <div className="ctx-form-row">
              <label className="ctx-form-label">Роль</label>
              <input
                className="ctx-form-input"
                placeholder="свидетель, заявитель…"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && handleSubmit()}
              />
            </div>
          </>
        )}

        {category === 'other' && (
          <>
            <div className="ctx-form-row">
              <label className="ctx-form-label">Вид данных</label>
              <select className="ctx-form-select" value={otherType} onChange={(event) => setOtherType(event.target.value)}>
                {OTHER_PD_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {otherType === 'other' && (
              <div className="ctx-form-row">
                <label className="ctx-form-label">Описание</label>
                <input
                  className="ctx-form-input"
                  placeholder="Укажите тип данных"
                  value={otherCustom}
                  onChange={(event) => setOtherCustom(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && handleSubmit()}
                  autoFocus
                />
              </div>
            )}
          </>
        )}

        <button className="ctx-form-btn" onClick={handleSubmit}>
          Добавить
        </button>
      </div>
    </div>
  );
}
