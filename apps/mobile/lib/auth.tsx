import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged } from "firebase/auth";
import type { ApiClient, SessionUser } from "@read/api-client";
import { createMobileApi, getToken, setToken } from "./api";
import {
  firebaseConfigured,
  firebaseSignIn,
  firebaseSignOutUser,
  firebaseSignUp,
  getFirebaseAuth,
  getFirebaseIdToken,
} from "./firebase";

type AuthContextValue = {
  user: SessionUser | null;
  token: string | null;
  loading: boolean;
  api: ApiClient;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<SessionUser>;
  signUp: (email: string, password: string, name: string) => Promise<SessionUser>;
  signOut: () => Promise<void>;
  enableAuthor: () => Promise<SessionUser>;
  acceptLegal: (version: string) => Promise<SessionUser>;
  claimHandle: (handle: string) => Promise<SessionUser>;
  usingFirebase: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const usingFirebase = firebaseConfigured();

  const api = useMemo(
    () =>
      createMobileApi(async () => {
        if (usingFirebase) {
          return (await getFirebaseIdToken()) || (await getToken());
        }
        return getToken();
      }),
    [usingFirebase]
  );

  const syncProfile = useCallback(
    async (nextToken: string | null) => {
      setTokenState(nextToken);
      if (!nextToken) {
        setUser(null);
        return null;
      }
      const client = createMobileApi(async () => nextToken);
      const me = await client.me();
      setUser(me.user);
      return me.user;
    },
    []
  );

  const refresh = useCallback(async () => {
    try {
      if (usingFirebase) {
        const idToken = await getFirebaseIdToken();
        if (idToken) {
          await setToken(idToken);
          await syncProfile(idToken);
          return;
        }
      }
      const stored = await getToken();
      if (!stored) {
        setUser(null);
        setTokenState(null);
        return;
      }
      await syncProfile(stored);
    } catch {
      setUser(null);
      setTokenState(null);
    } finally {
      setLoading(false);
    }
  }, [syncProfile, usingFirebase]);

  useEffect(() => {
    let cancelled = false;
    let settled = false;
    const finishLoading = () => {
      if (!cancelled && !settled) {
        settled = true;
        setLoading(false);
      }
    };
    // Never leave the UI stuck on a blank spinner if Firebase hangs.
    const timeout = setTimeout(finishLoading, 5000);

    const runRefresh = () => {
      void refresh().finally(() => {
        clearTimeout(timeout);
        settled = true;
      });
    };

    try {
      if (!usingFirebase) {
        runRefresh();
        return () => {
          cancelled = true;
          clearTimeout(timeout);
        };
      }

      const auth = getFirebaseAuth();
      if (!auth) {
        runRefresh();
        return () => {
          cancelled = true;
          clearTimeout(timeout);
        };
      }

      const unsubscribe = onAuthStateChanged(auth, () => {
        runRefresh();
      });
      return () => {
        cancelled = true;
        clearTimeout(timeout);
        unsubscribe();
      };
    } catch {
      clearTimeout(timeout);
      finishLoading();
      return () => {
        cancelled = true;
      };
    }
  }, [refresh, usingFirebase]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (usingFirebase) {
        const firebaseUser = await firebaseSignIn(email, password);
        const idToken = await firebaseUser.getIdToken();
        await setToken(idToken);
        const profile = await syncProfile(idToken);
        if (!profile) throw new Error("Could not load profile.");
        return profile;
      }

      const client = createMobileApi(() => null);
      const data = await client.login(email, password);
      await setToken(data.token);
      setTokenState(data.token);
      setUser(data.user);
      return data.user;
    },
    [syncProfile, usingFirebase]
  );

  const signUp = useCallback(
    async (email: string, password: string, name: string) => {
      if (usingFirebase) {
        const firebaseUser = await firebaseSignUp(email, password, name);
        const idToken = await firebaseUser.getIdToken();
        await setToken(idToken);
        const profile = await syncProfile(idToken);
        if (!profile) throw new Error("Could not load profile.");
        return profile;
      }

      const client = createMobileApi(() => null);
      const data = await client.login(email, password, name);
      await setToken(data.token);
      setTokenState(data.token);
      setUser(data.user);
      return data.user;
    },
    [syncProfile, usingFirebase]
  );

  const signOut = useCallback(async () => {
    if (usingFirebase) {
      await firebaseSignOutUser();
    }
    await setToken(null);
    setTokenState(null);
    setUser(null);
  }, [usingFirebase]);

  const enableAuthor = useCallback(async () => {
    const data = await api.enableAuthor(true);
    setUser(data.user);
    return data.user;
  }, [api]);

  const acceptLegal = useCallback(
    async (version: string) => {
      const data = await api.acceptLegal(version);
      setUser(data.user);
      return data.user;
    },
    [api]
  );

  const claimHandle = useCallback(
    async (handle: string) => {
      const data = await api.claimHandle(handle);
      setUser(data.user);
      return data.user;
    },
    [api]
  );

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      api,
      refresh,
      signIn,
      signUp,
      signOut,
      enableAuthor,
      acceptLegal,
      claimHandle,
      usingFirebase,
    }),
    [
      user,
      token,
      loading,
      api,
      refresh,
      signIn,
      signUp,
      signOut,
      enableAuthor,
      acceptLegal,
      claimHandle,
      usingFirebase,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
