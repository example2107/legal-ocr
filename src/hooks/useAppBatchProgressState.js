import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadBatchProgressSnapshot,
  saveBatchProgressSnapshot,
} from '../utils/appWorkspaceHelpers';

export function useAppBatchProgressState({ projects } = {}) {
  const [progress, setProgress] = useState(null);
  const [activeBatchUiState, setActiveBatchUiState] = useState(null);
  const [persistedBatchUiState, setPersistedBatchUiState] = useState(() => loadBatchProgressSnapshot());
  const progressCreepRef = useRef(null);

  const setNonDecreasingProgress = useCallback((next) => {
    setProgress((prev) => (prev && prev.percent > next.percent
      ? { ...prev, message: next.message }
      : next
    ));
  }, []);

  const animateTo = useCallback((target, message) => {
    if (progressCreepRef.current) clearInterval(progressCreepRef.current);
    progressCreepRef.current = setInterval(() => {
      setProgress((prev) => {
        if (!prev) return prev;
        const current = Math.round(prev.percent);
        const safeTarget = Math.max(target, current);
        if (current >= safeTarget) {
          clearInterval(progressCreepRef.current);
          return { ...prev, percent: safeTarget, message: message || prev.message };
        }
        const step = Math.max(1, Math.round((safeTarget - current) / 5));
        return { ...prev, percent: Math.min(current + step, safeTarget) };
      });
    }, 100);
  }, []);

  const stopProgressCreep = useCallback(() => {
    if (!progressCreepRef.current) return;
    clearInterval(progressCreepRef.current);
    progressCreepRef.current = null;
  }, []);

  useEffect(() => {
    if (!activeBatchUiState) return;
    saveBatchProgressSnapshot(activeBatchUiState);
    setPersistedBatchUiState(activeBatchUiState);
  }, [activeBatchUiState]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!activeBatchUiState) return;
      if (!['running', 'pausing'].includes(activeBatchUiState.status)) return;

      saveBatchProgressSnapshot({
        ...activeBatchUiState,
        status: 'paused',
        message: activeBatchUiState.message || 'Обработка была приостановлена после обновления страницы.',
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [activeBatchUiState]);

  useEffect(() => {
    if (!persistedBatchUiState?.projectId) return;

    const matchingProject = projects.find((project) => project.id === persistedBatchUiState.projectId) || null;
    if (matchingProject?.batchSession && matchingProject.batchSession.status !== 'completed') {
      return;
    }

    saveBatchProgressSnapshot(null);
    setPersistedBatchUiState(null);
    setActiveBatchUiState((current) => (
      current?.projectId === persistedBatchUiState.projectId ? null : current
    ));
  }, [persistedBatchUiState, projects]);

  return {
    progress,
    setProgress,
    activeBatchUiState,
    setActiveBatchUiState,
    persistedBatchUiState,
    setPersistedBatchUiState,
    setNonDecreasingProgress,
    animateTo,
    stopProgressCreep,
  };
}
