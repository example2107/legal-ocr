import React from 'react';

export default function HomeProjectsView({
  projects = [],
  onCreateProject,
  onOpenProject,
  onDeleteProject,
  formatDate,
} = {}) {
  return (
    <>
      <section className="home-projects-hero">
        <div className="home-projects-hero-content">
          <div className="home-projects-kicker">Рабочее пространство</div>
          <h1 className="home-projects-title">Проекты ЮрДок</h1>
          <p className="home-projects-subtitle">
            ЮрДок помогает распознавать, редактировать и обезличивать юридические документы. Вся работа с файлами и текстом ведётся внутри проекта.
          </p>
          <div className="home-projects-hero-actions">
            <button className="btn-primary" onClick={onCreateProject}>Создать проект</button>
            <div className="home-projects-hero-stat">
              <strong>{projects.length}</strong>
              <span>{projects.length === 1 ? 'проект' : projects.length < 5 ? 'проекта' : 'проектов'}</span>
            </div>
          </div>
        </div>
        <div className="home-projects-hero-glow" aria-hidden="true" />
      </section>

      {projects.length > 0 && (
        <section className="home-projects-list-wrap">
          <div className="projects-grid">
            {projects.map((project) => (
              <div key={project.id} className="project-card" onClick={() => onOpenProject(project.id)}>
                <div className="project-card-icon">📁</div>
                <div className="project-card-body">
                  <div className="project-card-title">{project.title}</div>
                  <div className="project-card-meta">
                    {project.documentIds.length} {project.documentIds.length === 1 ? 'документ' : project.documentIds.length < 5 ? 'документа' : 'документов'} · {formatDate(new Date(project.updatedAt || project.createdAt))}
                  </div>
                </div>
                <button className="project-delete" onClick={(event) => onDeleteProject(project.id, event)} title="Удалить проект">✕</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
