import { useCallback, useEffect } from 'react';

function parseCssSize(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value || '').replace('px', '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function useEditorPageNavigation({
  view,
  viewResult,
  editorHtml,
  editorDomRef,
  pageMetadata,
  titleRowRef,
  originalImages,
  getOriginalImageIndexForPage,
  setOriginalPage,
  editorCurrentPage,
  setEditorCurrentPage,
  editorTotalPages,
  setEditorTotalPages,
  editorPageInput,
  setEditorPageInput,
  editorNavigatingPageRef,
  editorPageNavigationTimerRef,
} = {}) {
  const syncOriginalViewerToDocumentPage = useCallback((pageNumber) => {
    const imageIndex = getOriginalImageIndexForPage(originalImages, pageNumber);
    if (imageIndex < 0) return;
    setOriginalPage(imageIndex);
  }, [getOriginalImageIndexForPage, originalImages, setOriginalPage]);

  const getEditorPageSeparators = useCallback(() => {
    if (!editorDomRef.current) return [];
    return Array.from(editorDomRef.current.querySelectorAll('.page-separator[data-page]'))
      .map((el) => ({
        el,
        pageNumber: Number(el.dataset.page || 0),
      }))
      .filter((item) => item.pageNumber > 0);
  }, [editorDomRef]);

  const getEditorTotalPages = useCallback(() => {
    const separators = getEditorPageSeparators();
    if (separators.length > 0) {
      return separators[separators.length - 1].pageNumber;
    }
    return pageMetadata?.sources?.[0]?.totalPages || pageMetadata?.sources?.[0]?.pageTo || null;
  }, [getEditorPageSeparators, pageMetadata]);

  const getEditorScrollOffset = useCallback(() => {
    const rootStyles = window.getComputedStyle(document.documentElement);
    const headerHeight = parseCssSize(rootStyles.getPropertyValue('--header-h'), 60);
    const stickyGap = parseCssSize(rootStyles.getPropertyValue('--sticky-gap'), 10);
    const titleHeight = titleRowRef.current?.getBoundingClientRect().height
      || parseCssSize(rootStyles.getPropertyValue('--titlerow-h'), 49);
    const toolbarHeight = titleRowRef.current
      ?.closest('.doc-card')
      ?.querySelector('.rich-toolbar')
      ?.getBoundingClientRect()
      ?.height || 44;
    return Math.round(headerHeight + stickyGap + titleHeight + toolbarHeight + 12);
  }, [titleRowRef]);

  const getCurrentEditorPageNumber = useCallback(() => {
    const separators = getEditorPageSeparators();
    if (separators.length === 0) return null;

    const threshold = getEditorScrollOffset();
    const viewportBottom = window.innerHeight || document.documentElement.clientHeight || 0;
    const nearDocumentBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    let currentPage = separators[0].pageNumber;
    for (const separator of separators) {
      const rect = separator.el.getBoundingClientRect();
      if (rect.top <= threshold) {
        currentPage = separator.pageNumber;
        continue;
      }
      if (rect.top < viewportBottom && nearDocumentBottom) {
        currentPage = separator.pageNumber;
      } else {
        break;
      }
    }
    return currentPage;
  }, [getEditorPageSeparators, getEditorScrollOffset]);

  const releaseEditorPageNavigationLock = useCallback((fallbackPage = null) => {
    const lockedPage = editorNavigatingPageRef.current ?? fallbackPage;
    editorNavigatingPageRef.current = null;
    if (editorPageNavigationTimerRef.current) {
      clearTimeout(editorPageNavigationTimerRef.current);
      editorPageNavigationTimerRef.current = null;
    }
    if (!lockedPage) return;
    const resolvedPage = getCurrentEditorPageNumber() || lockedPage;
    setEditorCurrentPage(resolvedPage);
    setEditorPageInput(String(resolvedPage));
    syncOriginalViewerToDocumentPage(resolvedPage);
  }, [
    editorNavigatingPageRef,
    editorPageNavigationTimerRef,
    getCurrentEditorPageNumber,
    setEditorCurrentPage,
    setEditorPageInput,
    syncOriginalViewerToDocumentPage,
  ]);

  const goToEditorPage = useCallback((pageNumber) => {
    const targetPage = Number(pageNumber || 0);
    if (!targetPage || !editorDomRef.current) return false;
    const targetSeparator = editorDomRef.current.querySelector(`.page-separator[data-page="${targetPage}"]`);
    if (!targetSeparator) return false;
    if (editorPageNavigationTimerRef.current) {
      clearTimeout(editorPageNavigationTimerRef.current);
      editorPageNavigationTimerRef.current = null;
    }
    editorNavigatingPageRef.current = targetPage;
    setEditorCurrentPage(targetPage);
    setEditorPageInput(String(targetPage));
    syncOriginalViewerToDocumentPage(targetPage);
    const targetTop = window.scrollY + targetSeparator.getBoundingClientRect().top - getEditorScrollOffset();
    requestAnimationFrame(() => {
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      });
    });
    editorPageNavigationTimerRef.current = window.setTimeout(() => {
      if (editorNavigatingPageRef.current === targetPage) {
        releaseEditorPageNavigationLock(targetPage);
      }
    }, 1800);
    return true;
  }, [
    editorDomRef,
    editorNavigatingPageRef,
    editorPageNavigationTimerRef,
    getEditorScrollOffset,
    releaseEditorPageNavigationLock,
    setEditorCurrentPage,
    setEditorPageInput,
    syncOriginalViewerToDocumentPage,
  ]);

  const handleEditorPageSubmit = useCallback(() => {
    const totalPages = getEditorTotalPages();
    const rawPage = Number(editorPageInput || 0);
    if (!rawPage) return;
    const targetPage = totalPages
      ? Math.max(1, Math.min(totalPages, rawPage))
      : rawPage;
    if (!targetPage) return;
    goToEditorPage(targetPage);
  }, [editorPageInput, getEditorTotalPages, goToEditorPage]);

  const handleEditorPageStep = useCallback((direction) => {
    const currentPage = editorNavigatingPageRef.current || editorCurrentPage || getCurrentEditorPageNumber();
    const totalPages = editorTotalPages || getEditorTotalPages();
    if (!currentPage || !totalPages) return;
    const nextPage = Math.max(1, Math.min(totalPages, currentPage + direction));
    goToEditorPage(nextPage);
  }, [
    editorCurrentPage,
    editorNavigatingPageRef,
    editorTotalPages,
    getCurrentEditorPageNumber,
    getEditorTotalPages,
    goToEditorPage,
  ]);

  useEffect(() => {
    if (view !== viewResult) return;
    let rafId = null;

    const syncActualPage = () => {
      const currentPage = getCurrentEditorPageNumber();
      const totalPages = getEditorTotalPages();
      setEditorCurrentPage(currentPage || (totalPages ? 1 : null));
      setEditorTotalPages(totalPages || null);
      if (currentPage) {
        setEditorPageInput(String(currentPage));
        syncOriginalViewerToDocumentPage(currentPage);
      }
    };

    const syncPageInput = () => {
      const navigatingPage = editorNavigatingPageRef.current;
      const totalPages = getEditorTotalPages();
      setEditorTotalPages(totalPages || null);
      if (navigatingPage != null) {
        setEditorCurrentPage(navigatingPage);
        setEditorPageInput(String(navigatingPage));
        syncOriginalViewerToDocumentPage(navigatingPage);
        if (editorPageNavigationTimerRef.current) {
          clearTimeout(editorPageNavigationTimerRef.current);
        }
        editorPageNavigationTimerRef.current = window.setTimeout(() => {
          releaseEditorPageNavigationLock(navigatingPage);
        }, 180);
        return;
      }
      syncActualPage();
    };

    const handleScroll = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(syncPageInput);
    };

    syncActualPage();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (editorPageNavigationTimerRef.current) {
        clearTimeout(editorPageNavigationTimerRef.current);
        editorPageNavigationTimerRef.current = null;
      }
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [
    editorHtml,
    editorNavigatingPageRef,
    editorPageNavigationTimerRef,
    getCurrentEditorPageNumber,
    getEditorTotalPages,
    releaseEditorPageNavigationLock,
    setEditorCurrentPage,
    setEditorPageInput,
    setEditorTotalPages,
    syncOriginalViewerToDocumentPage,
    view,
    viewResult,
  ]);

  return {
    syncOriginalViewerToDocumentPage,
    getEditorPageSeparators,
    getEditorTotalPages,
    handleEditorPageSubmit,
    handleEditorPageStep,
    goToEditorPage,
  };
}
