import React, { useRef } from 'react';
import { loadOriginalViewerFiles } from '../utils/originalViewerFiles';

export default function DocumentTitleActions({
  hasOriginalImages = false,
  showOriginal = false,
  onToggleOriginal,
  onOriginalImagesLoaded,
  onSave,
  onExportDocx,
  onExportPdf,
} = {}) {
  const viewerFileInputRef = useRef(null);

  const handleViewerFileChange = async (e) => {
    const newFiles = Array.from(e.target.files || []);
    e.target.value = '';
    if (!newFiles.length) return;

    const allImages = await loadOriginalViewerFiles(newFiles);
    onOriginalImagesLoaded?.(allImages);
  };

  return (
    <div className="doc-title-actions">
      {hasOriginalImages ? (
        <button
          className={'btn-tool btn-original' + (showOriginal ? ' active' : '')}
          onClick={onToggleOriginal}
        >
          👁 Оригинал
        </button>
      ) : (
        <button
          className="btn-tool btn-original"
          onClick={() => viewerFileInputRef.current?.click()}
          title="Загрузите оригинал для просмотра рядом с текстом"
        >
          👁 Загрузить оригинал
        </button>
      )}
      <input
        ref={viewerFileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf"
        className="visually-hidden"
        onChange={handleViewerFileChange}
      />
      <button className="btn-tool btn-save" onClick={onSave}>💾 Сохранить</button>
      <button className="btn-tool" onClick={onExportDocx}>⬇ DOCX</button>
      <button className="btn-tool" onClick={onExportPdf}>⬇ PDF</button>
    </div>
  );
}
