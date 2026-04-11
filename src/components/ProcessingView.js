import React from 'react';

export default function ProcessingView({
  progress,
  activeBatchUiState,
  onPause,
  onResume,
  onReturnToProject,
} = {}) {
  if (!progress) return null;

  return (
    <div className="progress-card">
      <div className="progress-msg">{progress.message}</div>
      <div className="progress-bar-wrap">
        <div className="progress-bar" style={{ width: `${Math.round(progress.percent || 0)}%` }} />
      </div>
      <div className="progress-pct">{Math.round(progress.percent || 0)}%</div>
      <div className="project-batch-actions" style={{ marginTop: 12 }}>
        {activeBatchUiState?.status === 'paused' ? (
          <button className="btn-tool" onClick={onResume}>
            Продолжить распознавание
          </button>
        ) : activeBatchUiState?.status === 'pausing' ? (
          <button className="btn-tool btn-tool-disabled" type="button" disabled>
            Пауза запрошена
          </button>
        ) : (
          <button className="btn-tool" onClick={onPause}>
            Пауза
          </button>
        )}
        <button className="btn-tool" onClick={onReturnToProject}>
          Вернуться в проект
        </button>
      </div>
      {activeBatchUiState?.status === 'pausing' && (
        <div className="project-batch-pending-note" style={{ marginTop: 10 }}>
          Пауза будет поставлена сразу после завершения обработки текущей страницы.
        </div>
      )}
    </div>
  );
}
