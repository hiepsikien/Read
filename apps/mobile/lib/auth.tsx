import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ApiClient, SessionUser } from "@read/api-client";
import { createMobileApi, getToken, setToken } from "./api";

type AuthContextValue = {
  user: SessionUser | null;
  token: string | null;
  loading: boolean;
  api: ApiClient;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<SessionUser>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const api = useMemo(() => createMobileApi(() => token), [token]);

  const refresh = useCallback(async () => {
    const stored = await getToken();
    setTokenState(stored);
    if (!stored) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const client = createMobileApi(() => stored);
      const me = await client.me();
      setUser(me.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const client = createMobileApi(() => null);
    const data = await client.login(email, password);
    await setToken(data.token);
    setTokenState(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(async () => {
    await setToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, api, refresh, signIn, signOut }),
    [user, token, loading, api, refresh, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
