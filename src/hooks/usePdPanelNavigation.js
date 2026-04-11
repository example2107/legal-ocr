import { useCallback, useRef, useState } from 'react';

function restorePanelScroll(panel, scrollTop) {
  if (panel) panel.scrollTop = scrollTop;
}

function flashTarget(target) {
  target.classList.add('pd-flash');
  setTimeout(() => target.classList.remove('pd-flash'), 700);
}

function watchTargetVisibility(target, panel, scrollTop) {
  const observer = new IntersectionObserver((entries, currentObserver) => {
    const [entry] = entries;
    if (entry.isIntersecting) {
      currentObserver.disconnect();
      restorePanelScroll(panel, scrollTop);
      flashTarget(target);
    }
  }, { threshold: 0.5 });

  observer.observe(target);
  setTimeout(() => observer.disconnect(), 2000);
}

export function usePdPanelNavigation({
  editorDomRef,
} = {}) {
  const pdPanelRef = useRef(null);
  const pdNavIndexRef = useRef({});
  const pdNavTimerRef = useRef({});
  const [pdNavState, setPdNavState] = useState({});

  const setPdPanelRef = useCallback((element) => {
    if (pdPanelRef.current) {
      pdPanelRef.current.removeEventListener('wheel', pdPanelRef.current._wheelHandler);
    }

    pdPanelRef.current = element;
    if (!element) return;

    const handler = (event) => {
      const isScrollable = element.scrollHeight > element.clientHeight;
      if (!isScrollable) return;
      event.preventDefault();
      element.scrollTop += event.deltaY;
    };

    element._wheelHandler = handler;
    element.addEventListener('wheel', handler, { passive: false });
  }, []);

  const initNavCounter = useCallback((id) => {
    if (!editorDomRef.current) return;
    const total = editorDomRef.current.querySelectorAll(`mark[data-pd-id="${id}"]`).length;
    if (total === 0) return;

    setPdNavState((prev) => {
      const existing = prev[id];
      if (existing && existing.total === total) return prev;
      return { ...prev, [id]: { cur: existing?.cur ?? -1, total } };
    });
  }, [editorDomRef]);

  const navigateToPd = useCallback((id, direction, event) => {
    event.stopPropagation();
    if (!editorDomRef.current) return;

    const marks = Array.from(editorDomRef.current.querySelectorAll(`mark[data-pd-id="${id}"]`));
    if (marks.length === 0) return;

    const currentIndex = pdNavIndexRef.current[id] ?? -1;
    const nextIndex = direction === 'down'
      ? (currentIndex >= marks.length - 1 ? 0 : currentIndex + 1)
      : (currentIndex <= 0 ? marks.length - 1 : currentIndex - 1);

    pdNavIndexRef.current[id] = nextIndex;
    setPdNavState((prev) => ({ ...prev, [id]: { cur: nextIndex, total: marks.length } }));

    if (pdNavTimerRef.current[id]) clearTimeout(pdNavTimerRef.current[id]);
    pdNavTimerRef.current[id] = setTimeout(() => {
      setPdNavState((prev) => {
        const entry = prev[id];
        if (!entry || entry.cur === -1) return prev;
        return { ...prev, [id]: { ...entry, cur: -1 } };
      });
    }, 10000);

    const target = marks[nextIndex];
    const panel = pdPanelRef.current;
    const panelScrollTop = panel ? panel.scrollTop : 0;
    const targetRect = target.getBoundingClientRect();
    const isVisible = targetRect.top >= 0 && targetRect.bottom <= window.innerHeight;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    restorePanelScroll(panel, panelScrollTop);

    if (isVisible) {
      flashTarget(target);
      return;
    }

    setTimeout(() => restorePanelScroll(panel, panelScrollTop), 400);
    watchTargetVisibility(target, panel, panelScrollTop);
  }, [editorDomRef]);

  return {
    setPdPanelRef,
    initNavCounter,
    navigateToPd,
    pdNavState,
    setPdNavState,
    pdNavIndexRef,
    pdNavTimerRef,
  };
}
