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
import { ApiError, normalizeHandle, validateHandleInput } from "@read/api-client";
import { BrandLogo } from "../components/BrandLogo";
import { FormScroll } from "../components/FormScroll";
import { useAuth } from "../lib/auth";
import { CURRENT_LEGAL_VERSION } from "../lib/legal";
import { colors, radii, space } from "../lib/theme";

const DEMOS = [
  { role: "Reader", email: "reader@read.app", password: "reader123" },
  { role: "Publisher", email: "publisher@read.app", password: "publisher123" },
  { role: "Admin", email: "admin@read.app", password: "admin123" },
];

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signUp, acceptLegal, claimHandle, usingFirebase } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("reader@read.app");
  const [password, setPassword] = useState("reader123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedLegal, setAcceptedLegal] = useState(false);

  async function onSubmit() {
    if (mode === "signup" && !acceptedLegal) {
      setError("Accept the Terms and Privacy Policy to create an account.");
      return;
    }
    if (mode === "signup") {
      const validationError = validateHandleInput(handle);
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    setLoading(true);
    setError("");
    try {
      let profile;
      if (mode === "signup") {
        profile = await signUp(
          email.trim(),
          password,
          name.trim() || email.split("@")[0]
        );
        profile = await acceptLegal(profile.current_legal_version || CURRENT_LEGAL_VERSION);
        if (!profile.handle) {
          profile = await claimHandle(normalizeHandle(handle));
        }
      } else {
        profile = await signIn(email.trim(), password);
      }
      if (!profile.handle) {
        router.replace("/claim-handle");
        return;
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
      <View style={styles.orb} />
      <View style={styles.orbSecondary} />

      <View style={styles.hero}>
        <BrandLogo variant="mark" height={52} />
        <Text style={styles.title}>{mode === "signin" ? "Welcome back" : "Join Read"}</Text>
        <Text style={styles.sub}>
          Free books stay open without an account. Sign in to unlock paid titles, publish, or
          moderate.
          {usingFirebase
            ? " Auth is powered by Firebase."
            : " Local auth is active until Firebase is configured."}
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.modeRow}>
          <Pressable
            style={[styles.modeChip, mode === "signin" && styles.modeChipActive]}
            onPress={() => setMode("signin")}
          >
            <Text style={[styles.modeText, mode === "signin" && styles.modeTextActive]}>
              Sign in
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeChip, mode === "signup" && styles.modeChipActive]}
            onPress={() => setMode("signup")}
          >
            <Text style={[styles.modeText, mode === "signup" && styles.modeTextActive]}>
              Create account
            </Text>
          </Pressable>
        </View>

        {mode === "signup" ? (
          <>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Display name"
              placeholderTextColor={colors.inkSoft}
            />
            <View style={styles.handleRow}>
              <Text style={styles.at}>@</Text>
              <TextInput
                style={styles.handleInput}
                autoCapitalize="none"
                autoCorrect={false}
                value={handle}
                onChangeText={(value) => setHandle(normalizeHandle(value))}
                placeholder="handle"
                placeholderTextColor={colors.inkSoft}
              />
            </View>
            <Text style={styles.handleHint}>
              Public page at /@{handle || "yourname"}. Cannot be changed later.
            </Text>
          </>
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
        {mode === "signup" ? (
          <View style={styles.legalBlock}>
            <Pressable
              style={styles.checkRow}
              onPress={() => setAcceptedLegal((value) => !value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acceptedLegal }}
            >
              <View style={[styles.checkbox, acceptedLegal && styles.checkboxChecked]}>
                <Text style={styles.checkmark}>{acceptedLegal ? "✓" : ""}</Text>
              </View>
              <Text style={styles.legalText}>
                I agree to the Terms and Privacy Policy and confirm I am old enough to enter this
                agreement.
              </Text>
            </Pressable>
            <View style={styles.legalLinks}>
              <Pressable onPress={() => router.push("/legal/terms")}>
                <Text style={styles.legalLink}>Terms</Text>
              </Pressable>
              <Pressable onPress={() => router.push("/legal/privacy")}>
                <Text style={styles.legalLink}>Privacy</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          style={[styles.button, mode === "signup" && !acceptedLegal && styles.disabled]}
          onPress={onSubmit}
          disabled={loading || (mode === "signup" && !acceptedLegal)}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {mode === "signin" ? "Sign in" : "Create account"}
            </Text>
          )}
        </Pressable>
      </View>

      {!usingFirebase ? (
        <View style={styles.demoBlock}>
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
        </View>
      ) : null}
    </FormScroll>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.mist },
  container: { padding: space.xl, gap: space.lg, paddingBottom: 56 },
  orb: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(63,111,92,0.16)",
  },
  orbSecondary: {
    position: "absolute",
    top: 120,
    left: -60,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(20,34,28,0.05)",
  },
  hero: { gap: space.sm, paddingTop: space.md },
  title: { fontSize: 30, fontWeight: "700", color: colors.ink, marginTop: 4 },
  sub: { color: colors.inkSoft, lineHeight: 21, maxWidth: 360 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.md,
  },
  modeRow: { flexDirection: "row", gap: 8 },
  modeChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
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
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: colors.ink,
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
  handleInput: {
    flex: 1,
    paddingVertical: 12,
    color: colors.ink,
  },
  handleHint: { color: colors.inkSoft, fontSize: 12, marginTop: -4 },
  button: {
    backgroundColor: colors.sage,
    borderRadius: radii.sm,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  legalBlock: { gap: 8 },
  checkRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: colors.sage,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: colors.sage },
  checkmark: { color: "#fff", fontWeight: "700", fontSize: 12 },
  legalText: { flex: 1, color: colors.inkSoft, lineHeight: 20 },
  legalLinks: { flexDirection: "row", gap: 16, paddingLeft: 32 },
  legalLink: { color: colors.sage, fontWeight: "600", textDecorationLine: "underline" },
  error: { color: colors.danger },
  disabled: { opacity: 0.5 },
  demoBlock: { gap: 8 },
  demoHeading: { color: colors.inkSoft, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  demo: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.45)",
  },
  demoRole: { color: colors.ink, fontWeight: "700" },
  demoMeta: { color: colors.inkSoft, marginTop: 2, fontSize: 12 },
});
