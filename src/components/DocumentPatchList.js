import React from 'react';

export default function DocumentPatchList({
  activePatchEntries = [],
  canOpenPage,
  onOpenPage,
  onRemovePatch,
  onClearAll,
  formatPatchText,
} = {}) {
  if (!activePatchEntries.length) return null;

  return (
    <div
      style={{
        margin: '0 18px 14px',
        padding: 12,
        border: '1px solid var(--border)',
        borderRadius: 14,
        background: 'var(--panel2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)' }}>
          Локальные правки PDF: {activePatchEntries.length}
        </div>
        <button className="btn-tool" type="button" onClick={onClearAll}>
          Очистить все правки
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {activePatchEntries
          .slice()
          .sort((a, b) => a.pageNumber - b.pageNumber || String(a.appliedAt || '').localeCompare(String(b.appliedAt || '')))
          .map((patchEntry) => {
            const pageIsAvailable = canOpenPage?.(patchEntry.pageNumber);
            const patchText = formatPatchText?.(patchEntry);

            return (
              <div
                key={patchEntry.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: '#fff',
                  border: '1px solid var(--border)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220, flex: '1 1 280px' }}>
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                    Стр. {patchEntry.pageNumber}
                    {patchEntry.patchPlan?.status === 'review_required' ? ' · нужна проверка' : ''}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text1)' }}>
                    {patchText || 'Текст замены сохранён в patch plan'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn-tool"
                    type="button"
                    disabled={!pageIsAvailable}
                    onClick={() => onOpenPage?.(patchEntry.pageNumber)}
                    title={pageIsAvailable ? 'Открыть страницу в просмотрщике' : 'Сначала загрузите оригинальный PDF в просмотрщик'}
                  >
                    Открыть страницу
                  </button>
                  <button className="btn-tool" type="button" onClick={() => onRemovePatch?.(patchEntry)}>
                    Удалить правку
                  </button>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
