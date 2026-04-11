import { useCallback, useEffect, useState } from 'react';

function getDefaultPdWidth() {
  return window.innerWidth >= 1800 ? 300 : window.innerWidth >= 1400 ? 270 : 240;
}

function getDefaultViewerWidth() {
  const viewportWidth = window.innerWidth;
  if (viewportWidth >= 1800) return 500;
  if (viewportWidth >= 1400) return 440;
  return 400;
}

export function useResizablePanels() {
  const [pdWidth, setPdWidth] = useState(getDefaultPdWidth);
  const [viewerWidth, setViewerWidth] = useState(getDefaultViewerWidth);

  const startResize = useCallback((type) => (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startPdWidth = pdWidth;
    const startViewerWidth = viewerWidth;

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const viewportWidth = window.innerWidth;

      if (type === 'pd') {
        const maxPdWidth = Math.min(400, Math.round(viewportWidth * 0.22));
        setPdWidth(Math.max(160, Math.min(maxPdWidth, startPdWidth + dx)));
        return;
      }

      const maxViewerWidth = Math.min(700, Math.round(viewportWidth * 0.4));
      setViewerWidth(Math.max(220, Math.min(maxViewerWidth, startViewerWidth - dx)));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [pdWidth, viewerWidth]);

  useEffect(() => {
    const onResize = () => {
      setPdWidth((width) => {
        const defaultWidth = getDefaultPdWidth();
        return Math.abs(width - defaultWidth) > 120 ? width : defaultWidth;
      });

      setViewerWidth((width) => {
        const defaultWidth = getDefaultViewerWidth();
        return Math.abs(width - defaultWidth) > 180 ? width : defaultWidth;
      });
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return {
    pdWidth,
    viewerWidth,
    startResize,
  };
}
