import React, { useRef, useEffect, useCallback } from 'react';
import './RichEditor.css';

// ── Toolbar config ─────────────────────────────────────────────────────────────
const TOOLBAR = [
  {
    group: 'inline',
    items: [
      { cmd: 'bold',      icon: 'B', title: 'Жирный (Ctrl+B)',       style: { fontWeight: 700 } },
      { cmd: 'italic',    icon: 'К', title: 'Курсив (Ctrl+I)',        style: { fontStyle: 'italic' } },
      { cmd: 'underline', icon: 'П', title: 'Подчёркнутый (Ctrl+U)', style: { textDecoration: 'underline' } },
    ],
  },
  { type: 'sep' },
  {
    group: 'align',
    items: [
      { cmd: 'justifyLeft',   svg: 'align-left',    title: 'По левому краю' },
      { cmd: 'justifyCenter', svg: 'align-center',  title: 'По центру' },
      { cmd: 'justifyRight',  svg: 'align-right',   title: 'По правому краю' },
      { cmd: 'justifyFull',   svg: 'align-justify', title: 'По ширине' },
    ],
  },
  { type: 'sep' },
  {
    group: 'lists',
    items: [
      { cmd: 'insertOrderedList',   svg: 'list-ol', title: 'Нумерованный список' },
      { cmd: 'insertUnorderedList', svg: 'list-ul', title: 'Маркированный список' },
    ],
  },
  { type: 'sep' },
  {
    group: 'indent',
    items: [
      { cmd: 'outdent', svg: 'outdent', title: 'Уменьшить отступ (Shift+Tab)' },
      { cmd: 'indent',  svg: 'indent',  title: 'Увеличить отступ (Tab)' },
    ],
  },
  { type: 'sep' },
  {
    group: 'clear',
    items: [
      { cmd: 'removeFormat', svg: 'clear-format', title: 'Убрать форматирование' },
    ],
  },
];

// ── SVG icons ──────────────────────────────────────────────────────────────────
const ICONS = {
  'align-left': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
    </svg>
  ),
  'align-center': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm2-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
    </svg>
  ),
  'align-right': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-4-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm4-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-4-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
    </svg>
  ),
  'align-justify': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 12.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
    </svg>
  ),
  'list-ol': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5z"/>
      <path d="M1.713 11.865v-.474H2c.217 0 .363-.137.363-.317 0-.185-.158-.31-.361-.31-.223 0-.367.152-.373.31h-.59c.016-.467.373-.787.986-.787.588-.002.954.291.957.703a.595.595 0 0 1-.492.594v.033a.615.615 0 0 1 .569.631c.003.533-.502.8-1.051.8-.656 0-1-.37-1.008-.794h.582c.008.178.186.306.422.309.254 0 .424-.145.422-.35-.002-.195-.155-.348-.414-.348h-.3zm-.004-4.699h-.604v-.035c0-.408.295-.844.958-.844.583 0 .96.326.96.756 0 .389-.257.617-.476.848l-.537.572v.03h1.054V9H1.143v-.395l.957-.99c.138-.142.293-.304.293-.508 0-.18-.147-.32-.342-.32a.33.33 0 0 0-.342.338v.041zM2.564 5h-.563v-2.5h-.018l-.51.317v-.51L1.978 2h.586V5z"/>
    </svg>
  ),
  'list-ul': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5z"/>
      <path d="M2 13.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0-4a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0-4a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
    </svg>
  ),
  // New clean indent icons: lines + arrow direction
  'outdent': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 2h12v1.5H2V2zm0 10.5h12V14H2v-1.5zm4-5.25h8V8.75H6V7.25zM4.5 8 2 5.5v5L4.5 8z"/>
    </svg>
  ),
  'indent': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 2h12v1.5H2V2zm0 10.5h12V14H2v-1.5zm4-5.25h8V8.75H6V7.25zM2 5.5 4.5 8 2 10.5v-5z"/>
    </svg>
  ),
  'clear-format': (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M8.21 1.073a.5.5 0 0 1 .7-.077l5 4a.5.5 0 0 1-.626.782L8.977 2.06 2.825 8h2.656l.96 3.2.786-.393a.5.5 0 0 1 .448.894l-1.5.75a.5.5 0 0 1-.673-.227L3.6 8.8H.5a.5.5 0 0 1-.39-.811L8.21 1.073z"/>
      <path d="M10.854 9.146a.5.5 0 0 0-.707 0L9 10.293 7.854 9.146a.5.5 0 0 0-.707.707L8.293 11l-1.146 1.146a.5.5 0 0 0 .707.708L9 11.707l1.146 1.147a.5.5 0 0 0 .708-.708L9.707 11l1.147-1.146a.5.5 0 0 0 0-.708z"/>
    </svg>
  ),
};


