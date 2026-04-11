import { useCallback, useMemo } from 'react';
import { getProjectSummaryDocEntry } from '../utils/projectDocumentOps';

function hasSharedProjectPD(project) {
  return Boolean(
    project?.sharedPD
    && (
      (project.sharedPD.persons || []).length > 0
      || (project.sharedPD.otherPD || []).length > 0
    )
  );
}

function buildPersistedBatchDisplayState(project, persistedBatchUiState) {
  return {
    ...project.batchSession,
    ...persistedBatchUiState,
    status: persistedBatchUiState.status || project.batchSession.status,
    error: persistedBatchUiState.error || project.batchSession.error || '',
  };
}

function buildStoredBatchDisplayState(project) {
  return {
    projectId: project.id,
    sourceKind: project.batchSession.sourceKind || 'pdf',
    fileName: project.batchSession.fileName || '',
    totalPages: project.batchSession.totalPages || 0,
    nextPage: project.batchSession.nextPage || 1,
    currentPageFrom: project.batchSession.currentPageFrom || null,
    currentPageTo: project.batchSession.currentPageTo || null,
    progressPercent: project.batchSession.progressPercent ?? null,
    message: project.batchSession.progressMessage || '',
    status: project.batchSession.status || 'paused',
    error: project.batchSession.error || '',
  };
}

function buildProjectBatchDisplayState(project, activeBatchUiState, persistedBatchUiState) {
  if (!project?.batchSession || project.batchSession.status === 'completed') return null;
  if (activeBatchUiState?.projectId === project.id) return activeBatchUiState;
  if (persistedBatchUiState?.projectId === project.id) {
    return buildPersistedBatchDisplayState(project, persistedBatchUiState);
  }
  return buildStoredBatchDisplayState(project);
}

export function useProjectDerivedState({
  projects,
  history,
  currentProjectId,
  activeBatchUiState,
  persistedBatchUiState,
} = {}) {
  const currentProject = useMemo(() => (
    currentProjectId
      ? (projects.find((item) => item.id === currentProjectId) || null)
      : null
  ), [currentProjectId, projects]);

  const currentBatchSession = currentProject?.batchSession || null;

  const currentBatchDisplayState = useMemo(() => (
    currentProject
      ? buildProjectBatchDisplayState(currentProject, activeBatchUiState, persistedBatchUiState)
      : null
  ), [activeBatchUiState, currentProject, persistedBatchUiState]);

  const projectDocs = useMemo(() => {
    if (!currentProject) return [];
    return currentProject.documentIds
      .map((id) => history.find((entry) => entry.id === id))
      .filter((entry) => entry && !entry.isProjectSummary);
  }, [currentProject, history]);

  const getProjectDocs = useCallback(() => projectDocs, [projectDocs]);

  const projectSummaryDoc = useMemo(() => {
    if (!currentProject) return null;
    return getProjectSummaryDocEntry(history, currentProjectId);
  }, [currentProject, currentProjectId, history]);

  const getProjectExistingPD = useCallback(() => {
    if (hasSharedProjectPD(currentProject)) {
      return currentProject.sharedPD;
    }
    if (projectDocs.length === 0) return null;
    const lastDoc = projectDocs[projectDocs.length - 1];
    return lastDoc.personalData || null;
  }, [currentProject, projectDocs]);

  return {
    currentProject,
    currentBatchSession,
    currentBatchDisplayState,
    projectDocs,
    getProjectDocs,
    projectSummaryDoc,
    getProjectExistingPD,
  };
}
