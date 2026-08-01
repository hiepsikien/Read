import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { ApiError, type TtsSettingsPayload } from "@read/api-client";
import { useAuth } from "../lib/auth";
import { colors } from "../lib/theme";

const PREVIEW_TEXT =
  "Tàu chở dầu đi qua eo biển Hormuz mỗi ngày. Từ Washington đến eo biển Malacca, các tuyến đường này quyết định giá dầu toàn cầu.";

function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <View style={styles.numberRow}>
      <Text style={styles.numberLabel}>
        {label}
        {suffix ? ` (${suffix})` : ""}
      </Text>
      <TextInput
        style={styles.numberInput}
        keyboardType="numbers-and-punctuation"
        value={String(value)}
        onChangeText={(text) => {
          const parsed = Number(text);
          if (!Number.isNaN(parsed)) onChange(parsed);
        }}
      />
    </View>
  );
}

/** Admin TTS / narration controls — used by Admin center. */
export function AdminNarrationPanel() {
  const { api } = useAuth();
  const [payload, setPayload] = useState<TtsSettingsPayload | null>(null);
  const [engine, setEngine] = useState("neural2");
  const [gender, setGender] = useState("male");
  const [persona, setPersona] = useState("");
  const [narratorRate, setNarratorRate] = useState(98);
  const [narratorPitch, setNarratorPitch] = useState(-1);
  const [dialogueRate, setDialogueRate] = useState(100);
  const [dialoguePitch, setDialoguePitch] = useState(0);
  const [breakStart, setBreakStart] = useState(200);
  const [breakEnd, setBreakEnd] = useState(100);
  const [speakNames, setSpeakNames] = useState(false);
  const [speakDirections, setSpeakDirections] = useState(false);
  const [maxVoices, setMaxVoices] = useState(3);
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
      setNarratorRate(data.active.narrator_rate ?? data.defaults?.narrator_rate ?? 98);
      setNarratorPitch(data.active.narrator_pitch ?? data.defaults?.narrator_pitch ?? -1);
      setDialogueRate(data.active.dialogue_rate ?? data.defaults?.dialogue_rate ?? 100);
      setDialoguePitch(data.active.dialogue_pitch ?? data.defaults?.dialogue_pitch ?? 0);
      setBreakStart(data.active.break_start_ms ?? data.defaults?.break_start_ms ?? 200);
      setBreakEnd(data.active.break_end_ms ?? data.defaults?.break_end_ms ?? 100);
      setSpeakNames(Boolean(data.active.speak_speaker_names));
      setSpeakDirections(Boolean(data.active.speak_stage_directions));
      setMaxVoices(data.active.max_character_voices ?? data.defaults?.max_character_voices ?? 3);
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
        narrator_rate: narratorRate,
        narrator_pitch: narratorPitch,
        dialogue_rate: dialogueRate,
        dialogue_pitch: dialoguePitch,
        break_start_ms: breakStart,
        break_end_ms: breakEnd,
        speak_speaker_names: speakNames,
        speak_stage_directions: speakDirections,
        max_character_voices: maxVoices,
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
        Global defaults for all books. Book cast overrides live on each book’s admin page.
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

      <Text style={styles.label}>Narrator gender</Text>
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

      <Text style={styles.sectionTitle}>Narration pace</Text>
      <NumberField label="Narrator rate" value={narratorRate} onChange={setNarratorRate} suffix="%" />
      <NumberField label="Narrator pitch" value={narratorPitch} onChange={setNarratorPitch} suffix="st" />
      <NumberField label="Dialogue rate" value={dialogueRate} onChange={setDialogueRate} suffix="%" />
      <NumberField label="Dialogue pitch" value={dialoguePitch} onChange={setDialoguePitch} suffix="st" />

      <Text style={styles.sectionTitle}>Pauses</Text>
      <NumberField label="Break before dialogue" value={breakStart} onChange={setBreakStart} suffix="ms" />
      <NumberField label="Break after dialogue" value={breakEnd} onChange={setBreakEnd} suffix="ms" />
      <NumberField label="Max character voices" value={maxVoices} onChange={setMaxVoices} />

      <View style={styles.switchRow}>
        <Text style={styles.numberLabel}>Speak speaker names</Text>
        <Switch value={speakNames} onValueChange={setSpeakNames} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.numberLabel}>Speak stage directions</Text>
        <Switch value={speakDirections} onValueChange={setSpeakDirections} />
      </View>

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
          {saving ? "Saving…" : "Save narration settings"}
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
  sectionTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
    marginTop: 8,
  },
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
  numberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  numberLabel: { flex: 1, color: colors.ink, fontSize: 14 },
  numberInput: {
    width: 84,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: "right",
    backgroundColor: "rgba(255,255,255,0.7)",
    color: colors.ink,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
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
