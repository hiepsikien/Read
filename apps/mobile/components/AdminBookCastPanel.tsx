import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { ApiError, type BookCastEntry, type BookCastPayload } from "@read/api-client";
import { useAuth } from "../lib/auth";
import { colors } from "../lib/theme";

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
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

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
  secondaryBtnText: { color: colors.ink, fontWeight: "500" },
  btnDisabled: { opacity: 0.6 },
  error: { color: colors.danger },
  ok: { color: colors.sageDeep },
});
