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
  type ApiClient,
  type ExplainCandidate,
  type ExplainCard,
  type ExplainResponse,
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
  onClose,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [card, setCard] = useState<ExplainCard | null>(null);
  const [candidates, setCandidates] = useState<ExplainCandidate[]>([]);
  const [history, setHistory] = useState<ExplainCard[]>([]);

  useEffect(() => {
    if (!visible) return;
    setQuery(initialQuery);
    setError("");
    setCard(null);
    setCandidates([]);
    if (mode !== "result" || paragraphIndex == null) return;

    let cancelled = false;
    setBusy(true);
    void api
      .explainChapter(bookId, chapterId, { paragraph_index: paragraphIndex })
      .then((payload) => {
        if (cancelled) return;
        if (payload.status === "candidates") {
          setCandidates(payload.candidates);
          setCard(null);
          return;
        }
        if (payload.card) {
          setCard(payload.card);
          setCandidates([]);
          setHistory((prev) => {
            const next = [payload.card!, ...prev.filter((item) => item.title !== payload.card!.title)];
            return next.slice(0, 8);
          });
        }
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
  }, [visible, mode, initialQuery, paragraphIndex, bookId, chapterId, api]);

  async function runExplain(body: {
    query?: string;
    paragraph_index?: number;
    entry_id?: string;
    need_context?: boolean;
  }) {
    setBusy(true);
    setError("");
    try {
      const payload: ExplainResponse = await api.explainChapter(bookId, chapterId, body);
      if (payload.status === "candidates") {
        setCandidates(payload.candidates);
        setCard(null);
        return;
      }
      if (payload.card) {
        setCard(payload.card);
        setCandidates([]);
        setHistory((prev) => {
          const next = [payload.card!, ...prev.filter((item) => item.title !== payload.card!.title)];
          return next.slice(0, 8);
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not explain this selection.");
      setCard(null);
      setCandidates([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: palette.bg }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.fg }]}>
            {mode === "ask" ? "Ask about this chapter" : "Understand quickly"}
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

          {candidates.length > 0 ? (
            <View style={styles.block}>
              <Text style={[styles.label, { color: palette.muted }]}>Choose a name</Text>
              {candidates.map((candidate) => (
                <Pressable
                  key={candidate.id}
                  style={[styles.candidate, { borderColor: withAlpha(palette.fg, 0.12) }]}
                  onPress={() =>
                    void runExplain({
                      entry_id: candidate.id,
                      query: candidate.name,
                      paragraph_index: paragraphIndex ?? undefined,
                    })
                  }
                >
                  <Text style={[styles.candidateName, { color: palette.fg }]}>{candidate.name}</Text>
                  {candidate.group_label ? (
                    <Text style={{ color: palette.muted, fontSize: 12 }}>{candidate.group_label}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          {card ? <ExplainCardView card={card} palette={palette} onFollowup={(q) => void runExplain({ query: q, need_context: true, paragraph_index: paragraphIndex ?? undefined })} /> : null}

          {history.length > 1 ? (
            <View style={styles.block}>
              <Text style={[styles.label, { color: palette.muted }]}>This chapter</Text>
              {history.slice(1).map((item) => (
                <Pressable key={item.title} onPress={() => setCard(item)} style={styles.historyRow}>
                  <Text style={{ color: palette.fg }}>{item.title}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function ExplainCardView({
  card,
  palette,
  onFollowup,
}: {
  card: ExplainCard;
  palette: Palette;
  onFollowup: (query: string) => void;
}) {
  return (
    <View style={styles.block}>
      <Text style={[styles.cardTitle, { color: palette.fg }]}>{card.title}</Text>
      <Text style={[styles.sources, { color: palette.muted }]}>
        {card.sources.length
          ? card.sources
              .map((source) => (source === "book" ? "From the book" : source === "ai" ? "AI context" : source))
              .join(" · ")
          : "No sources"}
      </Text>

      {card.book_note ? (
        <View style={styles.noteBlock}>
          <Text style={[styles.label, { color: palette.muted }]}>From the book</Text>
          <Text style={[styles.note, { color: palette.fg }]}>{card.book_note}</Text>
        </View>
      ) : null}

      {card.ai_context ? (
        <View style={styles.noteBlock}>
          <Text style={[styles.label, { color: palette.muted }]}>AI context</Text>
          <Text style={[styles.note, { color: palette.fg }]}>{card.ai_context}</Text>
        </View>
      ) : null}

      {card.followups.length ? (
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
  title: { fontSize: 18, fontWeight: "600" },
  body: { paddingBottom: 24, gap: 14 },
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
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  candidateName: { fontSize: 15, fontWeight: "600" },
  cardTitle: { fontSize: 22, fontWeight: "700" },
  sources: { fontSize: 12, marginBottom: 4 },
  noteBlock: { gap: 6, marginTop: 4 },
  note: { fontSize: 15, lineHeight: 23 },
  followups: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  followupChip: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  historyRow: { paddingVertical: 8 },
});
