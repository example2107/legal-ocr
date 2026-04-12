import React from 'react';
import AuthScreen from './AuthScreen';
import AppHeader from './AppHeader';

function GateLoadingScreen({ title, user, onSignOut } = {}) {
  return (
    <div className="app">
      {user ? <AppHeader user={user} onSignOut={onSignOut} showNavigation={false} /> : null}
      <main className="main auth-main">
        <section className="card auth-card auth-loading-card">
          <h1 className="auth-title">{title}</h1>
        </section>
      </main>
    </div>
  );
}

export function getAppGateState({ isConfigured, authLoading, user, dataLoading } = {}) {
  if (isConfigured && authLoading) return 'profile-loading';
  if (isConfigured && !user) return 'auth';
  if (dataLoading) return 'data-loading';
  return null;
}

export default function AppGateScreen({
  gateState,
  isConfigured,
  user,
  authLoading,
  onSignIn,
  onSignUp,
  onSignOut,
} = {}) {
  if (gateState === 'profile-loading') {
    return <GateLoadingScreen title="Загрузка профиля" />;
  }

  if (gateState === 'auth') {
    return (
      <div className="app">
        <AppHeader showNavigation={false} />
        <AuthScreen
          isConfigured={isConfigured}
          onSignIn={onSignIn}
          onSignUp={onSignUp}
          loading={authLoading}
        />
      </div>
    );
  }

  if (gateState === 'data-loading') {
    return <GateLoadingScreen title="Загрузка данных" user={user} onSignOut={onSignOut} />;
  }

  return null;
}
