import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { ApiError, type TtsSettingsPayload } from "@read/api-client";
import { useAuth } from "../lib/auth";
import {
  FONT_SIZE_STEP,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  useReaderPreferences,
} from "../lib/reader-preferences";
import { colors, readerThemes } from "../lib/theme";

const PREVIEW_TEXT =
  "Tàu chở dầu đi qua eo biển Hormuz mỗi ngày. Từ Washington đến eo biển Malacca, các tuyến đường này quyết định giá dầu toàn cầu.";

export default function SettingsScreen() {
  const router = useRouter();
  const { user, loading: authLoading, signOut, enableAuthor } = useAuth();
  const [authorBusy, setAuthorBusy] = useState(false);
  const [authorError, setAuthorError] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace("/login");
  }, [authLoading, user, router]);

  async function becomeAuthor() {
    setAuthorBusy(true);
    setAuthorError("");
    try {
      await enableAuthor();
      router.push("/publisher");
    } catch (err) {
      if (err instanceof ApiError && err.message === "terms_required") {
        router.push("/legal/accept?action=author");
        return;
      }
      setAuthorError(err instanceof Error ? err.message : "Could not enable author mode.");
    } finally {
      setAuthorBusy(false);
    }
  }

  if (authLoading || !user) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.sage} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: "Settings" }} />

      <AccountSection
        name={user.name}
        handle={user.handle}
        email={user.email}
        role={user.role}
        onOpenProfile={() => {
          if (user.handle) router.push(`/@${user.handle}`);
          else router.push("/claim-handle");
        }}
        onSignOut={() => void signOut().then(() => router.replace("/"))}
      />

      <WorkspaceSection
        role={user.role}
        authorBusy={authorBusy}
        authorError={authorError}
        onAdmin={() => router.push("/admin")}
        onPublisher={() => router.push("/publisher")}
        onBecomeAuthor={becomeAuthor}
      />

      <LegalSection
        acceptedVersion={user.accepted_legal_version}
        currentVersion={user.current_legal_version}
        needsAcceptance={Boolean(user.needs_legal_acceptance)}
        onOpen={(docId) => router.push(`/legal/${docId}`)}
        onAccept={() => router.push("/legal/accept")}
      />

      <ReadingSection />

      {user.role === "admin" ? <NarrationSection /> : null}
    </ScrollView>
  );
}

