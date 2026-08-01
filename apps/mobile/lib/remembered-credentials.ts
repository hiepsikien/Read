import * as SecureStore from "expo-secure-store";

const EMAIL_KEY = "read_remember_email";
const PASSWORD_KEY = "read_remember_password";

export type RememberedCredentials = {
  email: string;
  password: string;
};

export async function loadRememberedCredentials(): Promise<RememberedCredentials | null> {
  try {
    const [email, password] = await Promise.all([
      SecureStore.getItemAsync(EMAIL_KEY),
      SecureStore.getItemAsync(PASSWORD_KEY),
    ]);
    if (!email || !password) return null;
    return { email, password };
  } catch {
    return null;
  }
}

export async function saveRememberedCredentials(email: string, password: string) {
  await SecureStore.setItemAsync(EMAIL_KEY, email);
  await SecureStore.setItemAsync(PASSWORD_KEY, password);
}

export async function clearRememberedCredentials() {
  await SecureStore.deleteItemAsync(EMAIL_KEY);
  await SecureStore.deleteItemAsync(PASSWORD_KEY);
}
