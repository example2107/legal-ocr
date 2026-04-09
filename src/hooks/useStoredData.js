import { useCallback, useEffect, useRef, useState } from 'react';
import { listDocuments, listProjects } from '../utils/dataStore';

export function useStoredData({
  authLoading,
  isConfigured,
  userId,
  onError,
  onSignedOut,
}) {
  const [dataLoading, setDataLoading] = useState(isConfigured);
  const [history, setHistory] = useState([]);
  const [projects, setProjects] = useState([]);
  const hasHydratedCloudDataRef = useRef(false);

  const refreshHistory = useCallback(async () => {
    const docs = await listDocuments(userId ? { id: userId } : null);
    setHistory(docs);
    return docs;
  }, [userId]);

  const refreshProjects = useCallback(async () => {
    const nextProjects = await listProjects(userId ? { id: userId } : null);
    setProjects(nextProjects);
    return nextProjects;
  }, [userId]);

  useEffect(() => {
    if (authLoading) return;

    if (!isConfigured) {
      let active = true;

      Promise.all([listDocuments(null), listProjects(null)])
        .then(([docs, nextProjects]) => {
          if (!active) return;
          setHistory(docs);
          setProjects(nextProjects);
          hasHydratedCloudDataRef.current = true;
          setDataLoading(false);
        })
        .catch((err) => {
          if (!active) return;
          onError(err.message || 'Ошибка загрузки данных');
          setDataLoading(false);
        });

      return () => {
        active = false;
      };
    }

    if (!userId) {
      setHistory([]);
      setProjects([]);
      hasHydratedCloudDataRef.current = false;
      setDataLoading(false);
      if (onSignedOut) onSignedOut();
      return;
    }

    let active = true;
    const shouldBlockUi = !hasHydratedCloudDataRef.current;
    if (shouldBlockUi) setDataLoading(true);

    Promise.all([listDocuments({ id: userId }), listProjects({ id: userId })])
      .then(([docs, nextProjects]) => {
        if (!active) return;
        setHistory(docs);
        setProjects(nextProjects);
        hasHydratedCloudDataRef.current = true;
        setDataLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        onError(err.message || 'Ошибка загрузки данных');
        if (shouldBlockUi) setDataLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, isConfigured, onError, onSignedOut, userId]);

  return {
    dataLoading,
    history,
    projects,
    refreshHistory,
    refreshProjects,
    setProjects,
  };
}
