/**
 * Hook de autenticação.
 *
 * Gerencia:
 * - Access token (JWT) + refresh token no localStorage
 * - Login, Register, Logout
 * - Sessão reativa via subscribeSession (roteção automática de exp)
 * - Reinício silencioso quando o access token vence mas temos refresh
 */
import { useState, useEffect, useCallback } from 'react';
import { getSession, setSession, subscribeSession, logoutSession } from '../lib/auth-session.ts';

interface User {
  id: number;
  email: string;
  name: string;
  /**
   * Flag de admin do usuário. Usada apenas pelo gate client-side do
   * `ProductHistoryPage` (defense in depth — backend é a fonte de verdade
   * via `getSuperAdminUser` em `/api/catalog/*`). Telas admin completas
   * migraram para `apps/admin-web`.
   */
  isAdmin?: boolean;
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
    const { accessToken } = getSession();
    return { user: null, token: accessToken, loading: !!accessToken };
  });

  // Verificar token na inicialização
  useEffect(() => {
    const { accessToken } = getSession();
    if (accessToken && !state.user) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.success && data.user) {
            setState((prev) => ({ ...prev, user: data.user, loading: false }));
          } else {
            // Token inválido (e refresh falhou no interceptor) → logout
            localStorage.removeItem(STORAGE_KEY);
            window.dispatchEvent(new CustomEvent('omestre:auth-changed'));
            setState({ user: null, token: null, loading: false });
          }
        })
        .catch(() => {
          setState((prev) => ({ ...prev, loading: false }));
        });
    } else if (!accessToken) {
      setState((prev) => ({ ...prev, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-sincroniza o token quando a sessão muda (login/logout/refresh)
  useEffect(() => {
    return subscribeSession(() => {
      const { accessToken } = getSession();
      if (accessToken && !state.user) {
        // refresh aconteceu; mantém user (vem do /me separado)
      }
      setState((prev) => ({ ...prev, token: accessToken }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = (await res.json()) as {
      success: boolean;
      token?: string;
      refreshToken?: string;
      user?: User;
      error?: string;
    };

    if (!data.success || !data.token) {
      throw new Error(data.error || 'Falha no login');
    }

    setSession(data.token, data.refreshToken ?? '');
    setState({ user: data.user!, token: data.token, loading: false });
    return data;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = (await res.json()) as {
      success: boolean;
      token?: string;
      refreshToken?: string;
      user?: User;
      error?: string;
    };

    if (!data.success || !data.token) {
      throw new Error(data.error || 'Falha no registro');
    }

    setSession(data.token, data.refreshToken ?? '');
    setState({ user: data.user!, token: data.token, loading: false });
    return data;
  }, []);

  const logout = useCallback(() => {
    const { refreshToken } = getSession();
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('omestre:auth-changed'));
    setState({ user: null, token: null, loading: false });
    if (refreshToken) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {});
    }
  }, []);

  return {
    user: state.user,
    token: state.token,
    loading: state.loading,
    isAuthenticated: !!state.user,
    isAdmin: state.user?.isAdmin === true,
    login,
    register,
    logout,
  };
}
