import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { ApiError, type BookCastEntry, type BookCastPayload } from "@read/api-client";
import { useAuth } from "../lib/auth";
import { colors } from "../lib/theme";

function castPreviewText(name: string): string {
  const label = name.trim() || "nhân vật này";
  return `${label}. Xin chào, đây là giọng của tôi.`;
}

type Draft = {
  id: string | null;
  speaker_key: string;
  gender: "male" | "female";
  age_band: "youth" | "adult" | "elder";
  presence: "soft" | "neutral" | "forceful";
  tts_voice: string;
  cast_locked: boolean;
};

type FilterId = "all" | "unmatched" | "locked" | "unlocked";

/** Stable React/list key — unmatched rows have id=null, so never key on id alone. */
function entryKey(entry: BookCastEntry, index = 0): string {
  if (entry.id) return `g:${entry.id}`;
  if (entry.speaker_key) return `s:${entry.speaker_key}`;
  if (entry.speaker_cue) return `c:${entry.speaker_cue}`;
  if (entry.name) return `n:${entry.name}:${index}`;
  return `i:${index}`;
}

function ChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.chipWrap}>
      {options.map((option) => (
        <Pressable
          key={option}
          style={[styles.chip, value === option && styles.chipActive]}
          onPress={() => onChange(option)}
        >
          <Text style={[styles.chipText, value === option && styles.chipTextActive]}>
            {option}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function AdminBookCastPanel({ bookId }: { bookId: string }) {
  const { api } = useAuth();
  const [payload, setPayload] = useState<BookCastPayload | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [scope, setScope] = useState<"speaking" | "all">("speaking");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingGlossary, setUploadingGlossary] = useState(false);
  const [previewingKey, setPreviewingKey] = useState<string | null>(null);
  const [recommendingKey, setRecommendingKey] = useState<string | null>(null);
  const [rationales, setRationales] = useState<
    Record<string, { text: string; source: "ai" | "heuristic" }>
  >({});
  const [entryErrors, setEntryErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);
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

  useEffect(() => {
    if (playerStatus.didJustFinish) {
      setPreviewingKey(null);
    }
  }, [playerStatus.didJustFinish]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.adminGetBookCast(bookId, scope);
      const next: Record<string, Draft> = {};
      data.entries.forEach((entry, index) => {
        const gender = entry.gender === "female" ? "female" : "male";
        const personas = data.cast_personas[gender] ?? [];
        const fallbackVoice =
          entry.tts_voice ||
          (data.engine === "chirp3"
            ? `vi-VN-Chirp3-HD-${personas[0] ?? "Charon"}`
            : data.narrator_voice);
        next[entryKey(entry, index)] = {
          id: entry.id,
          speaker_key: entry.speaker_key || entry.speaker_cue || entry.name || entryKey(entry, index),
          gender,
          age_band: entry.age_band ?? "adult",
          presence: entry.presence ?? "neutral",
          tts_voice: fallbackVoice,
          cast_locked: entry.cast_locked,
        };
      });
      setDrafts(next);
      setPayload(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load cast.");
    } finally {
      setLoading(false);
    }
  }, [api, bookId, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const personaOptions = useMemo(() => {
    if (!payload) return { male: [] as string[], female: [] as string[] };
    return payload.cast_personas;
  }, [payload]);

  const visibleEntries = useMemo(() => {
    if (!payload) return [];
    const q = query.trim().toLowerCase();
    return payload.entries.filter((entry) => {
      if (filter === "unmatched" && entry.matched !== false && entry.source !== "unmatched") {
        return false;
      }
      if (filter === "locked" && !entry.cast_locked) return false;
      if (filter === "unlocked" && entry.cast_locked) return false;
      if (!q) return true;
      const haystack = [
        entry.name,
        entry.speaker_cue,
        entry.speaker_key,
        ...(entry.aliases || []),
        entry.summary,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [payload, query, filter]);

  function updateDraft(key: string, patch: Partial<Draft>) {
    setDrafts((prev) => {
      const current = prev[key];
      if (!current) return prev;
      const next = { ...current, ...patch };
      if (patch.gender && payload?.engine === "chirp3") {
        const personas = personaOptions[patch.gender] ?? [];
        const persona = next.tts_voice.split("-").pop() ?? "";
        if (!personas.includes(persona)) {
          next.tts_voice = `vi-VN-Chirp3-HD-${personas[0] ?? "Charon"}`;
        }
      }
      return { ...prev, [key]: next };
    });
  }

  function playCastPreview(key: string, draft: Draft, name: string) {
    if (!payload || playerReleased.current) return;
    const persona =
      payload.engine === "chirp3" ? (draft.tts_voice.split("-").pop() ?? "") : "";
    const uri = api.ttsPreviewUrl({
      engine: payload.engine,
      gender: draft.gender,
      chirp_persona: persona || undefined,
      voice: draft.tts_voice,
      text: castPreviewText(name),
    });
    try {
      setPreviewingKey(key);
      setError("");
      player.replace({ uri });
      player.play();
    } catch {
      setPreviewingKey(null);
      setError("Could not play the voice preview.");
    }
  }

  async function recommendCast(key: string, draft: Draft) {
    if (!payload) return;
    setRecommendingKey(key);
    setError("");
    setStatus("");
    setEntryErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const usedVoices = [
        ...new Set(
          Object.entries(drafts)
            .filter(([otherKey]) => otherKey !== key)
            .map(([, item]) => item.tts_voice)
            .filter(Boolean)
        ),
      ];
      const result = await api.adminRecommendBookCast(bookId, {
        entry_id: draft.id,
        speaker_key: draft.speaker_key,
        used_voices: usedVoices,
      });
      updateDraft(key, {
        gender: result.gender,
        age_band: result.age_band,
        presence: result.presence,
        tts_voice: result.tts_voice,
      });
      const text =
        result.rationale?.trim() ||
        (result.source === "ai"
          ? "AI đã gợi ý cast cho nhân vật này."
          : "Heuristic đã gợi ý cast (Gemini chưa bật).");
      setRationales((prev) => ({
        ...prev,
        [key]: { text, source: result.source },
      }));
      setStatus(
        `Đã áp dụng gợi ý cho ${result.name || "nhân vật"} (chưa Save). Nghe Preview rồi Save.`
      );
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Không gợi ý được cast.";
      setEntryErrors((prev) => ({ ...prev, [key]: message }));
      setError(message);
    } finally {
      setRecommendingKey(null);
    }
  }

  async function save() {
    if (!payload) return;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const entries = payload.entries.flatMap((entry, index) => {
        const draft = drafts[entryKey(entry, index)];
        if (!draft) return [];
        return [
          {
            id: draft.id,
            speaker_key: draft.speaker_key,
            gender: draft.gender,
            age_band: draft.age_band,
            presence: draft.presence,
            tts_voice: draft.tts_voice,
            cast_locked: draft.cast_locked,
          },
        ];
      });
      const result = await api.adminUpdateBookCast(bookId, entries);
      setStatus(`Saved ${result.updated} cast row(s).`);
      if (result.warnings?.length) {
        setStatus((prev) => `${prev} ${result.warnings!.join(" ")}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save cast.");
    } finally {
      setSaving(false);
    }
  }

  async function rebuild(unlock: boolean) {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const result = await api.adminRebuildBookCast(bookId, unlock);
      setStatus(`Rebuilt ${result.updated} row(s).`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rebuild cast.");
    } finally {
      setSaving(false);
    }
  }

  async function setCastStatus(next: "draft" | "ready") {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const result = await api.adminSetBookCastStatus(bookId, next);
      setStatus(
        next === "ready"
          ? "Cast marked ready."
          : "Cast set back to draft."
      );
      if (result.warnings?.length) {
        setStatus((prev) => `${prev} ${result.warnings.join(" ")}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update cast status.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadGlossary() {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "org.openxmlformats.wordprocessingml.document",
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setUploadingGlossary(true);
    setError("");
    setStatus("");
    try {
      const form = new FormData();
      form.append("file", {
        uri: asset.uri,
        name: asset.name || "glossary.docx",
        type:
          asset.mimeType ||
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      } as unknown as Blob);
      const imported = await api.uploadGlossary(bookId, form);
      setStatus(`Imported ${imported.count} character notes from glossary.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Glossary upload failed.");
    } finally {
      setUploadingGlossary(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.sage} />
      </View>
    );
  }

  if (!payload) {
    return (
      <View style={styles.card}>
        <Text style={styles.error}>{error || "No cast data."}</Text>
        <Text style={styles.sub}>
          If this book has no character glossary yet, upload a NHÂN VẬT.docx below after reload —
          or open Audio cast again once the book loads.
        </Text>
        <Pressable
          style={[styles.secondaryBtn, uploadingGlossary && styles.btnDisabled]}
          disabled={uploadingGlossary}
          onPress={() => void uploadGlossary()}
        >
          <Text style={styles.secondaryBtnText}>
            {uploadingGlossary ? "Uploading…" : "Upload NHÂN VẬT.docx"}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Audio cast</Text>
      <Text style={styles.sub}>
        Speaking characters only by default. This is the audio editorial pass for the book.
      </Text>
      <Text style={styles.meta}>
        {payload.speaking_count ?? 0} speaking · {payload.glossary_count ?? 0} glossary
        {(payload.unmatched_count ?? 0) > 0
          ? ` · ${payload.unmatched_count} unmatched`
          : ""}
        {" · "}
        status {payload.cast_status || "draft"}
      </Text>

      <Text style={styles.label}>Character glossary</Text>
      <Text style={styles.sub}>
        Upload NHÂN VẬT.docx so speaking cues can match cast voices. Replaces the current glossary
        for this book.
      </Text>
      <Pressable
        style={[styles.secondaryBtn, (saving || uploadingGlossary) && styles.btnDisabled]}
        disabled={saving || uploadingGlossary}
        onPress={() => void uploadGlossary()}
      >
        <Text style={styles.secondaryBtnText}>
          {uploadingGlossary
            ? "Uploading…"
            : (payload.glossary_count ?? 0) > 0
              ? "Replace NHÂN VẬT.docx"
              : "Upload NHÂN VẬT.docx"}
        </Text>
      </Pressable>

      {(payload.warnings ?? []).map((warning, index) => (
        <Text key={`warn-${index}-${warning}`} style={styles.warn}>
          {warning}
        </Text>
      ))}

      <Text style={styles.label}>List scope</Text>
      <ChipRow
        options={["speaking", "all"]}
        value={scope}
        onChange={(value) => setScope(value)}
      />

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search name, alias, cue…"
        placeholderTextColor={colors.inkSoft}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>Filter</Text>
      <ChipRow
        options={["all", "unmatched", "locked", "unlocked"]}
        value={filter}
        onChange={(value) => setFilter(value)}
      />

      <Text style={styles.meta}>
        Showing {visibleEntries.length} of {payload.entries.length}
      </Text>

      {visibleEntries.length === 0 ? (
        <Text style={styles.meta}>
          {scope === "speaking"
            ? "No speaking cues detected. Upload chapters with screenplay dialogue, or switch scope to all."
            : "No glossary characters yet."}
        </Text>
      ) : (
        visibleEntries.map((entry: BookCastEntry) => {
          const index = payload.entries.indexOf(entry);
          const key = entryKey(entry, index >= 0 ? index : 0);
          const draft = drafts[key];
          if (!draft) {
            return <View key={key} />;
          }
          const personas = personaOptions[draft.gender] ?? [];
          return (
            <View key={key} style={styles.entry}>
              <View style={styles.entryHeader}>
                <Text style={styles.entryName}>{entry.name}</Text>
                {entry.source === "unmatched" ? (
                  <Text style={styles.badgeWarn}>unmatched</Text>
                ) : entry.line_count ? (
                  <Text style={styles.badge}>{entry.line_count} lines</Text>
                ) : (
                  <Text style={styles.badgeMuted}>glossary only</Text>
                )}
              </View>
              {entry.speaker_cue && entry.speaker_cue !== entry.name ? (
                <Text style={styles.meta}>Cue: {entry.speaker_cue}</Text>
              ) : null}
              {entry.first_chapter_title ? (
                <Text style={styles.meta}>First in: {entry.first_chapter_title}</Text>
              ) : null}
              {entry.summary ? (
                <Text style={styles.entrySummary} numberOfLines={3}>
                  {entry.summary}
                </Text>
              ) : null}

              <Text style={styles.label}>Gender</Text>
              <ChipRow
                options={["male", "female"]}
                value={draft.gender}
                onChange={(value) => updateDraft(key, { gender: value })}
              />

              <Text style={styles.label}>Age</Text>
              <ChipRow
                options={["youth", "adult", "elder"]}
                value={draft.age_band}
                onChange={(value) => updateDraft(key, { age_band: value })}
              />

              <Text style={styles.label}>Presence</Text>
              <ChipRow
                options={["soft", "neutral", "forceful"]}
                value={draft.presence}
                onChange={(value) => updateDraft(key, { presence: value })}
              />

              {payload.engine === "chirp3" ? (
                <>
                  <Text style={styles.label}>Voice persona</Text>
                  <View style={styles.chipWrap}>
                    {personas.map((persona) => {
                      const voice = `vi-VN-Chirp3-HD-${persona}`;
                      const active = draft.tts_voice === voice;
                      return (
                        <Pressable
                          key={persona}
                          style={[styles.chip, active && styles.chipActive]}
                          onPress={() => updateDraft(key, { tts_voice: voice })}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>
                            {persona}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : (
                <Text style={styles.meta}>Voice: {draft.tts_voice}</Text>
              )}

              {(() => {
                const draftPersona = draft.tts_voice.split("-").pop() || "—";
                const effective = entry.effective_tts_voice || entry.tts_voice || "";
                const synthPersona = effective.split("-").pop() || "";
                const conflict = Boolean(entry.voice_conflict);
                return (
                  <View style={[styles.synthBox, conflict && styles.synthBoxConflict]}>
                    <Text style={styles.synthLabel}>Will speak as</Text>
                    <Text style={styles.synthValue}>{draftPersona}</Text>
                    {conflict && synthPersona && synthPersona !== draftPersona ? (
                      <Text style={styles.synthHint}>
                        Synth map still has {synthPersona}. Save cast (or clear stale
                        override) so audio matches this row.
                      </Text>
                    ) : null}
                  </View>
                );
              })()}

              <View style={styles.actionRow}>
                <Pressable
                  style={[
                    styles.secondaryBtn,
                    styles.actionBtn,
                    previewingKey === key && styles.previewActive,
                  ]}
                  onPress={() =>
                    playCastPreview(key, draft, entry.name || entry.speaker_cue || "")
                  }
                >
                  <Text style={styles.secondaryBtnText}>
                    {previewingKey === key ? "Playing…" : "Preview"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.secondaryBtn,
                    styles.actionBtn,
                    recommendingKey === key && styles.previewActive,
                    (saving || recommendingKey === key) && styles.btnDisabled,
                  ]}
                  disabled={saving || recommendingKey === key}
                  onPress={() => void recommendCast(key, draft)}
                >
                  <Text style={styles.secondaryBtnText}>
                    {recommendingKey === key ? "AI…" : "AI recommend"}
                  </Text>
                </Pressable>
              </View>
              {rationales[key] ? (
                <View style={styles.rationaleBox}>
                  <Text style={styles.rationaleLabel}>
                    {rationales[key].source === "ai"
                      ? "Why this voice (AI)"
                      : "Why this voice (heuristic)"}
                  </Text>
                  <Text style={styles.rationale}>{rationales[key].text}</Text>
                </View>
              ) : null}
              {entryErrors[key] ? (
                <Text style={styles.error}>{entryErrors[key]}</Text>
              ) : null}

              <View style={styles.switchRow}>
                <Text style={styles.label}>Lock override</Text>
                <Switch
                  value={draft.cast_locked}
                  onValueChange={(value) => updateDraft(key, { cast_locked: value })}
                />
              </View>
            </View>
          );
        })
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.ok}>{status}</Text> : null}

      <Pressable
        style={[styles.primaryBtn, saving && styles.btnDisabled]}
        disabled={saving || payload.entries.length === 0}
        onPress={() => void save()}
      >
        <Text style={styles.primaryBtnText}>{saving ? "Saving…" : "Save cast"}</Text>
      </Pressable>
      <Pressable
        style={styles.secondaryBtn}
        disabled={saving}
        onPress={() => void setCastStatus("ready")}
      >
        <Text style={styles.secondaryBtnText}>Mark cast ready</Text>
      </Pressable>
      <Pressable
        style={styles.secondaryBtn}
        disabled={saving}
        onPress={() => void setCastStatus("draft")}
      >
        <Text style={styles.secondaryBtnText}>Set cast to draft</Text>
      </Pressable>
      <Pressable
        style={styles.secondaryBtn}
        disabled={saving}
        onPress={() => void rebuild(false)}
      >
        <Text style={styles.secondaryBtnText}>Rebuild unlocked</Text>
      </Pressable>
      <Pressable
        style={styles.secondaryBtn}
        disabled={saving}
        onPress={() => void rebuild(true)}
      >
        <Text style={styles.secondaryBtnText}>Rebuild all (unlock)</Text>
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
  title: { fontSize: 17, fontWeight: "700", color: colors.ink },
  sub: { fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
  meta: { fontSize: 12, color: colors.inkSoft },
  warn: { fontSize: 12, color: colors.danger },
  search: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    backgroundColor: "rgba(255,255,255,0.75)",
  },
  entry: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
    gap: 8,
  },
  entryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  entryName: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.ink },
  badge: {
    fontSize: 11,
    color: colors.sageDeep,
    backgroundColor: "rgba(110,139,116,0.15)",
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeWarn: {
    fontSize: 11,
    color: colors.danger,
    backgroundColor: "rgba(180,60,60,0.12)",
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeMuted: {
    fontSize: 11,
    color: colors.inkSoft,
    backgroundColor: "rgba(0,0,0,0.05)",
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  entrySummary: { fontSize: 12, color: colors.inkSoft, lineHeight: 17 },
  label: { color: colors.inkSoft, fontSize: 12 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  chipActive: { backgroundColor: colors.sage, borderColor: colors.sage },
  chipText: { color: colors.ink, textTransform: "capitalize", fontSize: 13 },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  primaryBtn: {
    backgroundColor: colors.sage,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  actionRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1 },
  previewActive: {
    borderColor: colors.sage,
    backgroundColor: "rgba(110,139,116,0.12)",
  },
  secondaryBtnText: { color: colors.ink, fontWeight: "500" },
  rationaleBox: {
    borderWidth: 1,
    borderColor: "rgba(110,139,116,0.35)",
    backgroundColor: "rgba(110,139,116,0.1)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  rationaleLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.sageDeep,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  rationale: { fontSize: 13, color: colors.ink, lineHeight: 18 },
  synthBox: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  synthBoxConflict: {
    borderColor: colors.danger,
    backgroundColor: "rgba(180,60,60,0.08)",
  },
  synthLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  synthValue: { fontSize: 15, fontWeight: "600", color: colors.ink },
  synthHint: { fontSize: 12, color: colors.danger, lineHeight: 17, marginTop: 2 },
  btnDisabled: { opacity: 0.6 },
  error: { color: colors.danger },
  ok: { color: colors.sageDeep },
});
