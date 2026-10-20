import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { errorKind, humanError } from './errors';
import { loginToEmail } from './login';
import { isConfigured, supabase } from './supabase';
import { clearQueryCache, setQueryCacheUser } from './useQuery';

export type Role = 'master' | 'manager';

export type Me = { id: number; displayName: string; role: Role; login: string | null };

type AuthState = {
  loading: boolean;
  session: Session | null;
  me: Me | null;
  /** Учётка есть, но не привязана к сотруднику или выключена. */
  accessError: string | null;
  /** Не удалось связаться с сервером при проверке входа. */
  loadError: string | null;
  retry: () => void;
  signIn: (login: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

async function loadMe(): Promise<Me | null> {
  const { data, error } = await supabase.rpc('whoami');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { id: row.id, displayName: row.display_name, role: row.role, login: row.login };
}

/** Последний «кто я» на этом телефоне: без связи приложение открывается с запомненными данными. */
const ME_KEY = 'auth:me';
type SavedMe = Me & { userId: string };

async function savedMe(userId: string): Promise<Me | null> {
  try {
    const raw = await AsyncStorage.getItem(ME_KEY);
    const m = raw ? (JSON.parse(raw) as SavedMe) : null;
    return m && m.userId === userId ? { id: m.id, displayName: m.displayName, role: m.role, login: m.login } : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isConfigured);

  const refreshMe = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      setMe(null);
      setAccessError(null);
      setLoading(false);
      return;
    }
    setLoadError(null);
    try {
      const m = await loadMe();
      setQueryCacheUser(m?.id ?? null);
      setMe(m);
      setAccessError(m ? null : 'Учётная запись отключена или не привязана к сотруднику. Обратитесь к руководителю.');
      if (m) AsyncStorage.setItem(ME_KEY, JSON.stringify({ ...m, userId: s.user.id })).catch(() => {});
      else AsyncStorage.removeItem(ME_KEY).catch(() => {});
    } catch (e) {
      // Нет связи или идёт обновление: открываем приложение с запомненными данными —
      // экраны покажут их с плашкой «Повторить». Если запомненного нет — экран «Нет связи».
      const kind = errorKind(e);
      const cached = kind === 'network' || kind === 'timeout' || kind === 'updating' ? await savedMe(s.user.id) : null;
      if (cached) {
        humanError(e); // в журнал
        setQueryCacheUser(cached.id);
        setMe(cached);
        setAccessError(null);
      } else setLoadError(humanError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => refreshMe(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Запросы к Supabase внутри этого обработчика блокируют клиент — откладываем.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') setTimeout(() => refreshMe(s), 0);
      else setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshMe]);

  const signIn = useCallback(async (login: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: loginToEmail(login), password });
    if (error) throw error;
  }, []);

  const retry = useCallback(() => {
    setLoading(true);
    supabase.auth.getSession().then(({ data }) => refreshMe(data.session));
  }, [refreshMe]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    AsyncStorage.removeItem(ME_KEY).catch(() => {});
    setQueryCacheUser(null);
    await clearQueryCache();
  }, []);

  const value = useMemo(
    () => ({ loading, session, me, accessError, loadError, retry, signIn, signOut }),
    [loading, session, me, accessError, loadError, retry, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth вне AuthProvider');
  return ctx;
}
