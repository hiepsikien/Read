import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { ApiError, normalizeHandle, validateHandleInput } from "@read/api-client";
import { FormScroll } from "../components/FormScroll";
import { useAuth } from "../lib/auth";
import { colors, radii, space } from "../lib/theme";

export default function ClaimHandleScreen() {
  const router = useRouter();
  const { user, loading, claimHandle, signOut } = useAuth();
  const [handle, setHandle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.handle) {
      router.replace("/");
    }
  }, [loading, user, router]);

  async function onSubmit() {
    const validationError = validateHandleInput(handle);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await claimHandle(normalizeHandle(handle));
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not claim handle.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user || user.handle) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.sage} />
      </View>
    );
  }

  return (
    <FormScroll style={styles.screen} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: "Choose handle", headerBackVisible: false }} />
      <Text style={styles.eyebrow}>Almost done</Text>
      <Text style={styles.title}>Choose your @handle</Text>
      <Text style={styles.sub}>
        Your public page will live at /@handle. This cannot be changed later.
      </Text>
      <View style={styles.card}>
        <View style={styles.handleRow}>
          <Text style={styles.at}>@</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            value={handle}
            onChangeText={(value) => setHandle(normalizeHandle(value))}
            placeholder="yourname"
            placeholderTextColor={colors.inkSoft}
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.button} onPress={() => void onSubmit()} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Claim handle</Text>
          )}
        </Pressable>
      </View>
      <Pressable
        onPress={() => void signOut().then(() => router.replace("/login"))}
        style={styles.signOut}
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </FormScroll>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.mist },
  container: { padding: space.xl, gap: space.lg, paddingBottom: 56 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.mist },
  eyebrow: {
    color: colors.sage,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontSize: 12,
    fontWeight: "700",
  },
  title: { color: colors.ink, fontSize: 30, fontWeight: "700" },
  sub: { color: colors.inkSoft, lineHeight: 21 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.md,
  },
  handleRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: radii.sm,
    paddingHorizontal: 12,
  },
  at: { color: colors.inkSoft, fontSize: 16, marginRight: 2 },
  input: {
    flex: 1,
    paddingVertical: 12,
    color: colors.ink,
  },
  button: {
    backgroundColor: colors.sage,
    borderRadius: radii.sm,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  error: { color: colors.danger },
  signOut: { alignItems: "center", paddingVertical: 8 },
  signOutText: { color: colors.inkSoft, textDecorationLine: "underline" },
});
