import React from 'react';
import PdFragmentEditorModal from './PdFragmentEditorModal';
import PdRecordEditorModal from './PdRecordEditorModal';

function UnsavedChangesModal({
  docTitle,
  onSave,
  onDiscard,
  onClose,
} = {}) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-title">Несохранённые изменения</div>
        <div className="modal-body">Документ «{docTitle}» изменён. Сохранить перед выходом?</div>
        <div className="modal-actions">
          <button className="btn-primary btn-sm" onClick={onSave}>Сохранить</button>
          <button className="btn-tool" onClick={onDiscard}>Не сохранять</button>
          <button className="btn-tool" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

function CreateProjectModal({
  newProjectTitle,
  setNewProjectTitle,
  onCreate,
  onClose,
} = {}) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-title">Новый проект</div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="modal-label">Название</label>
            <input
              className="modal-input"
              placeholder="Например: Дело № 123/2026"
              value={newProjectTitle}
              onChange={(event) => setNewProjectTitle(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && onCreate()}
              autoFocus
            />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-primary btn-sm" onClick={onCreate} disabled={!newProjectTitle.trim()}>
            Создать
          </button>
          <button className="btn-tool" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

function RebuildSummaryModal({
  onConfirm,
  onClose,
} = {}) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-title">Пересобрать итоговый документ?</div>
        <div className="modal-body">
          Существующий итоговый документ будет заменён новым. Все изменения, внесённые в предыдущий итоговый документ, будут потеряны.
        </div>
        <div className="modal-actions">
          <button className="btn-primary btn-sm" onClick={onConfirm}>Пересобрать</button>
          <button className="btn-tool" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

function UncertainWarningModal({
  uncertainCount,
  separatorCount,
  onProceed,
  onCancel,
} = {}) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-title">⚠️ Документ требует проверки</div>
        <div className="modal-body">
          {uncertainCount > 0 && (
            <div>
              Найдено <strong>{uncertainCount}</strong> {uncertainCount === 1 ? 'фрагмент' : 'фрагментов'} с неточным распознаванием
              {' '}— выделены двойным подчёркиванием.
            </div>
          )}
          {separatorCount > 0 && (
            <div style={{ marginTop: uncertainCount > 0 ? 8 : 0 }}>
              Найдено <strong>{separatorCount}</strong> {separatorCount === 1 ? 'разделитель частей' : 'разделителей частей'}
              {' '}— они выделены и не должны оставаться в финальном документе.
            </div>
          )}
          <div style={{ marginTop: 10, color: 'var(--text2)' }}>
            Рекомендуем проверить и исправить их перед сохранением.
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-tool" onClick={onCancel}>Перейти к исправлению</button>
          <button className="btn-primary btn-sm" onClick={onProceed}>Всё равно продолжить</button>
        </div>
      </div>
    </div>
  );
}

export default function AppOverlays({
  showUncertainWarning,
  uncertainCount,
  separatorCount,
  onUncertainProceed,
  onUncertainCancel,
  savedMsg,
  showUnsaved,
  docTitle,
  onUnsavedSave,
  onUnsavedDiscard,
  onUnsavedClose,
  currentEditingPd,
  onClosePdEditor,
  onSavePdEdit,
  currentEditingPdFragment,
  onClosePdFragmentEditor,
  onSavePdFragmentEdit,
  showCreateProject,
  newProjectTitle,
  setNewProjectTitle,
  onCreateProject,
  onCloseCreateProject,
  showRebuildConfirm,
  onConfirmRebuild,
  onCloseRebuildConfirm,
} = {}) {
  return (
    <>
      {showUncertainWarning && (
        <UncertainWarningModal
          uncertainCount={uncertainCount}
          separatorCount={separatorCount}
          onProceed={onUncertainProceed}
          onCancel={onUncertainCancel}
        />
      )}

      {savedMsg && (
        <div className="save-toast">✓ Документ сохранён</div>
      )}

      {showUnsaved && (
        <UnsavedChangesModal
          docTitle={docTitle}
          onSave={onUnsavedSave}
          onDiscard={onUnsavedDiscard}
          onClose={onUnsavedClose}
        />
      )}

      {currentEditingPd && (
        <PdRecordEditorModal
          pdItem={currentEditingPd}
          onClose={onClosePdEditor}
          onSave={onSavePdEdit}
        />
      )}

      {currentEditingPdFragment && (
        <PdFragmentEditorModal
          fragment={currentEditingPdFragment}
          onClose={onClosePdFragmentEditor}
          onSave={onSavePdFragmentEdit}
        />
      )}

      {showCreateProject && (
        <CreateProjectModal
          newProjectTitle={newProjectTitle}
          setNewProjectTitle={setNewProjectTitle}
          onCreate={onCreateProject}
          onClose={onCloseCreateProject}
        />
      )}

      {showRebuildConfirm && (
        <RebuildSummaryModal
          onConfirm={onConfirmRebuild}
          onClose={onCloseRebuildConfirm}
        />
      )}
    </>
  );
}
