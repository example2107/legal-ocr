import { useEffect, useRef } from 'react';

const DEFAULT_TITLE = 'ЮрДок — распознавание документов';

// Во время распознавания:
//  1) показывает прогресс прямо в заголовке вкладки (виден в полоске вкладок,
//     даже когда тело страницы не перерисовывается в фоне);
//  2) удерживает Screen Wake Lock, чтобы экран/система не уснули и обработка
//     не прервалась. Wake Lock автоматически снимается браузером, когда вкладка
//     уходит в фон, поэтому повторно запрашиваем его при возврате во вкладку.
export function useBackgroundProcessingFeedback({ progress }) {
  const baseTitleRef = useRef(
    typeof document !== 'undefined' && document.title ? document.title : DEFAULT_TITLE,
  );
  const wakeLockRef = useRef(null);

  const isProcessing = !!progress && Number(progress.percent) < 100;
  const percent = progress ? Math.round(Number(progress.percent) || 0) : 0;
  const current = progress?.current;
  const total = progress?.total;

  // ── Прогресс в заголовке вкладки ──────────────────────────────────────────
  useEffect(() => {
    const base = baseTitleRef.current || DEFAULT_TITLE;
    if (!isProcessing) {
      document.title = base;
      return;
    }
    const pages = current && total ? ` (${current}/${total})` : '';
    document.title = `⏳ ${percent}%${pages} — ${base}`;
  }, [isProcessing, percent, current, total]);

  // Гарантированно возвращаем исходный заголовок при размонтировании
  useEffect(() => () => {
    document.title = baseTitleRef.current || DEFAULT_TITLE;
  }, []);

  // ── Screen Wake Lock ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isProcessing) return undefined;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return undefined;

    let cancelled = false;

    const acquire = async () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      if (wakeLockRef.current) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          lock.release().catch(() => {});
          return;
        }
        wakeLockRef.current = lock;
        // Браузер снимает блокировку сам (например, при сворачивании вкладки) —
        // обнуляем ссылку, чтобы при возврате запросить заново.
        lock.addEventListener('release', () => {
          wakeLockRef.current = null;
        });
      } catch {
        // best-effort: если запросить не удалось, просто продолжаем без блокировки
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      const lock = wakeLockRef.current;
      wakeLockRef.current = null;
      if (lock) lock.release().catch(() => {});
    };
  }, [isProcessing]);
}
