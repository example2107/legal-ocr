import React, { useCallback, useEffect, useRef, useState } from 'react';

export default function OriginalViewerPanel({
  images = [],
  currentPage = 0,
  setCurrentPage,
  zoomActive = false,
  setZoomActive,
  zoomScale = 1,
  setZoomScale,
  width,
  onResizeStart,
  onClose,
} = {}) {
  const viewerBodyRef = useRef(null);
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const tipTimerRef = useRef(null);
  const zoomActiveRef = useRef(zoomActive);
  const [viewerTip, setViewerTip] = useState(null);

  useEffect(() => {
    zoomActiveRef.current = zoomActive;
  }, [zoomActive]);

  useEffect(() => () => {
    if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
  }, []);

  const resetZoom = useCallback(() => {
    setZoomScale(1);
    setZoomActive(false);
  }, [setZoomActive, setZoomScale]);

  const setViewerBodyElement = useCallback((el) => {
    if (viewerBodyRef.current) {
      viewerBodyRef.current.removeEventListener('wheel', viewerBodyRef.current._wheelHandler);
    }
    viewerBodyRef.current = el;
    if (!el) return;

    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (zoomActiveRef.current) {
        setZoomScale((scale) => {
          const delta = e.deltaY > 0 ? -0.1 : 0.1;
          return Math.min(4, Math.max(0.5, +(scale + delta).toFixed(2)));
        });
      } else {
        el.scrollTop += e.deltaY;
        el.scrollLeft += e.deltaX;
      }
    };

    viewerBodyRef.current._wheelHandler = handler;
    el.addEventListener('wheel', handler, { passive: false });
  }, [setZoomScale]);

  const stopDragAndTooltip = useCallback(() => {
    dragRef.current.dragging = false;
    setViewerTip(null);
    if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
  }, []);

  const handlePrevPage = useCallback(() => {
    setCurrentPage((page) => Math.max(0, page - 1));
    resetZoom();
  }, [resetZoom, setCurrentPage]);

  const handleNextPage = useCallback(() => {
    setCurrentPage((page) => Math.min(images.length - 1, page + 1));
    resetZoom();
  }, [images.length, resetZoom, setCurrentPage]);

  const handleClose = useCallback(() => {
    resetZoom();
    onClose?.();
  }, [onClose, resetZoom]);

  const handleImageMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragRef.current = {
      dragging: false,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: viewerBodyRef.current?.scrollLeft || 0,
      scrollTop: viewerBodyRef.current?.scrollTop || 0,
    };
  }, []);

  const handleImageMouseMove = useCallback((e) => {
    setViewerTip(null);
    if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
    tipTimerRef.current = setTimeout(() => setViewerTip({ x: e.clientX, y: e.clientY }), 600);

    if (!zoomActive || e.buttons !== 1) return;
    const dragState = dragRef.current;
    if (!dragState.dragging && (Math.abs(e.clientX - dragState.startX) > 5 || Math.abs(e.clientY - dragState.startY) > 5)) {
      dragState.dragging = true;
    }
    if (!dragState.dragging) return;

    const el = viewerBodyRef.current;
    if (!el) return;
    el.scrollLeft = dragState.scrollLeft - (e.clientX - dragState.startX);
    el.scrollTop = dragState.scrollTop - (e.clientY - dragState.startY);
  }, [zoomActive]);

  const handleImageDoubleClick = useCallback(() => {
    if (dragRef.current?.dragging) return;
    setZoomActive((active) => !active);
  }, [setZoomActive]);

  const currentImage = images[currentPage];

  return (
    <>
      <div className="panel-resizer" onMouseDown={onResizeStart}>
        <span className="panel-resizer-icon">‹<br />›</span>
      </div>
      <div className={'viewer-panel' + (zoomActive ? ' viewer-zoom-mode' : '')} style={{ width, flexShrink: 0 }}>
        <div className="viewer-header">
          <span className="viewer-title">Оригинальный файл</span>
          <div className="viewer-nav">
            <button className="viewer-nav-btn" disabled={currentPage === 0} onClick={handlePrevPage}>←</button>
            <span className="viewer-page-info">{currentPage + 1} / {images.length}</span>
            <button className="viewer-nav-btn" disabled={currentPage === images.length - 1} onClick={handleNextPage}>→</button>
          </div>
          <div className="viewer-zoom-controls">
            <button className="viewer-nav-btn" onClick={() => setZoomScale((scale) => Math.max(0.5, +(scale - 0.25).toFixed(2)))} title="Отдалить">−</button>
            <span className="viewer-page-info" style={{ minWidth: 40 }}>{Math.round(zoomScale * 100)}%</span>
            <button className="viewer-nav-btn" onClick={() => setZoomScale((scale) => Math.min(4, +(scale + 0.25).toFixed(2)))} title="Приблизить">+</button>
            <button className="viewer-nav-btn" onClick={resetZoom} title="Сбросить">↺</button>
          </div>
          <button className="viewer-close" onClick={handleClose}>✕ Скрыть</button>
        </div>
        <div
          ref={setViewerBodyElement}
          className={'viewer-body' + (zoomActive ? ' zoom-active' : '')}
          onMouseUp={() => { dragRef.current.dragging = false; }}
          onMouseLeave={stopDragAndTooltip}
        >
          <img
            src={'data:' + (currentImage?.mediaType || 'image/jpeg') + ';base64,' + currentImage?.base64}
            alt={'Страница ' + (currentPage + 1)}
            className="viewer-img"
            style={{
              transform: `scale(${zoomScale})`,
              transformOrigin: 'top left',
              cursor: zoomActive ? 'grab' : 'default',
              userSelect: 'none',
              transition: 'transform 0.15s ease',
            }}
            onMouseDown={handleImageMouseDown}
            onMouseMove={handleImageMouseMove}
            onDoubleClick={handleImageDoubleClick}
            onMouseLeave={() => {
              setViewerTip(null);
              if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
            }}
            draggable={false}
          />
          {viewerTip && (
            <div className="viewer-tooltip" style={{
              left: Math.min(viewerTip.x + 16, window.innerWidth - 276),
              top: viewerTip.y + 16,
            }}>
              {zoomActive
                ? <><span>🖱 Колесико — зум</span><span>✊ Зажать и тянуть — переместить</span><span>🔍 Двойной клик — выйти из зума</span></>
                : <span>🔍 Двойной клик — включить зум и перетаскивание</span>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
