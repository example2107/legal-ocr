import React from 'react';

export default function AppHeader({
  view,
  currentProjectId,
  user,
  onGoHome,
  onGoBackToProject,
  onSignOut,
  showNavigation = true,
  headerRef = null,
} = {}) {
  const showResultProjectButton = showNavigation && view === 'result' && currentProjectId;
  const showResultHomeButton = showNavigation && view === 'result' && !currentProjectId;
  const showProjectHomeButton = showNavigation && view === 'project';
  const logoClickable = showNavigation && view !== 'home';

  return (
    <header className="header" ref={headerRef}>
      <div className="header-inner">
        <div className="header-left" />
        <div className="header-center">
          {showResultProjectButton && (
            <button className="btn-tool header-home-btn" onClick={onGoBackToProject}>← Проект</button>
          )}
          {showResultHomeButton && (
            <button className="btn-tool header-home-btn" onClick={onGoHome}>← На главную</button>
          )}
          {showProjectHomeButton && (
            <button className="btn-tool header-home-btn" onClick={onGoHome}>← На главную</button>
          )}
          <div
            className="logo"
            onClick={logoClickable ? onGoHome : undefined}
            style={logoClickable ? { cursor: 'pointer' } : undefined}
          >
            <span className="logo-icon">⚖</span>
            <div>
              <div className="logo-title">ЮрДок</div>
              <div className="logo-sub">Распознавание документов</div>
            </div>
          </div>
        </div>
        <div className="header-right">
          {user && (
            <div className="header-user">
              <div className="header-user-meta">
                <span className="header-user-label">Аккаунт</span>
                <span className="header-user-email">{user.email}</span>
              </div>
              <button className="header-user-logout" onClick={onSignOut}>Выйти</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
