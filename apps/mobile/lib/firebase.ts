import AsyncStorage from "@react-native-async-storage/async-storage";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  initializeAuth,
  // @ts-expect-error RN persistence is exported from the RN build, not the default TS types
  getReactNativePersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type Auth,
  type User as FirebaseUser,
} from "firebase/auth";

type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
};

function readConfig(): FirebaseWebConfig | null {
  const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.EXPO_PUBLIC_FIREBASE_APP_ID;
  const values = [apiKey, authDomain, projectId, appId];
  if (
    values.some(
      (value) => !value || value.startsWith("replace-with-")
    )
  ) {
    return null;
  }
  return {
    apiKey: apiKey!,
    authDomain: authDomain!,
    projectId: projectId!,
    appId: appId!,
  };
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

export function firebaseConfigured() {
  return readConfig() !== null;
}

export function getFirebaseAuth(): Auth | null {
  const config = readConfig();
  if (!config) return null;
  if (!auth) {
    app = getApps()[0] ?? initializeApp(config);
    try {
      auth = initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    } catch {
      // Already initialized (Fast Refresh / hot reload)
      auth = getAuth(app);
    }
  }
  return auth;
}

export async function firebaseSignIn(email: string, password: string) {
  const instance = getFirebaseAuth();
  if (!instance) throw new Error("Firebase is not configured.");
  const result = await signInWithEmailAndPassword(instance, email, password);
  return result.user;
}

export async function firebaseSignUp(email: string, password: string, name: string) {
  const instance = getFirebaseAuth();
  if (!instance) throw new Error("Firebase is not configured.");
  const result = await createUserWithEmailAndPassword(instance, email, password);
  if (name.trim()) {
    await updateProfile(result.user, { displayName: name.trim() });
  }
  return result.user;
}

export async function firebaseSignOutUser() {
  const instance = getFirebaseAuth();
  if (!instance) return;
  await firebaseSignOut(instance);
}

export async function getFirebaseIdToken(): Promise<string | null> {
  const instance = getFirebaseAuth();
  const user = instance?.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export type { FirebaseUser };
