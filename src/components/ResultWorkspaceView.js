import React from 'react';
import DocumentTitleActions from './DocumentTitleActions';
import OriginalViewerPanel from './OriginalViewerPanel';
import { RichEditor } from './RichEditor';
import { PD_ANALYSIS_CHAR_LIMIT } from '../utils/claudeApi';

function PdNavCounter({ state }) {
  if (!state) return '';
  return state.cur === -1 ? state.total : `${state.cur + 1}/${state.total}`;
}

function PersonGroup({
  title,
  dotClass,
  items,
  anonymized,
  pdInDoc,
  onToggleAll,
  onToggle,
  onInitCounter,
  onNavigate,
  onEdit,
  onDelete,
  pdNavState,
  isProfessional = false,
} = {}) {
  if (items.length === 0) return null;

  return (
    <div className="pd-group">
      <div className="pd-group-header">
        <span className={`pd-dot ${dotClass}`} /><span>{title}</span>
        <button className="pd-group-btn" onClick={onToggleAll}>
          {items.every((item) => anonymized[item.id]) ? 'Показать всё' : 'Скрыть всё'}
        </button>
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className={`pd-item ${isProfessional ? 'prof ' : ''}${anonymized[item.id] ? 'anon' : ''}${!pdInDoc(item.id) ? ' pd-absent' : ''}`}
          onClick={() => (pdInDoc(item.id) ? onToggle(item.id) : null)}
          onMouseEnter={() => pdInDoc(item.id) && onInitCounter(item.id)}
        >
          <span className={`pd-item-letter ${isProfessional ? 'prof-letter' : ''}`}>{item.letter}</span>
          <span className="pd-item-body">
            <span className="pd-item-row1">
              <span className="pd-item-name">{item.fullName}</span>
              {pdInDoc(item.id) && (
                <span className="pd-item-nav">
                  <button className="pd-nav-btn" title="Предыдущее упоминание" onClick={(event) => onNavigate(item.id, 'up', event)}>↑</button>
                  <span className="pd-nav-counter"><PdNavCounter state={pdNavState[item.id]} /></span>
                  <button className="pd-nav-btn" title="Следующее упоминание" onClick={(event) => onNavigate(item.id, 'down', event)}>↓</button>
                </span>
              )}
              <button className="pd-item-edit" onClick={(event) => { event.stopPropagation(); onEdit(item.id); }} title="Редактировать запись ПД">Изм.</button>
              <button className="pd-item-delete" onClick={(event) => { event.stopPropagation(); onDelete(item.id); }} title="Удалить запись ПД">✕</button>
              <span className="pd-item-status">{anonymized[item.id] ? '🔒' : '👁'}</span>
            </span>
            {item.role && <span className="pd-item-role">{item.role}</span>}
            {!pdInDoc(item.id) && <span className="pd-absent-label">нет в документе</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function OtherPdGroups({
  pdTypeGroups,
  pdTypeLabels,
  anonymized,
  pdInDoc,
  onToggleAll,
  onToggle,
  onInitCounter,
  onNavigate,
  onEdit,
  onDelete,
  pdNavState,
} = {}) {
  return Object.entries(pdTypeGroups).map(([type, items]) => (
    <div key={type} className="pd-group">
      <div className="pd-group-header">
        <span className="pd-dot other" /><span>{pdTypeLabels[type] || type}</span>
        <button className="pd-group-btn" onClick={() => onToggleAll(type)}>
          {items.every((item) => anonymized[item.id]) ? 'Показать всё' : 'Скрыть всё'}
        </button>
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className={`pd-item oth ${anonymized[item.id] ? 'anon' : ''}${!pdInDoc(item.id) ? ' pd-absent' : ''}`}
          onClick={() => (pdInDoc(item.id) ? onToggle(item.id) : null)}
          onMouseEnter={() => pdInDoc(item.id) && onInitCounter(item.id)}
        >
          <span className="pd-item-body">
            <span className="pd-item-row1">
              <span className="pd-item-name">{item.value}</span>
              {pdInDoc(item.id) && (
                <span className="pd-item-nav">
                  <button className="pd-nav-btn" title="Предыдущее упоминание" onClick={(event) => onNavigate(item.id, 'up', event)}>↑</button>
                  <span className="pd-nav-counter"><PdNavCounter state={pdNavState[item.id]} /></span>
                  <button className="pd-nav-btn" title="Следующее упоминание" onClick={(event) => onNavigate(item.id, 'down', event)}>↓</button>
                </span>
              )}
              <button className="pd-item-edit" onClick={(event) => { event.stopPropagation(); onEdit(item.id); }} title="Редактировать запись ПД">Изм.</button>
              <button className="pd-item-delete" onClick={(event) => { event.stopPropagation(); onDelete(item.id); }} title="Удалить запись ПД">✕</button>
              <span className="pd-item-status">{anonymized[item.id] ? '🔒' : '👁'}</span>
            </span>
            <span className="pd-item-role">→ {item.replacement}</span>
            {!pdInDoc(item.id) && <span className="pd-absent-label">нет в документе</span>}
          </span>
        </div>
      ))}
    </div>
  ));
}

