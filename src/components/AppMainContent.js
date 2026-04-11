import React from 'react';
import HomeProjectsView from './HomeProjectsView';
import ProcessingView from './ProcessingView';
import ProjectWorkspaceView from './ProjectWorkspaceView';
import ResultWorkspaceView from './ResultWorkspaceView';

export default function AppMainContent({
  view,
  viewHome,
  viewProcessing,
  viewProject,
  viewResult,
  homeProps,
  projectProps,
  processingProps,
  resultProps,
} = {}) {
  return (
    <>
      {view === viewHome && (
        <HomeProjectsView {...homeProps} />
      )}

      {view === viewProject && projectProps?.currentProject && (
        <ProjectWorkspaceView {...projectProps} />
      )}

      {view === viewProcessing && processingProps?.progress && (
        <ProcessingView {...processingProps} />
      )}

      {view === viewResult && (
        <ResultWorkspaceView {...resultProps} />
      )}
    </>
  );
}
