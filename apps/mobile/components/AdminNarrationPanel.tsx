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
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { ApiError, type TtsSettingsPayload } from "@read/api-client";
import { useAuth } from "../lib/auth";
import { colors } from "../lib/theme";

const PREVIEW_TEXT =
  "Tàu chở dầu đi qua eo biển Hormuz mỗi ngày. Từ Washington đến eo biển Malacca, các tuyến đường này quyết định giá dầu toàn cầu.";

/** Admin TTS / narration controls — used by Admin center. */
export function AdminNarrationPanel() {
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
        <ActivityIndicator color={colors.sage} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardSub}>
        Applies immediately to new cloud narration for all readers.
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
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 10,
  },
  cardSub: { fontSize: 13, color: colors.inkSoft },
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
  primaryBtn: {
    backgroundColor: colors.sage,
    paddingVertical: 12,
    paddingHorizontal: 18,
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
  meta: { color: colors.inkSoft, fontSize: 13 },
  error: { color: colors.danger },
  ok: { color: colors.sageDeep },
});