export default function ResultWorkspaceView({
  showOriginal,
  originalImages,
  hasPD,
  pdWidth,
  setPdPanelRef,
  startResize,
  privatePersons,
  profPersons,
  pdTypeGroups,
  pdTypeLabels,
  anonymized,
  pdInDoc,
  handlePdClick,
  initNavCounter,
  navigateToPd,
  openPdEditor,
  handleDeletePdEntry,
  anonymizeAllByCategory,
  pdNavState,
  docTitle,
  setDocTitle,
  titleRowRef,
  handleToggleOriginalViewer,
  handleLoadOriginalViewerImages,
  triggerExport,
  showLongDocWarning,
  setShowLongDocWarning,
  editorHtml,
  handleEditorHtmlChange,
  personalData,
  editorDomRef,
  highlightUncertain,
  editorTotalPages,
  editorCurrentPage,
  editorPageInput,
  editorPageInputRef,
  setEditorPageInput,
  handleEditorPageSubmit,
  handleEditorPageStep,
  handlePdClickFromEditor,
  handleRemovePdMark,
  handleApplyPdCanonicalText,
  openPdFragmentEditor,
  handleAttachPdMark,
  handleAddPdMark,
  handleRemoveAmbiguousMark,
  handleUncertainResolved,
  originalPage,
  setOriginalPage,
  zoomActive,
  setZoomActive,
  zoomScale,
  setZoomScale,
  viewerWidth,
  onCloseOriginal,
} = {}) {
  return (
    <div className={'result-area' + (showOriginal && originalImages.length > 0 ? ' viewer-open' : '')}>
      {hasPD && (
        <aside className="pd-panel" ref={setPdPanelRef} style={{ width: pdWidth, flexShrink: 0 }}>
          <div className="pd-panel-title">Персональные данные</div>
          <div className="pd-hint">Нажмите на метку в тексте или на строку ниже</div>

          <PersonGroup
            title="Частные лица"
            dotClass="private"
            items={privatePersons}
            anonymized={anonymized}
            pdInDoc={pdInDoc}
            onToggleAll={() => anonymizeAllByCategory('private')}
            onToggle={handlePdClick}
            onInitCounter={initNavCounter}
            onNavigate={navigateToPd}
            onEdit={openPdEditor}
            onDelete={handleDeletePdEntry}
            pdNavState={pdNavState}
          />

          <PersonGroup
            title="Проф. участники"
            dotClass="professional"
            items={profPersons}
            anonymized={anonymized}
            pdInDoc={pdInDoc}
            onToggleAll={() => anonymizeAllByCategory('professional')}
            onToggle={handlePdClick}
            onInitCounter={initNavCounter}
            onNavigate={navigateToPd}
            onEdit={openPdEditor}
            onDelete={handleDeletePdEntry}
            pdNavState={pdNavState}
            isProfessional
          />

          <OtherPdGroups
            pdTypeGroups={pdTypeGroups}
            pdTypeLabels={pdTypeLabels}
            anonymized={anonymized}
            pdInDoc={pdInDoc}
            onToggleAll={anonymizeAllByCategory}
            onToggle={handlePdClick}
            onInitCounter={initNavCounter}
            onNavigate={navigateToPd}
            onEdit={openPdEditor}
            onDelete={handleDeletePdEntry}
            pdNavState={pdNavState}
          />

          <div className="pd-legend">
            <div className="pd-legend-item"><mark className="pd-mark pd-cat-private" style={{ cursor: 'default' }}>А</mark> — частное лицо</div>
            <div className="pd-legend-item"><mark className="pd-mark pd-cat-professional" style={{ cursor: 'default', fontSize: '11px' }}>[ФИО 1]</mark> — проф. участник</div>
            <div className="pd-legend-item"><mark className="pd-mark pd-cat-other" style={{ cursor: 'default' }}>ПД</mark> — другие перс. данные</div>
            <div className="pd-legend-item"><span style={{ borderBottom: '2px dashed #2196f3', background: 'rgba(33, 150, 243, 0.10)', padding: '0 2px', fontSize: '12px', color: '#0d3b66' }}>имя</span> — неоднозначное упоминание лица</div>
            <div className="pd-legend-item"><span style={{ borderBottom: '3px double #f57c00', paddingBottom: '1px', fontSize: '12px', color: '#4a3000' }}>текст</span> — неточное распознавание</div>
          </div>
        </aside>
      )}

      {hasPD && (
        <div className="panel-resizer" onMouseDown={startResize('pd')}><span className="panel-resizer-icon">‹<br/>›</span></div>
      )}

      <div className="doc-card">
        <div className="doc-title-row" ref={titleRowRef}>
          <input
            className="doc-title-input"
            value={docTitle}
            onChange={(event) => setDocTitle(event.target.value)}
            placeholder="Название документа"
            spellCheck={false}
          />
          <DocumentTitleActions
            hasOriginalImages={originalImages.length > 0}
            showOriginal={showOriginal}
            onToggleOriginal={handleToggleOriginalViewer}
            onOriginalImagesLoaded={handleLoadOriginalViewerImages}
            onSave={() => triggerExport('save')}
            onExportDocx={() => triggerExport('docx')}
            onExportPdf={() => triggerExport('pdf')}
          />
        </div>

        {showLongDocWarning && (
          <div className="long-doc-warning">
            ⚠️ Для анализа персональных данных сейчас используется только первые {PD_ANALYSIS_CHAR_LIMIT.toLocaleString('ru-RU')} символов документа. Если текст длиннее, часть персональных данных после этого лимита могла быть пропущена. Рекомендуем разбить документ на части и загружать отдельно.
            <button className="long-doc-close" onClick={() => setShowLongDocWarning(false)}>✕</button>
          </div>
        )}

        <RichEditor
          html={editorHtml}
          onHtmlChange={handleEditorHtmlChange}
          onPdClick={handlePdClickFromEditor}
          onRemovePdMark={handleRemovePdMark}
          onApplyPdCanonicalText={handleApplyPdCanonicalText}
          onEditPdMark={openPdEditor}
          onEditPdTextMark={openPdFragmentEditor}
          onAttachPdMark={handleAttachPdMark}
          onAddPdMark={handleAddPdMark}
          onRemoveAmbiguousMark={handleRemoveAmbiguousMark}
          onUncertainResolved={handleUncertainResolved}
          existingPD={personalData}
          editorRef={editorDomRef}
          highlightUncertain={highlightUncertain}
          pageNavigation={editorTotalPages > 1 ? {
            currentPage: editorCurrentPage || 1,
            totalPages: editorTotalPages,
            inputValue: editorPageInput,
            inputRef: editorPageInputRef,
            onInputChange: (value) => setEditorPageInput(String(value || '').replace(/[^\d]/g, '')),
            onSubmit: handleEditorPageSubmit,
            onStepBack: () => handleEditorPageStep(-1),
            onStepForward: () => handleEditorPageStep(1),
          } : null}
        />
      </div>

      {showOriginal && originalImages.length > 0 && (
        <OriginalViewerPanel
          images={originalImages}
          currentPage={originalPage}
          setCurrentPage={setOriginalPage}
          zoomActive={zoomActive}
          setZoomActive={setZoomActive}
          zoomScale={zoomScale}
          setZoomScale={setZoomScale}
          width={viewerWidth}
          onResizeStart={startResize('viewer')}
          onClose={onCloseOriginal}
        />
      )}
    </div>
  );
}
