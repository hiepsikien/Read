import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ApiError,
  isRefSpanNoteId,
  noteDisplayTitle,
  type ApiClient,
  type ExplainCandidate,
  type ExplainCard,
  type ExplainResponse,
  type ReaderNote,
} from "@read/api-client";

type Palette = {
  bg: string;
  fg: string;
  muted: string;
};

type Props = {
  visible: boolean;
  mode: "ask" | "result";
  api: ApiClient;
  bookId: string;
  chapterId: string;
  palette: Palette;
  initialQuery?: string;
  paragraphIndex?: number | null;
  paragraphNotes?: ReaderNote[];
  entryId?: string | null;
  onClose: () => void;
};

export function ExplainSheet({
  visible,
  mode,
  api,
  bookId,
  chapterId,
  palette,
  initialQuery = "",
  paragraphIndex = null,
  paragraphNotes = [],
  entryId = null,
  onClose,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [card, setCard] = useState<ExplainCard | null>(null);
  const [candidates, setCandidates] = useState<ExplainCandidate[]>([]);
  const [inlineNotes, setInlineNotes] = useState<ExplainCandidate[]>([]);

  useEffect(() => {
    if (!visible) return;
    setQuery(initialQuery);
    setError("");
    setCard(null);
    setCandidates([]);
    setInlineNotes([]);
    setBusy(false);
    if (mode !== "result" || (paragraphIndex == null && !entryId)) return;

    let cancelled = false;

    if (entryId) {
      const local = paragraphNotes.find((note) => note.id === entryId);
      const localBody = (local?.summary || "").trim();
      if (localBody) {
        setCard({
          title: noteDisplayTitle(local!),
          book_note: localBody,
          ai_context: "",
          sources: ["book"],
          followups: [],
          glossary_entry: null,
        });
        return;
      }
      if (isRefSpanNoteId(entryId)) {
        setCard({
          title: local ? noteDisplayTitle(local) : entryId.slice("span-note:".length) || "Note",
          book_note: "",
          ai_context: "",
          sources: ["book"],
          followups: [],
          glossary_entry: null,
        });
        return;
      }
      setBusy(true);
      void api
        .explainChapter(bookId, chapterId, { entry_id: entryId })
        .then((payload) => {
          if (cancelled) return;
          applyExplainPayload(payload, setCard, setCandidates);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof ApiError ? err.message : "Could not explain this selection.");
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
      return () => {
        cancelled = true;
      };
    }

    const seeds: ExplainCandidate[] = paragraphNotes.map((note) => ({
      id: note.id,
      name: noteDisplayTitle(note),
      episode_key: note.episode_key,
      group_label: note.group_label,
      summary: note.summary || "",
    }));
    setInlineNotes(seeds);
    const missing = seeds.filter((item) => !item.summary?.trim());
    if (missing.length) setBusy(true);

    void (async () => {
      if (missing.length) {
        const filled = await Promise.all(
          missing.map(async (item) => {
            try {
              const payload = await api.explainChapter(bookId, chapterId, { entry_id: item.id });
              return {
                ...item,
                name: payload.card?.title || item.name,
                summary: payload.card?.book_note || "",
              };
            } catch {
              return item;
            }
          })
        );
        if (cancelled) return;
        const byId = new Map(filled.map((item) => [item.id, item]));
        setInlineNotes(seeds.map((item) => byId.get(item.id) ?? item));
        setBusy(false);
      }

      try {
        const payload = await api.explainChapter(bookId, chapterId, {
          paragraph_index: paragraphIndex ?? undefined,
        });
        if (cancelled) return;
        if (payload.card && !payload.card.glossary_entry) {
          setCard(payload.card);
        }
      } catch {
        // Current cloud API may 404 on paragraph explain; note bodies already loaded.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    visible,
    mode,
    initialQuery,
    paragraphIndex,
    paragraphNotes,
    entryId,
    bookId,
    chapterId,
    api,
  ]);

  async function runExplain(
    body: {
      query?: string;
      paragraph_index?: number;
      entry_id?: string;
      need_context?: boolean;
    },
    opts?: { quiet?: boolean }
  ) {
    if (!opts?.quiet) setBusy(true);
    setError("");
    try {
      const payload: ExplainResponse = await api.explainChapter(bookId, chapterId, body);
      applyExplainPayload(payload, setCard, setCandidates);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not explain this selection.");
      setCard(null);
      setCandidates([]);
    } finally {
      if (!opts?.quiet) setBusy(false);
    }
  }

  const noteCard = Boolean(entryId);
  const paragraphSheet = !noteCard && mode === "result";

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: palette.bg }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.fg }]}>
            {sheetTitle(mode, inlineNotes, card, noteCard)}
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={{ color: palette.fg }}>Close</Text>
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          {mode === "ask" ? (
            <View style={styles.askRow}>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: palette.fg,
                    borderColor: withAlpha(palette.fg, 0.18),
                    backgroundColor: withAlpha(palette.fg, 0.04),
                  },
                ]}
                value={query}
                onChangeText={setQuery}
                placeholder="Who is Vasco da Gama?"
                placeholderTextColor={palette.muted}
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={() => {
                  if (query.trim()) void runExplain({ query: query.trim() });
                }}
              />
              <Pressable
                style={[styles.askBtn, !query.trim() && styles.disabled]}
                disabled={!query.trim() || busy}
                onPress={() => void runExplain({ query: query.trim() })}
              >
                <Text style={styles.askBtnText}>{busy ? "…" : "Ask"}</Text>
              </Pressable>
            </View>
          ) : null}

          {busy ? <ActivityIndicator color="#5f7d6a" style={{ marginVertical: 16 }} /> : null}
          {error ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: palette.muted }]}>
              {error}
            </Text>
          ) : null}

          {noteCard && card ? (
            <ExplainCardView
              card={card}
              palette={palette}
              extraLabel="Giải thích thêm"
              onFollowup={(q) =>
                void runExplain({
                  query: q,
                  need_context: true,
                  paragraph_index: paragraphIndex ?? undefined,
                })
              }
              onNeedContext={() =>
                runExplain(
                  {
                    entry_id: card.glossary_entry?.id ?? entryId ?? undefined,
                    need_context: true,
                    paragraph_index: paragraphIndex ?? undefined,
                  },
                  { quiet: true }
                )
              }
            />
          ) : null}

          {paragraphSheet ? (
            <View style={styles.block}>
              {inlineNotes.length > 0 ? (
                <View style={styles.block}>
                  {inlineNotes.map((candidate) => (
                    <View
                      key={candidate.id}
                      style={[styles.inlineNote, { borderBottomColor: withAlpha(palette.fg, 0.12) }]}
                    >
                      <Text style={[styles.cardTitle, { color: palette.fg }]}>{candidate.name}</Text>
                      {candidate.summary ? (
                        <Text style={[styles.note, { color: palette.fg }]}>{candidate.summary}</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}
              <ParagraphExtra
                palette={palette}
                aiContext={card && !card.glossary_entry ? card.ai_context : ""}
                onNeedContext={async () => {
                  try {
                    const payload = await api.explainChapter(bookId, chapterId, {
                      need_context: true,
                      paragraph_index: paragraphIndex ?? undefined,
                    });
                    if (payload.card && !payload.card.glossary_entry) {
                      setCard(payload.card);
                      return;
                    }
                    throw new Error("unsupported");
                  } catch (err) {
                    setError(
                      err instanceof ApiError
                        ? err.message
                        : "Chưa giải thích được đoạn này."
                    );
                  }
                }}
              />
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function isEditorialNote(card: ExplainCard) {
  const label = card.glossary_entry?.group_label?.trim().toLowerCase() || "";
  const name = card.title || card.glossary_entry?.name || "";
  return (
    label === "chú thích" ||
    label === "thuật ngữ" ||
    label === "bối cảnh" ||
    label.startsWith("bối cảnh") ||
    name.toLowerCase().startsWith("bối cảnh") ||
    /\s*\[\d+\]\s*$/.test(name)
  );
}

function applyExplainPayload(
  payload: ExplainResponse,
  setCard: (card: ExplainCard | null) => void,
  setCandidates: (candidates: ExplainCandidate[]) => void
) {
  if (payload.status === "candidates") {
    setCandidates(payload.candidates);
    setCard(payload.card ?? null);
    return;
  }
  if (payload.card) {
    setCard(payload.card);
    setCandidates(payload.candidates ?? []);
  }
}

function sheetTitle(
  mode: "ask" | "result",
  candidates: ExplainCandidate[],
  card: ExplainCard | null,
  noteCard: boolean
) {
  if (mode === "ask" && !card && candidates.length === 0) return "Hỏi";
  if (!noteCard) return candidates.length > 0 ? "Chú thích" : "Giải thích";
  const editorial =
    (card && isEditorialNote(card)) ||
    (candidates.length > 0 &&
      candidates.every((item) => {
        const label = item.group_label?.trim().toLowerCase() || "";
        return (
          label === "chú thích" ||
          label === "thuật ngữ" ||
          label === "bối cảnh" ||
          /\s*\[\d+\]\s*$/.test(item.name)
        );
      }));
  return editorial ? "Chú thích" : "Giải thích";
}

function ExplainCardView({
  card,
  palette,
  extraLabel = "Giải thích thêm",
  onFollowup,
  onNeedContext,
}: {
  card: ExplainCard;
  palette: Palette;
  extraLabel?: string;
  onFollowup?: (query: string) => void;
  onNeedContext?: () => Promise<void>;
}) {
  const editorial = isEditorialNote(card);
  const [extraOpen, setExtraOpen] = useState(false);
  const [extraBusy, setExtraBusy] = useState(false);
  const cardKey = card.glossary_entry?.id || card.title;

  useEffect(() => {
    setExtraOpen(false);
    setExtraBusy(false);
  }, [cardKey]);

  async function openExtra() {
    if (card.ai_context) {
      setExtraOpen(true);
      return;
    }
    if (!onNeedContext) return;
    setExtraBusy(true);
    try {
      await onNeedContext();
      setExtraOpen(true);
    } finally {
      setExtraBusy(false);
    }
  }

  return (
    <View style={styles.block}>
      <Text style={[styles.cardTitle, { color: palette.fg }]}>{card.title}</Text>

      {card.book_note ? (
        <View style={styles.noteBlock}>
          <Text style={[styles.note, { color: palette.fg }]}>{card.book_note}</Text>
        </View>
      ) : null}

      {extraOpen && card.ai_context ? (
        <View style={styles.noteBlock}>
          <Text style={[styles.label, { color: palette.muted }]}>{extraLabel}</Text>
          <Text style={[styles.note, { color: palette.fg }]}>{card.ai_context}</Text>
        </View>
      ) : (
        <Pressable
          onPress={() => void openExtra()}
          disabled={extraBusy}
          accessibilityRole="button"
          accessibilityLabel={extraLabel}
        >
          <Text style={[styles.extraLink, { color: palette.muted }]}>
            {extraBusy ? "…" : extraLabel}
          </Text>
        </Pressable>
      )}

      {!editorial && onFollowup && card.followups.length ? (
        <View style={styles.followups}>
          {card.followups.map((item) => (
            <Pressable
              key={item}
              style={[styles.followupChip, { backgroundColor: withAlpha(palette.fg, 0.08) }]}
              onPress={() => onFollowup(item)}
            >
              <Text style={{ color: palette.fg, fontSize: 13 }}>{item}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ParagraphExtra({
  palette,
  aiContext,
  onNeedContext,
}: {
  palette: Palette;
  aiContext: string;
  onNeedContext: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!aiContext) setOpen(false);
  }, [aiContext]);

  async function openExtra() {
    if (aiContext) {
      setOpen(true);
      return;
    }
    setBusy(true);
    try {
      await onNeedContext();
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  if (open && aiContext) {
    return (
      <View style={styles.noteBlock}>
        <Text style={[styles.label, { color: palette.muted }]}>Giải thích thêm đoạn này</Text>
        <Text style={[styles.note, { color: palette.fg }]}>{aiContext}</Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => void openExtra()}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Giải thích thêm đoạn này"
    >
      <Text style={[styles.extraLinkPlain, { color: palette.muted }]}>
        {busy ? "…" : "Giải thích thêm đoạn này"}
      </Text>
    </Pressable>
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
    maxHeight: "78%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 18,
    paddingBottom: 28,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  title: { fontSize: 17, fontWeight: "600" },
  body: { paddingBottom: 24, gap: 8 },
  askRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  askBtn: {
    backgroundColor: "#5f7d6a",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  askBtnText: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.45 },
  error: { fontSize: 13, lineHeight: 18 },
  block: { gap: 8 },
  label: { fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase", fontWeight: "600" },
  candidate: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  candidateName: { fontSize: 16, fontWeight: "500" },
  inlineNote: {
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cardTitle: { fontSize: 18, fontWeight: "700" },
  sources: { fontSize: 12, marginBottom: 4 },
  noteBlock: { gap: 6, marginTop: 4 },
  note: { fontSize: 15, lineHeight: 23 },
  extraLink: {
    fontSize: 13,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    fontWeight: "600",
    marginTop: 8,
  },
  extraLinkPlain: {
    fontSize: 15,
    fontWeight: "600",
    marginTop: 12,
  },
  followups: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  followupChip: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
});
