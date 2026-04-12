import React from 'react';
import AppHeader from './AppHeader';
import AppMainContent from './AppMainContent';
import AppOverlays from './AppOverlays';

export default function AppWorkspaceScreen({
  headerProps,
  overlayProps,
  mainProps,
} = {}) {
  return (
    <div className="app">
      <AppHeader {...headerProps} />
      <AppOverlays {...overlayProps} />
      <main className={`main${mainProps.view === 'result' ? ' main-result' : ''}`}>
        <AppMainContent {...mainProps} />
      </main>
      <footer className="footer">
        ЮрДок — обработка происходит только в вашем браузере, документы не сохраняются на серверах
      </footer>
    </div>
  );
}