export { buildAnnotatedHtml, buildPdMatchPattern, htmlToPlainText } from '../utils/richEditorAnnotations';

// ── Patch existing PD marks in DOM without rebuilding entire HTML ──────────────
// This is the key fix: instead of replacing innerHTML, we surgically update
// Знаки после которых НЕ ставим пробел перед маркером
const NO_SPACE_BEFORE_MARK = /[\s(\[«"']/;
// Знаки перед которыми НЕ ставим пробел после маркера
const NO_SPACE_AFTER_MARK  = /^[\s)\].,!?:;»"'\u2026\u2013\u2014]/;

function ensureSpaceAroundMark(mark) {
  // Пробел ДО маркера
  const prev = mark.previousSibling;
  if (prev && prev.nodeType === 3) {
    const txt = prev.textContent;
    if (txt && !NO_SPACE_BEFORE_MARK.test(txt.slice(-1))) {
      prev.textContent = txt + ' ';
    }
  }
  // Пробел ПОСЛЕ маркера
  const next = mark.nextSibling;
  if (next && next.nodeType === 3) {
    const txt = next.textContent;
    if (txt && !NO_SPACE_AFTER_MARK.test(txt)) {
      next.textContent = ' ' + txt;
    }
  }
}

function removeSpaceAroundMark(mark) {
  // Убираем пробел ДО маркера если мы его добавили
  const prev = mark.previousSibling;
  if (prev && prev.nodeType === 3) {
    const txt = prev.textContent;
    if (txt && txt.endsWith(' ') && txt.length > 1 && !NO_SPACE_BEFORE_MARK.test(txt.slice(-2, -1))) {
      prev.textContent = txt.slice(0, -1);
    }
  }
  // Убираем пробел ПОСЛЕ маркера если мы его добавили
  const next = mark.nextSibling;
  if (next && next.nodeType === 3) {
    const txt = next.textContent;
    if (txt && txt.startsWith(' ') && !NO_SPACE_AFTER_MARK.test(txt.slice(1, 2))) {
      next.textContent = txt.slice(1);
    }
  }
}

// only the <mark data-pd-id="..."> elements that changed.
export function patchPdMarks(editorEl, id, isAnon, letter, replacement) {
  if (!editorEl) return;
  const marks = editorEl.querySelectorAll(`mark[data-pd-id="${id}"]`);
  // Ensure contenteditable=false on all pd marks (may be missing on manually created ones)
  marks.forEach(mark => {
    const wasAnon = mark.classList.contains('anon');
    if (isAnon && !wasAnon) {
      mark.textContent = letter || replacement || '?';
      mark.classList.add('anon');
      mark.title = 'Нажмите, чтобы показать';
      ensureSpaceAroundMark(mark);
    } else if (!isAnon && wasAnon) {
      mark.textContent = mark.dataset.original || mark.textContent;
      mark.classList.remove('anon');
      mark.title = 'Нажмите, чтобы обезличить';
      ensureSpaceAroundMark(mark);
    }
  });
}

// Store original text on marks when editor is initialized
export function initPdMarkOriginals(editorEl) {
  if (!editorEl) return;
  editorEl.querySelectorAll('mark[data-pd-id]').forEach(mark => {
    if (!mark.dataset.original) {
      mark.dataset.original = mark.textContent;
    }
    mark.contentEditable = 'false';
  });
}

// ── RichEditor component ───────────────────────────────────────────────────────
// ── Context menu for uncertain marks ─────────────────────────────────────────
// ── Компонент формы добавления нового ПД ────────────────────────────────────
const OTHER_PD_TYPES = [
  { value: 'address', label: 'Адрес' },
  { value: 'phone', label: 'Телефон' },
  { value: 'passport', label: 'Паспорт' },
  { value: 'zagranpassport', label: 'Загранпаспорт' },
  { value: 'inn', label: 'ИНН' },
  { value: 'snils', label: 'СНИЛС' },
  { value: 'card', label: 'Банковская карта' },
  { value: 'email', label: 'Email' },
  { value: 'dob', label: 'Дата рождения' },
  { value: 'birthplace', label: 'Место рождения' },
  { value: 'vehicle_plate', label: 'Номер авто' },
  { value: 'vehicle_vin', label: 'VIN' },
  { value: 'driver_license', label: 'Водительское удостоверение' },
  { value: 'military_id', label: 'Военный билет' },
  { value: 'oms_policy', label: 'Полис ОМС' },
  { value: 'birth_certificate', label: 'Свидетельство о рождении' },
  { value: 'imei', label: 'IMEI' },
  { value: 'other', label: 'Другое' },
];

function AddPdForm({ x, y, onAdd, onClose, categories = ['private', 'professional', 'other'] }) {
  const defaultCategory = categories.includes('private') ? 'private' : categories[0];
  const [category, setCategory] = React.useState(defaultCategory);
  const [fullName, setFullName] = React.useState('');
  const [role, setRole] = React.useState('');
  const [otherType, setOtherType] = React.useState('address');
  const [otherCustom, setOtherCustom] = React.useState('');
  const formRef = React.useRef(null);

  React.useEffect(() => {
    const handler = (e) => {
      if (formRef.current && !formRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  React.useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8)
      el.style.left = Math.max(8, window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight - 8)
      el.style.top = Math.max(8, y - rect.height - 8) + 'px';
  });

  const handleSubmit = () => {
    if (category === 'private' || category === 'professional') {
      if (!fullName.trim()) return;
      onAdd({ category, fullName: fullName.trim(), role: role.trim() });
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
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="ctx-menu-title">Добавить ПД</div>
      <div className="ctx-form-body">
        <div className="ctx-form-row">
          <label className="ctx-form-label">Тип</label>
          <select className="ctx-form-select" value={category} onChange={e => setCategory(e.target.value)}>
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
                onChange={e => setFullName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                autoFocus
              />
            </div>
            <div className="ctx-form-row">
              <label className="ctx-form-label">Роль</label>
              <input
                className="ctx-form-input"
                placeholder="свидетель, заявитель…"
                value={role}
                onChange={e => setRole(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>
          </>
        )}
        {category === 'other' && (
          <>
            <div className="ctx-form-row">
              <label className="ctx-form-label">Вид данных</label>
              <select className="ctx-form-select" value={otherType} onChange={e => setOtherType(e.target.value)}>
                {OTHER_PD_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
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
                  onChange={e => setOtherCustom(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  autoFocus
                />
              </div>
            )}
          </>
        )}
        <button className="ctx-form-btn" onClick={handleSubmit}>Добавить</button>
      </div>
    </div>
  );
}

// ── Контекстное меню редактора ───────────────────────────────────────────────
function EditorContextMenu({ x, y, type, suggestion, pdId, mark, existingPD, onRemovePd, onApplyPdCanonicalText, onEditPdText, onRemoveUncertain, onApplySuggestion, onAttachPd, onAddNewPd, onClose }) {
  const menuRef = React.useRef(null);
  const [showAddForm, setShowAddForm] = React.useState(false);

  React.useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  React.useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8)
      el.style.left = Math.max(8, window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight - 8)
      el.style.top = Math.max(8, y - rect.height - 8) + 'px';
  });

  if (showAddForm) {
    const allowedCategories = type === 'ambiguous' ? ['private', 'professional'] : ['private', 'professional', 'other'];
    return <AddPdForm x={x} y={y} onAdd={onAddNewPd} onClose={onClose} categories={allowedCategories} />;
  }

  const privatePersons = existingPD?.persons?.filter(p => p.category === 'private') || [];
  const profPersons = existingPD?.persons?.filter(p => p.category === 'professional') || [];
  const otherItems = existingPD?.otherPD || [];
  const hasExisting = privatePersons.length > 0 || profPersons.length > 0 || otherItems.length > 0;

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ position: 'fixed', top: y + 4, left: x, zIndex: 9999 }}
      onMouseDown={e => e.stopPropagation()}
    >
      {type === 'pd' && (
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
      )}
      {type === 'uncertain' && (
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
      )}
      {type === 'ambiguous' && (
        <>
          {hasExisting && (
            <>
              <div className="ctx-menu-section-title">Привязать к существующему лицу</div>
              {privatePersons.length > 0 && (
                <>
                  <div className="ctx-menu-group-label">Частные лица</div>
                  {privatePersons.map(p => (
                    <div key={p.id} className="ctx-menu-item ctx-menu-item-pd" onClick={() => { onAttachPd(p.id); onClose(); }}>
                      <span className="ctx-menu-pd-letter">{p.letter}</span>
                      <span className="ctx-menu-pd-name">{p.fullName}</span>
                    </div>
                  ))}
                </>
              )}
              {profPersons.length > 0 && (
                <>
                  <div className="ctx-menu-group-label">Профучастники</div>
                  {profPersons.map(p => (
                    <div key={p.id} className="ctx-menu-item ctx-menu-item-pd" onClick={() => { onAttachPd(p.id); onClose(); }}>
                      <span className="ctx-menu-pd-letter ctx-menu-pd-letter-prof">{p.letter}</span>
                      <span className="ctx-menu-pd-name">{p.fullName}</span>
                    </div>
                  ))}
                </>
              )}
              <div className="ctx-menu-divider" />
            </>
          )}
          <div className="ctx-menu-item" onClick={() => setShowAddForm(true)}>
            + Создать новое лицо
          </div>
          <div className="ctx-menu-item" onClick={onRemoveUncertain}>
            Снять пометку
          </div>
        </>
      )}
      {type === 'selection' && (
        <>
          {hasExisting && (
            <>
              <div className="ctx-menu-section-title">Привязать к существующему</div>
              {privatePersons.length > 0 && (
                <>
                  <div className="ctx-menu-group-label">Частные лица</div>
                  {privatePersons.map(p => (
                    <div key={p.id} className="ctx-menu-item ctx-menu-item-pd" onClick={() => { onAttachPd(p.id); onClose(); }}>
                      <span className="ctx-menu-pd-letter">{p.letter}</span>
                      <span className="ctx-menu-pd-name">{p.fullName}</span>
                    </div>
                  ))}
                </>
              )}
              {profPersons.length > 0 && (
                <>
                  <div className="ctx-menu-group-label">Профучастники</div>
                  {profPersons.map(p => (
                    <div key={p.id} className="ctx-menu-item ctx-menu-item-pd" onClick={() => { onAttachPd(p.id); onClose(); }}>
                      <span className="ctx-menu-pd-letter ctx-menu-pd-letter-prof">{p.letter}</span>
                      <span className="ctx-menu-pd-name">{p.fullName}</span>
                    </div>
                  ))}
                </>
              )}
              {otherItems.length > 0 && (
                <>
                  <div className="ctx-menu-group-label">Другие ПД</div>
                  {otherItems.map(p => (
                    <div key={p.id} className="ctx-menu-item ctx-menu-item-pd" onClick={() => { onAttachPd(p.id); onClose(); }}>
                      <span className="ctx-menu-pd-name">{p.value || p.type}</span>
                    </div>
                  ))}
                </>
              )}
              <div className="ctx-menu-divider" />
            </>
          )}
          <div className="ctx-menu-item" onClick={() => setShowAddForm(true)}>
            + Добавить новое ПД
          </div>
        </>
      )}
    </div>
  );
}

