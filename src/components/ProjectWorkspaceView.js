import React from 'react';
import { PROVIDERS } from '../utils/claudeApi';

function renderPersonBadgeCount(doc, predicate, className, label) {
  const count = (doc.personalData?.persons || []).filter(predicate).length;
  if (count === 0) return null;
  return <span className={className} style={{ marginLeft: 8 }}>{count} {label}</span>;
}

function ProviderSection({
  provider,
  setProvider,
  apiKey,
  setApiKey,
  showApiKey,
  setShowApiKey,
}) {
  return (
    <section className="card api-card">
      <div className="provider-select-wrap">
        <label className="provider-label">Провайдер ИИ</label>
        <div className="provider-tabs">
          {Object.entries(PROVIDERS).map(([key, providerInfo]) => (
            <button
              key={key}
              className={'provider-tab' + (provider === key ? ' active' : '')}
              onClick={() => { setProvider(key); setApiKey(''); }}
              type="button"
            >
              {providerInfo.label}
            </button>
          ))}
        </div>
      </div>
      <div className="api-input-wrap" style={{ marginTop: 8 }}>
        <input
          type={showApiKey ? 'text' : 'password'}
          className="api-input"
          placeholder={PROVIDERS[provider].placeholder}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="api-toggle" onClick={() => setShowApiKey((visible) => !visible)}>{showApiKey ? '🙈' : '👁'}</button>
      </div>
      <div className="api-hint">
        Ключ не сохраняется.{' '}
        {provider === 'claude' && <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">Получить ключ →</a>}
        {provider === 'openai' && <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">Получить ключ →</a>}
        {provider === 'gemini' && <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Получить ключ →</a>}
      </div>
    </section>
  );
}

function FileList({ files, iconResolver, onRemove }) {
  if (files.length === 0) return null;

  return (
    <div className="file-list">
      {files.map((file, index) => (
        <div key={`${file.name}_${index}`} className="file-item">
          <span className="file-icon">{iconResolver(file)}</span>
          <span className="file-name">{file.name}</span>
          <span className="file-size">{(file.size / 1024 / 1024).toFixed(1)} МБ</span>
          <button className="file-remove" onClick={(event) => { event.stopPropagation(); onRemove(index); }}>✕</button>
        </div>
      ))}
    </div>
  );
}

function UploadTabsSection(props) {
  const {
    inputTab,
    setInputTab,
    isDragging,
    setIsDragging,
    projectFileInputRef,
    projectDocxInputRef,
    handleProjectDocumentDrop,
    handleProjectDocumentFiles,
    handleProjectDocxFiles,
    files,
    docxFiles,
    removeFile,
    removeDocxFile,
    pastedText,
    setPastedText,
  } = props;

  return (
    <section className="card upload-card">
      <div className="input-tabs">
        <button className={`input-tab ${inputTab === 'documents' ? 'active' : ''}`} onClick={() => setInputTab('documents')} type="button">Документы</button>
        <button className={`input-tab ${inputTab === 'docx' ? 'active' : ''}`} onClick={() => setInputTab('docx')} type="button">DOCX</button>
        <button className={`input-tab ${inputTab === 'text' ? 'active' : ''}`} onClick={() => setInputTab('text')} type="button">Текст</button>
      </div>

      {inputTab === 'documents' && (
        <>
          <div
            className={`dropzone ${isDragging ? 'dragging' : ''}`}
            onDrop={handleProjectDocumentDrop}
            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => projectFileInputRef.current?.click()}
          >
            <input
              ref={projectFileInputRef}
              type="file"
              multiple
              accept=".pdf,application/pdf,image/*"
              className="visually-hidden"
              onChange={(event) => {
                handleProjectDocumentFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <div className="dropzone-icon">📄</div>
            <div className="dropzone-text">
              <strong>Перетащите PDF или изображения сюда</strong>
              <br />
              <span>или нажмите для выбора</span>
            </div>
            <div className="dropzone-hint">PDF, JPG, PNG, WEBP</div>
          </div>
          <FileList
            files={files}
            iconResolver={(file) => (file.type === 'application/pdf' ? '📑' : '🖼️')}
            onRemove={removeFile}
          />
        </>
      )}

      {inputTab === 'docx' && (
        <>
          <div
            className={`dropzone ${isDragging ? 'dragging' : ''}`}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              handleProjectDocxFiles(event.dataTransfer.files);
            }}
            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => projectDocxInputRef.current?.click()}
          >
            <input
              ref={projectDocxInputRef}
              type="file"
              multiple
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="visually-hidden"
              onChange={(event) => {
                handleProjectDocxFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <div className="dropzone-icon">📝</div>
            <div className="dropzone-text">
              <strong>Перетащите DOCX-файлы сюда</strong>
              <br />
              <span>или нажмите для выбора</span>
            </div>
          </div>
          <FileList
            files={docxFiles}
            iconResolver={() => '📝'}
            onRemove={removeDocxFile}
          />
        </>
      )}

      {inputTab === 'text' && (
        <textarea
          className="paste-textarea"
          placeholder="Вставьте сюда текст документа для обезличивания"
          value={pastedText}
          onChange={(event) => setPastedText(event.target.value)}
        />
      )}
    </section>
  );
}

function BatchStatusSection({
  currentBatchDisplayState,
  currentBatchSession,
  requestPauseActiveBatch,
  handleResetProjectBatchSession,
  getBatchStatusTitle,
  getBatchResumeText,
  getBatchSourceSelectionHint,
}) {
  if (!currentBatchDisplayState || currentBatchDisplayState.status === 'completed') {
    return null;
  }

  return (
    <div className={`project-batch-status ${currentBatchDisplayState.status === 'failed' ? 'failed' : ''}`}>
      <div className="project-batch-status-title">
        {getBatchStatusTitle(currentBatchDisplayState.status, currentBatchDisplayState.sourceKind)}
      </div>
      <div className="project-batch-status-body">
        <strong>{currentBatchDisplayState.fileName}</strong>
        <span>{getBatchResumeText({
          nextPage: currentBatchDisplayState.nextPage,
          totalPages: currentBatchDisplayState.totalPages,
          chunkSize: currentBatchSession?.chunkSize || 1,
          sourceKind: currentBatchDisplayState.sourceKind,
        })}</span>
        {currentBatchDisplayState.status !== 'running' && (
          <span>{getBatchSourceSelectionHint(currentBatchDisplayState.sourceKind)}</span>
        )}
        {currentBatchDisplayState.error && <span>Последняя ошибка: {currentBatchDisplayState.error}</span>}
      </div>
      {Number.isFinite(currentBatchDisplayState.progressPercent) && (
        <div className="project-batch-progress">
          <div className="project-batch-progress-bar" style={{ width: `${Math.max(0, Math.min(100, Math.round(currentBatchDisplayState.progressPercent)))}%` }} />
        </div>
      )}
      <div className="project-batch-actions">
        {currentBatchDisplayState.status === 'running' && (
          <button className="btn-tool" onClick={() => requestPauseActiveBatch('project')}>
            Пауза
          </button>
        )}
        {currentBatchDisplayState.status === 'pausing' && (
          <button className="btn-tool btn-tool-disabled" type="button" disabled>
            Пауза запрошена
          </button>
        )}
        <button className="btn-tool" onClick={handleResetProjectBatchSession}>Сбросить незавершённую обработку</button>
      </div>
      {currentBatchDisplayState.status === 'pausing' && (
        <div className="project-batch-pending-note">
          Пауза будет поставлена сразу после завершения обработки текущей страницы.
        </div>
      )}
    </div>
  );
}

function RecognizeButtonSection({
  apiKey,
  currentBatchSession,
  inputTab,
  files,
  docxFiles,
  pastedText,
  handleProjectRecognize,
}) {
  return (
    <div className="home-btn-wrap">
      <button
        className="btn-primary"
        onClick={handleProjectRecognize}
        disabled={
          !apiKey.trim() || (
            currentBatchSession && currentBatchSession.status !== 'completed'
              ? files.length === 0
              : inputTab === 'documents'
                ? files.length === 0
                : inputTab === 'docx'
                  ? docxFiles.length === 0
                  : pastedText.trim().length === 0
          )
        }
      >
        {currentBatchSession && currentBatchSession.status !== 'completed'
          ? '▶ Продолжить обработку'
          : inputTab === 'docx'
            ? '🔍 Обезличить DOCX'
            : inputTab === 'text'
              ? '🔍 Обезличить текст'
              : '🔍 Распознать и обезличить'}
      </button>
    </div>
  );
}

function ProjectDocumentsSection({
  currentProject,
  projectImportRef,
  handleProjectImport,
  onImportClick,
  onProjectTitleChange,
  projectDocs,
  projectSummaryDoc,
  openDocFromProject,
  formatDate,
  formatDocumentPageProgress,
  handleRemoveDocFromProject,
  exportDocument,
  handleBuildSummary,
  handleDeleteSummary,
}) {
  return (
    <section className="card home-bottom-card project-details-card">
      <div className="project-details-header">
        <input
          className="project-title-input"
          value={currentProject.title}
          onChange={(event) => onProjectTitleChange(event.target.value)}
          placeholder="Название проекта"
          spellCheck={false}
        />
      </div>

      <div className="project-details-actions">
        <button className="btn-tool" onClick={onImportClick}>📂 Загрузить .юрдок</button>
        <input ref={projectImportRef} type="file" accept=".юрдок,.yurdok" className="visually-hidden" onChange={handleProjectImport} />
      </div>

      {projectDocs.length > 0 ? (
        <div className="project-docs">
          <div className="card-label">Документы проекта ({projectDocs.length})</div>
          <div className="project-docs-list">
            {projectDocs.map((doc, index) => (
              <div key={doc.id} className="project-doc-item" onClick={() => openDocFromProject(doc)}>
                <span className="project-doc-num">{index + 1}</span>
                <div className="project-doc-body">
                  <div className="project-doc-title">{doc.title}</div>
                  <div className="project-doc-meta">
                    {formatDate(new Date(doc.savedAt))}
                    {doc.pageFrom && doc.pageTo && (
                      <span className="project-doc-range">{formatDocumentPageProgress(doc)}</span>
                    )}
                    {renderPersonBadgeCount(doc, (person) => person.category === 'private', 'badge badge-private', 'лиц')}
                    {renderPersonBadgeCount(doc, (person) => person.category === 'professional', 'badge badge-prof', 'проф.')}
                    {(doc.personalData?.otherPD?.length || 0) > 0 && (
                      <span className="badge badge-anon" style={{ marginLeft: 4 }}>{doc.personalData.otherPD.length} др. ПД</span>
                    )}
                  </div>
                </div>
                <button className="project-doc-export" onClick={(event) => { event.stopPropagation(); exportDocument(doc); }} title="Скачать .юрдок">⬇</button>
                <button className="project-doc-remove" onClick={(event) => { event.stopPropagation(); handleRemoveDocFromProject(doc.id); }} title="Убрать из проекта">✕</button>
              </div>
            ))}
          </div>

          {projectDocs.length >= 2 && (
            <div className="project-summary-actions">
              <button className="btn-primary btn-sm" onClick={handleBuildSummary}>📋 Собрать итоговый документ</button>
            </div>
          )}

          {projectSummaryDoc && (
            <div className="project-summary-section">
              <div className="card-label">Итоговый документ</div>
              <div className="project-doc-item project-summary-item" onClick={() => openDocFromProject(projectSummaryDoc)}>
                <span className="project-summary-icon">📋</span>
                <div className="project-doc-body">
                  <div className="project-doc-title">{projectSummaryDoc.title}</div>
                  <div className="project-doc-meta">
                    {formatDate(new Date(projectSummaryDoc.savedAt))}
                    <span className="badge badge-summary" style={{ marginLeft: 8 }}>итоговый</span>
                  </div>
                </div>
                <button className="project-doc-export" onClick={(event) => { event.stopPropagation(); exportDocument(projectSummaryDoc); }} title="Скачать .юрдок">⬇</button>
                <button className="project-doc-remove" onClick={(event) => handleDeleteSummary(event)} title="Удалить итоговый документ">✕</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="home-tab-empty">Загрузите файл, вставьте текст или импортируйте .юрдок внутри этого проекта.</div>
      )}
    </section>
  );
}

export default function ProjectWorkspaceView(props = {}) {
  const {
    currentProject,
    warningMessage,
    error,
  } = props;

  return (
    <>
      <div className="project-banner">
        <span className="project-banner-icon">📁</span>
        <span className="project-banner-label">Проект</span>
      </div>

      <ProviderSection {...props} />
      <UploadTabsSection {...props} />
      <BatchStatusSection {...props} />

      {warningMessage && <div className="warning-block">⚠️ {warningMessage}</div>}
      {error && <div className="error-block">⚠️ {error}</div>}

      <RecognizeButtonSection {...props} />
      <ProjectDocumentsSection currentProject={currentProject} {...props} />
    </>
  );
}