function AccountSection({
  name,
  handle,
  email,
  role,
  onOpenProfile,
  onSignOut,
}: {
  name: string;
  handle?: string | null;
  email: string;
  role: string;
  onOpenProfile: () => void;
  onSignOut: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Account</Text>
      <View style={styles.kvRow}>
        <Text style={styles.kvKey}>Name</Text>
        <Text style={styles.kvValue}>{name}</Text>
      </View>
      <View style={styles.kvRow}>
        <Text style={styles.kvKey}>Handle</Text>
        <Pressable onPress={onOpenProfile}>
          <Text style={[styles.kvValue, styles.linkValue]}>
            {handle ? `@${handle}` : "Choose a handle"}
          </Text>
        </Pressable>
      </View>
      <View style={styles.kvRow}>
        <Text style={styles.kvKey}>Email</Text>
        <Text style={styles.kvValue}>{email}</Text>
      </View>
      <View style={styles.kvRow}>
        <Text style={styles.kvKey}>Role</Text>
        <Text style={styles.kvValue}>{role}</Text>
      </View>

      <Pressable style={styles.secondaryBtn} onPress={onSignOut}>
        <Text style={styles.secondaryBtnText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function WorkspaceSection({
  role,
  authorBusy,
  authorError,
  onAdmin,
  onPublisher,
  onBecomeAuthor,
}: {
  role: string;
  authorBusy: boolean;
  authorError: string;
  onAdmin: () => void;
  onPublisher: () => void;
  onBecomeAuthor: () => void;
}) {
  return (
    <View style={styles.workspaceCard}>
      <Text style={styles.workspaceEyebrow}>Workspace</Text>
      <Text style={styles.cardTitle}>Manage & publish</Text>
      <Text style={styles.cardSub}>
        Jump into the tools for your role. Admin and Publisher stay separate from account settings.
      </Text>

      <View style={styles.workspaceList}>
        {role === "admin" ? (
          <Pressable style={styles.workspaceRow} onPress={onAdmin}>
            <View style={styles.workspaceCopy}>
              <Text style={styles.workspaceTitle}>Admin center</Text>
              <Text style={styles.workspaceHint}>Review queue, library, reports</Text>
            </View>
            <Text style={styles.workspaceChevron}>›</Text>
          </Pressable>
        ) : null}

        {role === "publisher" || role === "admin" ? (
          <Pressable style={styles.workspaceRow} onPress={onPublisher}>
            <View style={styles.workspaceCopy}>
              <Text style={styles.workspaceTitle}>Publisher workspace</Text>
              <Text style={styles.workspaceHint}>Upload, edit drafts, submit for review</Text>
            </View>
            <Text style={styles.workspaceChevron}>›</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.workspaceRow, authorBusy && styles.btnDisabled]}
            onPress={onBecomeAuthor}
            disabled={authorBusy}
          >
            <View style={styles.workspaceCopy}>
              <Text style={styles.workspaceTitle}>
                {authorBusy ? "Enabling…" : "Become an author"}
              </Text>
              <Text style={styles.workspaceHint}>Turn on publishing for your account</Text>
            </View>
            <Text style={styles.workspaceChevron}>›</Text>
          </Pressable>
        )}
      </View>
      {authorError ? <Text style={styles.errorInline}>{authorError}</Text> : null}
    </View>
  );
}

function LegalSection({
  acceptedVersion,
  currentVersion,
  needsAcceptance,
  onOpen,
  onAccept,
}: {
  acceptedVersion?: string | null;
  currentVersion?: string;
  needsAcceptance: boolean;
  onOpen: (docId: string) => void;
  onAccept: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Legal</Text>
      <Text style={styles.cardSub}>
        {needsAcceptance
          ? "The agreement has changed. Review and accept the current version."
          : `Accepted ${acceptedVersion || currentVersion || ""}`}
      </Text>
      <View style={styles.accountActions}>
        <Pressable style={styles.secondaryBtn} onPress={() => onOpen("terms")}>
          <Text style={styles.secondaryBtnText}>Terms</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={() => onOpen("privacy")}>
          <Text style={styles.secondaryBtnText}>Privacy</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={() => onOpen("publisher")}>
          <Text style={styles.secondaryBtnText}>Publisher agreement</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={() => onOpen("community")}>
          <Text style={styles.secondaryBtnText}>Guidelines</Text>
        </Pressable>
      </View>
      {needsAcceptance ? (
        <Pressable style={styles.primaryBtn} onPress={onAccept}>
          <Text style={styles.primaryBtnText}>Review and accept</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ReadingSection() {
  const { fontSize, theme, changeFontSize, cycleTheme } = useReaderPreferences();

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Reading</Text>
      <Text style={styles.cardSub}>Applies to the in-app reader.</Text>

      <View style={styles.inlineRow}>
        <Text style={styles.kvKey}>Text size</Text>
        <View style={styles.inlineActions}>
          <Pressable
            style={styles.stepBtn}
            disabled={fontSize <= MIN_FONT_SIZE}
            onPress={() => changeFontSize(-FONT_SIZE_STEP)}
          >
            <Text style={styles.stepBtnText}>A−</Text>
          </Pressable>
          <Text style={styles.kvValue}>{fontSize}</Text>
          <Pressable
            style={styles.stepBtn}
            disabled={fontSize >= MAX_FONT_SIZE}
            onPress={() => changeFontSize(FONT_SIZE_STEP)}
          >
            <Text style={styles.stepBtnText}>A+</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.inlineRow}>
        <Text style={styles.kvKey}>Theme</Text>
        <Pressable style={styles.chip} onPress={cycleTheme}>
          <Text style={styles.chipText}>{readerThemes[theme].label}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function NarrationSection() {
  const { api } = useAuth();
  const [payload, setPayload] = useState<TtsSettingsPayload | null>(null);
  const [engine, setEngine] = useState("neural2");
  const [gender, setGender] = useState("male");
  const [persona, setPersona] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const player = useAudioPlayer(null);
  const playerReleased = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: "doNotMix",
    });
  }, []);

  useEffect(() => {
    playerReleased.current = false;
    return () => {
      playerReleased.current = true;
    };
  }, [player]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.adminGetTtsSettings();
      setPayload(data);
      setEngine(data.active.engine);
      setGender(data.active.gender);
      setPersona(data.active.chirp_persona || "");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not load narration settings."
      );
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const personas = useMemo(
    () => payload?.chirp3_personas[gender as "male" | "female"] ?? [],
    [payload, gender]
  );

  useEffect(() => {
    if (engine !== "chirp3") return;
    if (persona && personas.includes(persona)) return;
    setPersona(personas[0] ?? "");
  }, [engine, personas, persona]);

  function playPreview() {
    if (playerReleased.current) return;
    const uri = api.ttsPreviewUrl({
      engine,
      gender,
      chirp_persona: engine === "chirp3" ? persona : undefined,
      text: PREVIEW_TEXT,
    });
    try {
      player.replace({ uri });
      player.play();
    } catch {
      setError("Could not play the preview.");
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const result = await api.adminUpdateTtsSettings({
        engine,
        gender,
        chirp_persona: engine === "chirp3" ? persona : "",
      });
      setPayload((prev) => (prev ? { ...prev, active: result.active } : prev));
      setStatus(`Saved · ${result.active.voice}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not save narration settings."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Narration</Text>
        <ActivityIndicator color={colors.sage} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Narration</Text>
      <Text style={styles.cardSub}>
        Admin only. Applies immediately to new cloud narration.
      </Text>

      <Text style={styles.label}>Engine</Text>
      <View style={styles.chipWrap}>
        {(payload?.engines ?? []).map((item) => (
          <Pressable
            key={item.id}
            style={[styles.chip, engine === item.id && styles.chipActive]}
            onPress={() => setEngine(item.id)}
          >
            <Text style={[styles.chipText, engine === item.id && styles.chipTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Gender</Text>
      <View style={styles.chipWrap}>
        {(["male", "female"] as const).map((value) => (
          <Pressable
            key={value}
            style={[styles.chip, gender === value && styles.chipActive]}
            onPress={() => setGender(value)}
          >
            <Text style={[styles.chipText, gender === value && styles.chipTextActive]}>
              {value}
            </Text>
          </Pressable>
        ))}
      </View>

      {engine === "chirp3" ? (
        <>
          <Text style={styles.label}>Chirp3 persona</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {personas.map((item) => (
                <Pressable
                  key={item}
                  style={[styles.chip, persona === item && styles.chipActive]}
                  onPress={() => setPersona(item)}
                >
                  <Text
                    style={[styles.chipText, persona === item && styles.chipTextActive]}
                  >
                    {item}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </>
      ) : null}

      <Pressable style={styles.secondaryBtn} onPress={playPreview}>
        <Text style={styles.secondaryBtnText}>Play preview</Text>
      </Pressable>

      {payload?.active ? (
        <Text style={styles.meta}>
          Active: {payload.active.voice}
          {payload.active.source ? ` · ${payload.active.source}` : ""}
        </Text>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.ok}>{status}</Text> : null}

      <Pressable
        style={[styles.primaryBtn, saving && styles.btnDisabled]}
        disabled={saving}
        onPress={() => void save()}
      >
        <Text style={styles.primaryBtnText}>
          {saving ? "Saving…" : "Save narration voice"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14, paddingBottom: 48 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mist,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 10,
  },
  workspaceCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.sage,
    padding: 16,
    gap: 10,
  },
  workspaceEyebrow: {
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: colors.sage,
    fontWeight: "700",
  },
  workspaceList: { gap: 8, marginTop: 4 },
  workspaceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "rgba(63,111,92,0.08)",
  },
  workspaceCopy: { flex: 1, gap: 2 },
  workspaceTitle: { color: colors.ink, fontWeight: "700", fontSize: 16 },
  workspaceHint: { color: colors.inkSoft, fontSize: 12, lineHeight: 17 },
  workspaceChevron: { color: colors.sageDeep, fontSize: 24, fontWeight: "300", marginTop: -2 },
  cardTitle: { fontSize: 18, fontWeight: "600", color: colors.ink },
  cardSub: { fontSize: 13, color: colors.inkSoft, marginTop: -4 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  kvKey: { color: colors.inkSoft },
  kvValue: { color: colors.ink, fontWeight: "500" },
  linkValue: { color: colors.sage, textDecorationLine: "underline" },
  inlineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  inlineActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { color: colors.inkSoft, fontSize: 13, marginTop: 4 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipRow: { flexDirection: "row", gap: 8, paddingVertical: 2 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  chipActive: { backgroundColor: colors.sage, borderColor: colors.sage },
  chipText: { color: colors.ink, textTransform: "capitalize" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  stepBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  stepBtnText: { color: colors.ink, fontWeight: "600" },
  primaryBtn: {
    backgroundColor: colors.sage,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
  },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
  btnDisabled: { opacity: 0.6 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  secondaryBtnText: { color: colors.ink, fontWeight: "500" },
  accountActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  meta: { color: colors.inkSoft, fontSize: 13 },
  error: { color: colors.danger },
  errorInline: { color: colors.danger, fontSize: 13 },
  ok: { color: colors.sageDeep },
});
