import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ApiError } from "@read/api-client";
import { useAuth } from "../../lib/auth";
import { CURRENT_LEGAL_VERSION } from "../../lib/legal";
import { colors, radii, space } from "../../lib/theme";

export default function AcceptLegalScreen() {
  const { action, bookId } = useLocalSearchParams<{ action?: string; bookId?: string }>();
  const router = useRouter();
  const { acceptLegal, enableAuthor, api } = useAuth();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    if (!checked) {
      setError("Confirm that you have read and agree before continuing.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await acceptLegal(CURRENT_LEGAL_VERSION);
      if (action === "author") {
        await enableAuthor();
        router.replace("/publisher");
      } else if (action === "submit" && bookId) {
        await api.submitReview(bookId);
        router.replace(`/publisher/${bookId}`);
      } else if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/settings");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save agreement.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: "User agreement" }} />
      <Text style={styles.eyebrow}>Version {CURRENT_LEGAL_VERSION}</Text>
      <Text style={styles.title}>Before you continue</Text>
      <Text style={styles.body}>
        Read the documents below. Publishers must own the rights to their manuscripts and follow the Community Guidelines.
      </Text>
      <View style={styles.links}>
        <LegalLink label="Terms of Use" onPress={() => router.push("/legal/terms")} />
        <LegalLink label="Privacy Policy" onPress={() => router.push("/legal/privacy")} />
        <LegalLink label="Publisher Agreement" onPress={() => router.push("/legal/publisher")} />
        <LegalLink label="Community Guidelines" onPress={() => router.push("/legal/community")} />
      </View>
      <Pressable style={styles.checkRow} onPress={() => setChecked((value) => !value)} accessibilityRole="checkbox" accessibilityState={{ checked }}>
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          <Text style={styles.checkmark}>{checked ? "✓" : ""}</Text>
        </View>
        <Text style={styles.checkText}>
          I have read and agree to the Terms and Privacy Policy, and I confirm I am old enough to enter this agreement.
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={[styles.button, (!checked || busy) && styles.disabled]} disabled={!checked || busy} onPress={() => void accept()}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Agree and continue</Text>}
      </Pressable>
    </ScrollView>
  );
}

function LegalLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.link} onPress={onPress}>
      <Text style={styles.linkText}>{label}</Text>
      <Text style={styles.linkArrow}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.xl, gap: space.lg, paddingBottom: 56 },
  eyebrow: { color: colors.sage, textTransform: "uppercase", letterSpacing: 1.2, fontSize: 12, fontWeight: "700" },
  title: { color: colors.ink, fontSize: 30, fontWeight: "700" },
  body: { color: colors.inkSoft, lineHeight: 22 },
  links: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.card, overflow: "hidden" },
  link: { flexDirection: "row", justifyContent: "space-between", padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  linkText: { color: colors.ink, fontWeight: "600" },
  linkArrow: { color: colors.sage, fontSize: 20 },
  checkRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  checkbox: { width: 24, height: 24, borderWidth: 1, borderColor: colors.sage, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: colors.sage },
  checkmark: { color: colors.white, fontWeight: "700" },
  checkText: { flex: 1, color: colors.ink, lineHeight: 20 },
  button: { backgroundColor: colors.sage, borderRadius: radii.sm, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: colors.white, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger },
});
