import React, { useEffect } from 'react';

export default function PdfPatchExportPreviewModal({
  open,
  exportReadyPatchEntries = [],
  nonExportablePatchEntries = [],
  hasOriginalImages = false,
  canProceed = false,
  onClose,
  onConfirm,
  onOpenPage,
  canOpenPage,
  formatPatchText,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onMouseDown={() => onClose?.()}>
      <div
        className="modal modal-scrollable"
        style={{ maxWidth: 760 }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-title">Предпросмотр PDF-экспорта</div>
        <div className="modal-body modal-scrollable-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ color: 'var(--text2)' }}>
            Перед сохранением видно, какие локальные правки попадут в PDF, а какие будут пропущены.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--panel2)', border: '1px solid var(--border)' }}>
              Будут включены: <strong>{exportReadyPatchEntries.length}</strong>
            </div>
            <div style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--panel2)', border: '1px solid var(--border)' }}>
              Будут пропущены: <strong>{nonExportablePatchEntries.length}</strong>
            </div>
            <div style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--panel2)', border: '1px solid var(--border)' }}>
              Оригинал загружен: <strong>{hasOriginalImages ? 'да' : 'нет'}</strong>
            </div>
          </div>
          {exportReadyPatchEntries.length > 0 && !canProceed && (
            <div style={{ color: 'var(--danger, #b42318)' }}>
              Для экспорта этих правок сначала загрузите оригинальный PDF в просмотрщик.
            </div>
          )}
          {exportReadyPatchEntries.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontWeight: 700 }}>Войдут в PDF</div>
              {exportReadyPatchEntries
                .slice()
                .sort((a, b) => a.pageNumber - b.pageNumber)
                .map((patchEntry) => (
                  <div
                    key={`pdf-ready-${patchEntry.id}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      background: '#fff',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ minWidth: 240, flex: '1 1 300px' }}>
                      <div style={{ fontSize: 12, color: 'var(--text2)' }}>Стр. {patchEntry.pageNumber} · готово к локальной замене</div>
                      <div style={{ fontSize: 13, color: 'var(--text1)' }}>
                        {formatPatchText?.(patchEntry.patchPlan?.replacementText || '') || 'Текст замены сохранён в patch plan'}
                      </div>
                    </div>
                    <button
                      className="btn-tool"
                      type="button"
                      disabled={!canOpenPage?.(patchEntry.pageNumber)}
                      onClick={() => onOpenPage?.(patchEntry.pageNumber)}
                    >
                      Открыть страницу
                    </button>
                  </div>
                ))}
            </div>
          )}
          {nonExportablePatchEntries.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontWeight: 700 }}>Не войдут автоматически</div>
              {nonExportablePatchEntries
                .slice()
                .sort((a, b) => a.pageNumber - b.pageNumber)
                .map((patchEntry) => (
                  <div
                    key={`pdf-skip-${patchEntry.id}`}
                    style={{
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      background: 'var(--panel2)',
                    }}
                  >
                    <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                      Стр. {patchEntry.pageNumber} · {patchEntry.patchPlan?.status === 'review_required' ? 'требует ручной проверки' : 'пока не поддерживается'}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text1)' }}>
                      {formatPatchText?.(patchEntry.patchPlan?.replacementText || '') || 'Текст замены сохранён в patch plan'}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
        <div className="modal-actions modal-scrollable-actions">
          <button className="btn-tool" onClick={onClose}>Отмена</button>
          <button
            className="btn-primary btn-sm"
            onClick={() => { void onConfirm?.(); }}
            disabled={!canProceed}
          >
            Экспортировать PDF
          </button>
        </div>
      </div>
    </div>
  );
}
