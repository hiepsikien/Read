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
import { useAuth } from "../lib/auth";
import { colors } from "../lib/theme";

const DEMOS = [
  { role: "Reader", email: "reader@read.app", password: "reader123" },
  { role: "Publisher", email: "publisher@read.app", password: "publisher123" },
];

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("reader@read.app");
  const [password, setPassword] = useState("reader123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setLoading(true);
    setError("");
    try {
      await signIn(email.trim(), password);
      if (router.canGoBack()) router.back();
      else router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign in to Read</Text>
      <Text style={styles.sub}>Reading happens inside the app.</Text>

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
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
      </Pressable>

      <Text style={styles.demoHeading}>Demo accounts</Text>
      {DEMOS.map((demo) => (
        <Pressable
          key={demo.email}
          style={styles.demo}
          onPress={() => {
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12, backgroundColor: colors.mist },
  title: { fontSize: 28, fontWeight: "700", color: colors.ink, marginTop: 8 },
  sub: { color: colors.inkSoft, marginBottom: 8 },
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
