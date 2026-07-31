import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, type Me, type Role } from './api';

interface AuthCtx {
  user: Me | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  /** Есть ли у пользователя роль не ниже указанной */
  atLeast: (role: Role) => boolean;
}

const ROLE_ORDER: Record<Role, number> = { NONE: 0, VIEWER: 1, EDITOR: 2, ADMIN: 3 };

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get<Me>('/auth/me');
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const login = useCallback(async (loginName: string, password: string) => {
    const { data } = await api.post<{ user: Me }>('/auth/login', { login: loginName, password });
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
      location.href = '/login';
    }
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading,
      login,
      logout,
      reload,
      atLeast: (role) => !!user && ROLE_ORDER[user.role] >= ROLE_ORDER[role],
    }),
    [user, loading, login, logout, reload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
