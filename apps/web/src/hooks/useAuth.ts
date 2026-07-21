/**
 * Hook de autenticação.
 *
 * Gerencia:
 * - Token JWT no localStorage
 * - Login, Register, Logout
 * - Estado do usuário logado
 */

import { useState, useEffect, useCallback } from 'react';

interface User {
  id: number;
  email: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
}

const STORAGE_KEY = 'omestre_auth_token';

export function useAuth() {
  const [state, setState] = useState<AuthState>(() => {
    const token = localStorage.getItem(STORAGE_KEY);
    return { user: null, token, loading: !!token };
  });

  // Verificar token na inicialização
  useEffect(() => {
    if (state.token && !state.user) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${state.token}` },
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.success && data.user) {
            setState((prev) => ({ ...prev, user: data.user, loading: false }));
          } else {
            // Token inválido
            localStorage.removeItem(STORAGE_KEY);
            setState({ user: null, token: null, loading: false });
          }
        })
        .catch(() => {
          setState((prev) => ({ ...prev, loading: false }));
        });
    } else if (!state.token) {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json() as { success: boolean; token?: string; user?: User; error?: string };

    if (!data.success || !data.token) {
      throw new Error(data.error || 'Falha no login');
    }

    localStorage.setItem(STORAGE_KEY, data.token);
    setState({ user: data.user!, token: data.token, loading: false });
    return data;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json() as { success: boolean; token?: string; user?: User; error?: string };

    if (!data.success || !data.token) {
      throw new Error(data.error || 'Falha no registro');
    }

    localStorage.setItem(STORAGE_KEY, data.token);
    setState({ user: data.user!, token: data.token, loading: false });
    return data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState({ user: null, token: null, loading: false });
  }, []);

  return {
    user: state.user,
    token: state.token,
    loading: state.loading,
    isAuthenticated: !!state.user,
    login,
    register,
    logout,
  };
}
