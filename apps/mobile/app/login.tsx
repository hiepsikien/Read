import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { ApiError } from "@read/api-client";
import { BrandLogo } from "../components/BrandLogo";
import { FormScroll } from "../components/FormScroll";
import { useAuth } from "../lib/auth";
import { colors } from "../lib/theme";

const DEMOS = [
  { role: "Reader", email: "reader@read.app", password: "reader123" },
  { role: "Publisher", email: "publisher@read.app", password: "publisher123" },
  { role: "Admin", email: "admin@read.app", password: "admin123" },
];

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signUp, usingFirebase } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("reader@read.app");
  const [password, setPassword] = useState("reader123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setLoading(true);
    setError("");
    try {
      if (mode === "signup") {
        await signUp(email.trim(), password, name.trim() || email.split("@")[0]);
      } else {
        await signIn(email.trim(), password);
      }
      if (router.canGoBack()) router.back();
      else router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <FormScroll style={styles.screen} contentContainerStyle={styles.container}>
      <BrandLogo variant="mark" height={48} style={styles.mark} />
      <Text style={styles.title}>{mode === "signin" ? "Sign in to Read" : "Create account"}</Text>
      <Text style={styles.sub}>
        Free books stay open without an account. Sign in to unlock paid titles, publish, or moderate.
        {usingFirebase ? " Auth is powered by Firebase." : " Local auth is active until Firebase is configured."}
      </Text>

      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeChip, mode === "signin" && styles.modeChipActive]}
          onPress={() => setMode("signin")}
        >
          <Text style={[styles.modeText, mode === "signin" && styles.modeTextActive]}>Sign in</Text>
        </Pressable>
        <Pressable
          style={[styles.modeChip, mode === "signup" && styles.modeChipActive]}
          onPress={() => setMode("signup")}
        >
          <Text style={[styles.modeText, mode === "signup" && styles.modeTextActive]}>Create account</Text>
        </Pressable>
      </View>

      {mode === "signup" ? (
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Display name"
          placeholderTextColor={colors.inkSoft}
        />
      ) : null}

      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor={colors.inkSoft}
      />
      <TextInput
        style={styles.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor={colors.inkSoft}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={onSubmit} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{mode === "signin" ? "Sign in" : "Create account"}</Text>
        )}
      </Pressable>

      {!usingFirebase ? (
        <>
          <Text style={styles.demoHeading}>Demo accounts</Text>
          {DEMOS.map((demo) => (
            <Pressable
              key={demo.email}
              style={styles.demo}
              onPress={() => {
                setMode("signin");
                setEmail(demo.email);
                setPassword(demo.password);
              }}
            >
              <Text style={styles.demoRole}>{demo.role}</Text>
              <Text style={styles.demoMeta}>
                {demo.email} / {demo.password}
              </Text>
            </Pressable>
          ))}
        </>
      ) : null}
    </FormScroll>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.mist },
  container: { padding: 20, gap: 12, paddingBottom: 48 },
  mark: { marginBottom: 4 },
  title: { fontSize: 28, fontWeight: "700", color: colors.ink, marginTop: 8 },
  sub: { color: colors.inkSoft, marginBottom: 8, lineHeight: 20 },
  modeRow: { flexDirection: "row", gap: 8 },
  modeChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  modeChipActive: { backgroundColor: colors.sage, borderColor: colors.sage },
  modeText: { color: colors.ink, fontWeight: "600" },
  modeTextActive: { color: "#fff" },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,0.85)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: colors.ink,
  },
  button: {
    backgroundColor: colors.sage,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "600" },
  demoHeading: {
    marginTop: 16,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.inkSoft,
    fontWeight: "600",
  },
  demo: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.5)",
  },
  demoRole: { fontWeight: "600", color: colors.ink },
  demoMeta: { color: colors.inkSoft, marginTop: 2, fontSize: 13 },
  error: { color: colors.danger },
});