export function RichEditor({ html, onHtmlChange, onPdClick, onRemovePdMark, onApplyPdCanonicalText, onEditPdMark, onEditPdTextMark, onAttachPdMark, onAddPdMark, onRemoveAmbiguousMark, onUncertainResolved, existingPD, editorRef: externalRef, highlightUncertain }) {
  const internalRef = useRef(null);
  const editorRef = externalRef || internalRef;
  const lastHtml = useRef('');
  const isComposing = useRef(false);
  const [ctxMenu, setCtxMenu] = React.useState(null); // {x, y, mark}

  // Only set innerHTML when html prop changes from OUTSIDE (new doc, not user typing)
  useEffect(() => {
    if (!editorRef.current) return;
    // Only update DOM if content truly differs (avoids cursor jump on every keystroke)
    if (html !== lastHtml.current) {
      editorRef.current.innerHTML = html || '';
      lastHtml.current = html || '';
      // Store originals for de-anonymization
      initPdMarkOriginals(editorRef.current);
    }
  }, [html, editorRef]);

  const notifyChange = useCallback(() => {
    if (!editorRef.current) return;
    const current = editorRef.current.innerHTML;
    if (current !== lastHtml.current) {
      lastHtml.current = current;
      onHtmlChange?.(current);
    }
  }, [onHtmlChange, editorRef]);

  const exec = useCallback((cmd, value = null) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    // If nothing is selected and command needs a selection (formatBlock, fontSize),
    // select all content in the current block so the command applies
    const sel = window.getSelection();
    if (sel && sel.rangeCount === 0) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    document.execCommand(cmd, false, value);
    notifyChange();
  }, [notifyChange, editorRef]);

  const handleClick = useCallback((e) => {
    const mark = e.target.closest('mark[data-pd-id]');
    if (mark) {
      e.preventDefault();
      e.stopPropagation();
      onPdClick?.(mark.dataset.pdId);
    }
  }, [onPdClick]);

  const handleContextMenu = useCallback((e) => {
    const ambiguousMark = e.target.closest('mark.ambiguous-person');
    const uncertainMark = e.target.closest('mark.uncertain');
    const pdMark = e.target.closest('mark[data-pd-id]');
    if (ambiguousMark) {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, mark: ambiguousMark, type: 'ambiguous' });
    } else if (uncertainMark) {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, mark: uncertainMark, type: 'uncertain' });
    } else if (pdMark) {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, mark: pdMark, type: 'pd' });
    } else {
      // Check for plain text selection (no marks inside)
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const fragment = range.cloneContents();
        // Reject if selection contains any mark tags
        if (!fragment.querySelector('mark')) {
          e.preventDefault();
          setCtxMenu({ x: e.clientX, y: e.clientY, type: 'selection', range: range.cloneRange() });
        }
      }
    }
  }, []);

  const removeUncertainMark = useCallback(() => {
    if (!ctxMenu?.mark) return;
    const mark = ctxMenu.mark;
    const text = document.createTextNode(mark.textContent);
    mark.parentNode.replaceChild(text, mark);
    // Normalize adjacent text nodes so regex can find values that were split by the uncertain mark
    mark.parentNode?.normalize?.();
    notifyChange();
    setCtxMenu(null);
    onUncertainResolved?.();
  }, [ctxMenu, notifyChange, onUncertainResolved]);

  const applyUncertainSuggestion = useCallback(() => {
    if (!ctxMenu?.mark) return;
    const mark = ctxMenu.mark;
    const suggestion = mark.dataset.suggestion;
    if (!suggestion) return;
    const text = document.createTextNode(suggestion);
    mark.parentNode.replaceChild(text, mark);
    text.parentNode?.normalize?.();
    notifyChange();
    setCtxMenu(null);
    onUncertainResolved?.();
  }, [ctxMenu, notifyChange, onUncertainResolved]);

  const removeAmbiguousMark = useCallback(() => {
    if (!ctxMenu?.mark) return;
    const mark = ctxMenu.mark;
    const text = document.createTextNode(mark.textContent);
    mark.parentNode.replaceChild(text, mark);
    mark.parentNode?.normalize?.();
    notifyChange();
    setCtxMenu(null);
    onRemoveAmbiguousMark?.(mark);
  }, [ctxMenu, notifyChange, onRemoveAmbiguousMark]);

  const removePdMark = useCallback(() => {
    if (!ctxMenu?.mark) return;
    const mark = ctxMenu.mark;
    const id = mark.dataset.pdId;
    const restoredText = mark.dataset.original || mark.textContent;
    const text = document.createTextNode(restoredText);
    mark.parentNode.replaceChild(text, mark);
    notifyChange();
    setCtxMenu(null);
    onRemovePdMark?.(id);
  }, [ctxMenu, notifyChange, onRemovePdMark]);

  const attachPdMark = useCallback((id) => {
    const selectedText = ctxMenu?.range
      ? ctxMenu.range.toString().trim()
      : (ctxMenu?.mark?.textContent || '').trim();
    const mark = document.createElement('mark');
    mark.className = 'pd priv';
    mark.dataset.pdId = id;
    mark.dataset.original = selectedText;
    mark.contentEditable = 'false';
    if (ctxMenu?.range) {
      const range = ctxMenu.range;
      try {
        range.surroundContents(mark);
      } catch {
        const fragment = range.extractContents();
        mark.appendChild(fragment);
        range.insertNode(mark);
      }
    } else if (ctxMenu?.mark) {
      ctxMenu.mark.parentNode.replaceChild(mark, ctxMenu.mark);
      mark.textContent = selectedText;
    }
    notifyChange();
    setCtxMenu(null);
    onAttachPdMark?.(id, mark, ctxMenu?.type === 'ambiguous' ? ctxMenu?.mark : null);
  }, [ctxMenu, notifyChange, onAttachPdMark]);

  const addNewPdMark = useCallback((pdData) => {
    const selectedText = ctxMenu?.range
      ? ctxMenu.range.toString().trim()
      : (ctxMenu?.mark?.textContent || '').trim();
    const mark = document.createElement('mark');
    const cat = pdData.category === 'professional' ? 'prof' : pdData.category === 'other' ? 'oth' : 'priv';
    mark.className = `pd ${cat}`;
    mark.dataset.pdId = '__new__';
    mark.dataset.original = selectedText;
    mark.contentEditable = 'false';
    if (ctxMenu?.range) {
      const range = ctxMenu.range;
      try {
        range.surroundContents(mark);
      } catch {
        const fragment = range.extractContents();
        mark.appendChild(fragment);
        range.insertNode(mark);
      }
    } else if (ctxMenu?.mark) {
      ctxMenu.mark.parentNode.replaceChild(mark, ctxMenu.mark);
      mark.textContent = selectedText;
    }
    notifyChange();
    setCtxMenu(null);
    onAddPdMark?.(pdData, selectedText, mark, ctxMenu?.type === 'ambiguous' ? ctxMenu?.mark : null);
  }, [ctxMenu, notifyChange, onAddPdMark]);

  // Удаляем маркер целиком при Delete/Backspace
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      exec(e.shiftKey ? 'outdent' : 'indent');
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);

      if (!range.collapsed) {
        // Есть выделение — оно уже расширено до границ маркеров (см. handleSelectionChange)
        // Позволяем браузеру удалить, но после проверяем осиротевшие маркеры
        return;
      }

      // Курсор без выделения — проверяем соседний маркер
      let mark = null;
      if (e.key === 'Backspace') {
        // Ищем маркер непосредственно перед курсором
        const node = range.startContainer;
        const offset = range.startOffset;
        if (node.nodeType === 3 && offset === 0) {
          const prev = node.previousSibling;
          if (prev?.matches?.('mark[data-pd-id]')) mark = prev;
        } else if (node.nodeType === 1) {
          const prev = node.childNodes[offset - 1];
          if (prev?.matches?.('mark[data-pd-id]')) mark = prev;
        }
      } else {
        // Delete — ищем маркер непосредственно после курсора
        const node = range.startContainer;
        const offset = range.startOffset;
        if (node.nodeType === 3 && offset === node.textContent.length) {
          const next = node.nextSibling;
          if (next?.matches?.('mark[data-pd-id]')) mark = next;
        } else if (node.nodeType === 1) {
          const next = node.childNodes[offset];
          if (next?.matches?.('mark[data-pd-id]')) mark = next;
        }
      }

      if (mark) {
        e.preventDefault();
        const id = mark.dataset.pdId;
        mark.parentNode.removeChild(mark);
        notifyChange();
        onRemovePdMark?.(id);
      }
    }
  }, [exec, notifyChange, onRemovePdMark]);





  return (
    <div className="rich-editor-wrap">
      <div className="rich-toolbar" onMouseDown={e => e.preventDefault()}>
        {TOOLBAR.map((entry, i) => {
          if (entry.type === 'sep') return <div key={`sep-${i}`} className="rich-sep" />;
          return entry.items.map((item, j) => {
            if (item.type === 'select') return null; // selects removed
            return (
              <button
                key={`btn-${i}-${j}`}
                className="rich-btn"
                title={item.title}
                onMouseDown={e => { e.preventDefault(); exec(item.cmd); }}
              >
                {item.svg
                  ? <span className="rich-icon">{ICONS[item.svg]}</span>
                  : <span style={item.style}>{item.icon}</span>
                }
              </button>
            );
          });
        })}
      </div>

      <div
        ref={editorRef}
        className={"rich-content" + (highlightUncertain ? " uncertain-highlight-active" : "")}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={() => {
          if (!isComposing.current) notifyChange();
        }}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => { isComposing.current = false; notifyChange(); }}
        onBlur={notifyChange}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />
      {ctxMenu && (
        <EditorContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          type={ctxMenu.type}
          suggestion={ctxMenu.mark?.dataset?.suggestion || ''}
          pdId={ctxMenu.mark?.dataset?.pdId || ''}
          mark={ctxMenu.mark || null}
          existingPD={existingPD}
          onRemovePd={removePdMark}
          onApplyPdCanonicalText={onApplyPdCanonicalText}
          onEditPdText={onEditPdTextMark}
          onRemoveUncertain={ctxMenu.type === 'ambiguous' ? removeAmbiguousMark : removeUncertainMark}
          onApplySuggestion={applyUncertainSuggestion}
          onAttachPd={attachPdMark}
          onAddNewPd={addNewPdMark}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
