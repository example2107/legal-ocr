import React, { useEffect, useMemo, useRef, useState } from 'react';
import AddPdForm from './AddPdForm';

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

function buildExistingSections(existingPD, includeOtherItems) {
  const privatePersons = existingPD?.persons?.filter((person) => person.category === 'private') || [];
  const professionalPersons = existingPD?.persons?.filter((person) => person.category === 'professional') || [];
  const otherItems = includeOtherItems ? (existingPD?.otherPD || []) : [];

  const sections = [];
  if (privatePersons.length > 0) {
    sections.push({ key: 'private', title: 'Частные лица', items: privatePersons, showLetter: true, letterClassName: 'ctx-menu-pd-letter' });
  }
  if (professionalPersons.length > 0) {
    sections.push({
      key: 'professional',
      title: 'Профучастники',
      items: professionalPersons,
      showLetter: true,
      letterClassName: 'ctx-menu-pd-letter ctx-menu-pd-letter-prof',
    });
  }
  if (otherItems.length > 0) {
    sections.push({ key: 'other', title: 'Другие ПД', items: otherItems, showLetter: false, letterClassName: '' });
  }

  return sections;
}

function ExistingPdSection({ section, onAttach }) {
  return (
    <>
      <div className="ctx-menu-group-label">{section.title}</div>
      {section.items.map((item) => (
        <div key={item.id} className="ctx-menu-item ctx-menu-item-pd" onClick={() => onAttach(item.id)}>
          {section.showLetter && (
            <span className={section.letterClassName}>
              {item.letter}
            </span>
          )}
          <span className="ctx-menu-pd-name">{item.fullName || item.value || item.type}</span>
        </div>
      ))}
    </>
  );
}

function PdMenuContent({ pdId, mark, onApplyPdCanonicalText, onEditPdText, onRemovePd, onClose }) {
  return (
    <>
      <div className="ctx-menu-item" onClick={() => { onApplyPdCanonicalText?.(pdId, mark); onClose(); }}>
        Принять вид из панели ПД
      </div>
      <div className="ctx-menu-item" onClick={() => { onEditPdText?.(pdId, mark); onClose(); }}>
        Исправить текст фрагмента
      </div>
      <div className="ctx-menu-item ctx-menu-item-danger" onClick={onRemovePd}>
        Не является ПД
      </div>
    </>
  );
}

function UncertainMenuContent({ suggestion, onApplySuggestion, onRemoveUncertain }) {
  return (
    <>
      {suggestion && (
        <div className="ctx-menu-item ctx-menu-item-accent" onClick={onApplySuggestion}>
          ✏️ Заменить на: <strong>{suggestion}</strong>
        </div>
      )}
      <div className="ctx-menu-item" onClick={onRemoveUncertain}>
        Исправлено — снять выделение
      </div>
    </>
  );
}

function AttachMenuContent({
  title,
  sections,
  addLabel,
  allowRemoveUncertain,
  onAttachPd,
  onOpenAddForm,
  onRemoveUncertain,
  onClose,
}) {
  return (
    <>
      {sections.length > 0 && (
        <>
          <div className="ctx-menu-section-title">{title}</div>
          {sections.map((section) => (
            <ExistingPdSection
              key={section.key}
              section={section}
              onAttach={(id) => {
                onAttachPd(id);
                onClose();
              }}
            />
          ))}
          <div className="ctx-menu-divider" />
        </>
      )}
      <div className="ctx-menu-item" onClick={onOpenAddForm}>
        {addLabel}
      </div>
      {allowRemoveUncertain && (
        <div className="ctx-menu-item" onClick={onRemoveUncertain}>
          Снять пометку
        </div>
      )}
    </>
  );
}

export default function EditorContextMenu({
  x,
  y,
  type,
  suggestion,
  pdId,
  mark,
  existingPD,
  onRemovePd,
  onApplyPdCanonicalText,
  onEditPdText,
  onRemoveUncertain,
  onApplySuggestion,
  onAttachPd,
  onAddNewPd,
  onClose,
}) {
  const menuRef = useRef(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    const handleMouseDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  useEffect(() => {
    positionFloatingMenu(menuRef.current, x, y);
  });

  const isAmbiguous = type === 'ambiguous';
  const isSelection = type === 'selection';
  const sections = useMemo(
    () => buildExistingSections(existingPD, isSelection),
    [existingPD, isSelection],
  );

  if (showAddForm) {
    const allowedCategories = isAmbiguous ? ['private', 'professional'] : ['private', 'professional', 'other'];
    return <AddPdForm x={x} y={y} onAdd={onAddNewPd} onClose={onClose} categories={allowedCategories} />;
  }

  const contentByType = {
    pd: (
      <PdMenuContent
        pdId={pdId}
        mark={mark}
        onApplyPdCanonicalText={onApplyPdCanonicalText}
        onEditPdText={onEditPdText}
        onRemovePd={onRemovePd}
        onClose={onClose}
      />
    ),
    uncertain: (
      <UncertainMenuContent
        suggestion={suggestion}
        onApplySuggestion={onApplySuggestion}
        onRemoveUncertain={onRemoveUncertain}
      />
    ),
    ambiguous: (
      <AttachMenuContent
        title="Привязать к существующему лицу"
        sections={sections}
        addLabel="+ Создать новое лицо"
        allowRemoveUncertain
        onAttachPd={onAttachPd}
        onOpenAddForm={() => setShowAddForm(true)}
        onRemoveUncertain={onRemoveUncertain}
        onClose={onClose}
      />
    ),
    selection: (
      <AttachMenuContent
        title="Привязать к существующему"
        sections={sections}
        addLabel="+ Добавить новое ПД"
        allowRemoveUncertain={false}
        onAttachPd={onAttachPd}
        onOpenAddForm={() => setShowAddForm(true)}
        onRemoveUncertain={onRemoveUncertain}
        onClose={onClose}
      />
    ),
  };

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ position: 'fixed', top: y + 4, left: x, zIndex: 9999 }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {contentByType[type] || null}
    </div>
  );
}
