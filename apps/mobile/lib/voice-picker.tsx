import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ApiError, type ApiClient, type TtsSettingsPayload } from "@read/api-client";

type Palette = { bg: string; fg: string; muted: string };

export function VoicePickerModal({
  visible,
  api,
  palette,
  onClose,
  onSaved,
}: {
  visible: boolean;
  api: ApiClient;
  palette: Palette;
  onClose: () => void;
  onSaved: (voice: string) => void;
}) {
  const [payload, setPayload] = useState<TtsSettingsPayload | null>(null);
  const [engine, setEngine] = useState("neural2");
  const [gender, setGender] = useState("male");
  const [persona, setPersona] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
      setError(err instanceof ApiError ? err.message : "Could not load voices.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const personas = useMemo(
    () => payload?.chirp3_personas[gender as "male" | "female"] ?? [],
    [payload, gender]
  );

  useEffect(() => {
    if (engine !== "chirp3") return;
    if (persona && personas.includes(persona)) return;
    setPersona(personas[0] ?? "");
  }, [engine, personas, persona]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const result = await api.adminUpdateTtsSettings({
        engine,
        gender,
        chirp_persona: engine === "chirp3" ? persona : "",
      });
      onSaved(result.active.voice);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the voice.");
    } finally {
      setSaving(false);
    }
  }

  function chipStyle(active: boolean) {
    return [
      styles.chip,
      { backgroundColor: withAlpha(palette.fg, active ? 0.9 : 0.08) },
    ];
  }

  function chipTextStyle(active: boolean) {
    return { color: active ? palette.bg : palette.fg, fontWeight: active ? "600" : "400" } as const;
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: palette.bg }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.fg }]}>Voice</Text>
          <Pressable onPress={onClose}>
            <Text style={{ color: palette.fg }}>Close</Text>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={palette.fg} style={styles.loader} />
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={[styles.label, { color: palette.muted }]}>Engine</Text>
            <View style={styles.wrap}>
              {(payload?.engines ?? []).map((item) => (
                <Pressable
                  key={item.id}
                  style={chipStyle(engine === item.id)}
                  onPress={() => setEngine(item.id)}
                >
                  <Text style={chipTextStyle(engine === item.id)}>{item.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.label, { color: palette.muted }]}>Gender</Text>
            <View style={styles.wrap}>
              {(["male", "female"] as const).map((value) => (
                <Pressable
                  key={value}
                  style={chipStyle(gender === value)}
                  onPress={() => setGender(value)}
                >
                  <Text style={[chipTextStyle(gender === value), styles.capitalize]}>
                    {value}
                  </Text>
                </Pressable>
              ))}
            </View>

            {engine === "chirp3" ? (
              <>
                <Text style={[styles.label, { color: palette.muted }]}>Persona</Text>
                <View style={styles.wrap}>
                  {personas.map((item) => (
                    <Pressable
                      key={item}
                      style={chipStyle(persona === item)}
                      onPress={() => setPersona(item)}
                    >
                      <Text style={chipTextStyle(persona === item)}>{item}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {payload?.active ? (
              <Text style={[styles.meta, { color: palette.muted }]}>
                Active: {payload.active.voice}
              </Text>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[
                styles.saveBtn,
                { backgroundColor: withAlpha(palette.fg, 0.9) },
                saving && styles.disabled,
              ]}
              disabled={saving}
              onPress={() => void save()}
            >
              <Text style={{ color: palette.bg, fontWeight: "600" }}>
                {saving ? "Saving…" : "Use this voice"}
              </Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function withAlpha(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: "75%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: "600" },
  loader: { paddingVertical: 24 },
  body: { paddingBottom: 12, gap: 8 },
  label: { fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  capitalize: { textTransform: "capitalize" },
  meta: { fontSize: 12, marginTop: 12 },
  error: { color: "#c0392b", marginTop: 8 },
  saveBtn: { marginTop: 16, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  disabled: { opacity: 0.6 },
});
