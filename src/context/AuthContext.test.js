import React, { act } from 'react';
import ReactDOM from 'react-dom/client';

let mockConfigured = false;
let mockSupabase = null;

jest.mock('../utils/supabaseClient', () => ({
  get isSupabaseConfigured() {
    return mockConfigured;
  },
  get supabase() {
    return mockSupabase;
  },
}));

import { AuthProvider, useAuth } from './AuthContext';

describe('AuthContext', () => {
  let container;
  let root;
  let latestAuth;

  function Consumer() {
    latestAuth = useAuth();
    return (
      <div>
        <span data-testid="loading">{latestAuth.loading ? 'loading' : 'ready'}</span>
        <span data-testid="user">{latestAuth.user?.email || 'guest'}</span>
      </div>
    );
  }

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    mockConfigured = false;
    mockSupabase = null;
    latestAuth = null;
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    jest.clearAllMocks();
  });

  test('exposes non-configured fallback state', async () => {
    act(() => {
      root.render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
    });

    await flush();

    expect(container.querySelector('[data-testid="loading"]').textContent).toBe('ready');
    expect(container.querySelector('[data-testid="user"]').textContent).toBe('guest');
    await expect(latestAuth.signInWithPassword({ email: 'user@test.dev', password: 'secret' }))
      .rejects.toThrow('Supabase не настроен');
  });

  test('loads current session and updates on auth state changes', async () => {
    let onAuthStateChangeHandler = null;
    const unsubscribe = jest.fn();

    mockConfigured = true;
    mockSupabase = {
      auth: {
        getSession: jest.fn().mockResolvedValue({
          data: {
            session: {
              user: { id: 'user_1', email: 'first@test.dev' },
            },
          },
        }),
        onAuthStateChange: jest.fn((handler) => {
          onAuthStateChangeHandler = handler;
          return { data: { subscription: { unsubscribe } } };
        }),
        signInWithPassword: jest.fn().mockResolvedValue({ error: null }),
        signUp: jest.fn().mockResolvedValue({ error: null }),
        signOut: jest.fn().mockResolvedValue({ error: null }),
      },
    };

    act(() => {
      root.render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
    });

    await flush();

    expect(container.querySelector('[data-testid="loading"]').textContent).toBe('ready');
    expect(container.querySelector('[data-testid="user"]').textContent).toBe('first@test.dev');

    await act(async () => {
      onAuthStateChangeHandler('SIGNED_IN', {
        user: { id: 'user_2', email: 'second@test.dev' },
      });
    });

    expect(container.querySelector('[data-testid="user"]').textContent).toBe('second@test.dev');

    act(() => {
      root.unmount();
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    root = ReactDOM.createRoot(container);
  });

  test('passes current origin into sign up email redirect', async () => {
    const signUp = jest.fn().mockResolvedValue({ error: null });

    mockConfigured = true;
    mockSupabase = {
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
        onAuthStateChange: jest.fn(() => ({
          data: { subscription: { unsubscribe: jest.fn() } },
        })),
        signInWithPassword: jest.fn().mockResolvedValue({ error: null }),
        signUp,
        signOut: jest.fn().mockResolvedValue({ error: null }),
      },
    };

    act(() => {
      root.render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
    });

    await flush();
    await latestAuth.signUpWithPassword({ email: 'new@test.dev', password: 'secret' });

    expect(signUp).toHaveBeenCalledWith({
      email: 'new@test.dev',
      password: 'secret',
      options: {
        emailRedirectTo: `${window.location.origin}/`,
      },
    });
  });
});
