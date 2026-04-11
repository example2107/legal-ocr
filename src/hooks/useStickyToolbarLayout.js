import { useEffect } from 'react';

export function useStickyToolbarLayout({
  headerRef,
  titleRowRef,
  parseCssSize,
} = {}) {
  useEffect(() => {
    const update = () => {
      const headerElement = headerRef.current;
      const titleElement = titleRowRef.current;
      const headerHeight = headerElement?.offsetHeight || parseCssSize(
        window.getComputedStyle(document.documentElement).getPropertyValue('--header-h'),
        60,
      );
      const headerBottom = headerElement?.getBoundingClientRect().bottom ?? headerHeight;

      if (headerElement) {
        document.documentElement.style.setProperty('--header-h', `${headerHeight}px`);
        document.documentElement.style.setProperty('--header-offset', `${Math.round(headerBottom)}px`);
      }

      if (titleElement) {
        const titleHeight = titleElement.offsetHeight;
        const titleBottom = Math.max(headerBottom, titleElement.getBoundingClientRect().bottom - 1);
        document.documentElement.style.setProperty('--titlerow-h', `${titleHeight}px`);
        document.documentElement.style.setProperty('--toolbar-top', `${Math.round(titleBottom)}px`);
      }
    };

    update();
    const resizeObserver = new ResizeObserver(update);
    if (headerRef.current) resizeObserver.observe(headerRef.current);
    if (titleRowRef.current) resizeObserver.observe(titleRowRef.current);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [headerRef, parseCssSize, titleRowRef]);
}
