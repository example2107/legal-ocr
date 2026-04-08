import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../utils/supabaseClient';

const defaultAuthContext = {
  session: null,
  user: null,
  loading: false,
  isConfigured: false,
  signInWithPassword: async () => {
    throw new Error('Supabase не настроен');
  },
  signUpWithPassword: async () => {
    throw new Error('Supabase не настроен');
  },
  signOut: async () => {},
};

const AuthContext = createContext(defaultAuthContext);

function getEmailRedirectUrl() {
  if (typeof window === 'undefined' || !window.location?.origin) return undefined;
  return `${window.location.origin}/`;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return undefined;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session || null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({
    session,
    user: session?.user || null,
    loading,
    isConfigured: isSupabaseConfigured,
    signInWithPassword: async ({ email, password }) => {
      if (!supabase) throw new Error('Supabase не настроен');
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    signUpWithPassword: async ({ email, password }) => {
      if (!supabase) throw new Error('Supabase не настроен');
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getEmailRedirectUrl(),
        },
      });
      if (error) throw error;
    },
    signOut: async () => {
      if (!supabase) return;
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  }), [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
