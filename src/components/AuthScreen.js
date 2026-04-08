import React, { useState } from 'react';

export default function AuthScreen({ isConfigured, onSignIn, onSignUp, loading }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!isConfigured) {
      setError('Supabase не настроен. Добавьте REACT_APP_SUPABASE_URL и REACT_APP_SUPABASE_ANON_KEY.');
      return;
    }
    if (!email.trim() || !password.trim()) {
      setError('Введите email и пароль.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await onSignIn({ email: email.trim(), password });
      } else {
        await onSignUp({ email: email.trim(), password });
        setMessage('Регистрация прошла успешно. Подтвердите адрес электронной почты, перейдя по ссылке, которая уже туда отправлена.');
        setMode('signin');
      }
    } catch (err) {
      setError(err.message || 'Ошибка авторизации');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="main auth-main">
      <section className="card auth-card">
        <div className="card-label">Supabase Auth</div>
        <h1 className="auth-title">Личный кабинет</h1>
        <p className="auth-subtitle">
          Документы, проекты и исходные файлы будут храниться в вашем рабочем пространстве.
        </p>

        <div className="auth-mode-switch">
          <button
            type="button"
            className={'auth-mode-btn' + (mode === 'signin' ? ' active' : '')}
            onClick={() => setMode('signin')}
          >
            Вход
          </button>
          <button
            type="button"
            className={'auth-mode-btn' + (mode === 'signup' ? ' active' : '')}
            onClick={() => setMode('signup')}
          >
            Регистрация
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label">
            <span>Email</span>
            <input
              className="auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={submitting || loading}
            />
          </label>
          <label className="auth-label">
            <span>Пароль</span>
            <input
              className="auth-input"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Минимум 6 символов"
              disabled={submitting || loading}
            />
          </label>

          {error && <div className="error-block">{error}</div>}
          {message && <div className="auth-message">{message}</div>}

          <button className="btn-primary auth-submit" type="submit" disabled={submitting || loading}>
            {submitting || loading
              ? 'Подождите...'
              : (mode === 'signin' ? 'Войти' : 'Создать аккаунт')}
          </button>
        </form>

        {!isConfigured && (
          <div className="auth-config-hint">
            Добавьте настройки Supabase в `.env.local` на основе `.env.example`.
          </div>
        )}
      </section>
    </main>
  );
}
