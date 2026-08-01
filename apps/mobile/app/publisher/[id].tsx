import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import {
  ApiError,
  DEFAULT_SEGMENT_TITLE_COMPONENTS,
  SEGMENT_TITLE_COMPONENT_OPTIONS,
  SPLIT_LENGTH_OPTIONS,
  SUGGEST_LANGUAGE_OPTIONS,
  formatSegmentTitlePreview,
  type BookDetail,
  type Category,
  type ChapterListItem,
  type SegmentTitleComponent,
  type SeriesListItem,
  type SplitLength,
  type SuggestLanguage,
} from "@read/api-client";
import { BookCover } from "../../components/BookCover";
import { FormScroll } from "../../components/FormScroll";
import { useAuth } from "../../lib/auth";
import { bookStatusLabel, displayFilename } from "../../lib/book-labels";
import { pickBookCoverImage } from "../../lib/pick-cover";
import { colors, coverHeightForWidth, formatPrice } from "../../lib/theme";

type SuggestionPreview = {
  category: Category | null;
  description: string | null;
};

export default function ManageBookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { api } = useAuth();

  const [book, setBook] = useState<BookDetail | null>(null);
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pricing, setPricing] = useState<"free" | "paid">("free");
  const [price, setPrice] = useState("4.99");
  const [categoryId, setCategoryId] = useState("");
  const [seriesList, setSeriesList] = useState<SeriesListItem[]>([]);
  const [seriesId, setSeriesId] = useState("");
  const [seasonNumber, setSeasonNumber] = useState("1");
  const [episodeNumber, setEpisodeNumber] = useState("1");
  const [splitLength, setSplitLength] = useState<SplitLength>("standard");
  const [suggestLanguage, setSuggestLanguage] = useState<SuggestLanguage>("en");
  const [titleComponents, setTitleComponents] = useState<SegmentTitleComponent[]>(
    DEFAULT_SEGMENT_TITLE_COMPONENTS
  );
  const [busy, setBusy] = useState<
    "" | "split" | "submit" | "cover" | "glossary" | "suggest" | "discard" | "titles" | "series"
  >("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [glossaryCount, setGlossaryCount] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestionPreview | null>(null);
  const [localCoverUri, setLocalCoverUri] = useState<string | null>(null);

  const formRef = useRef({ title, description, pricing, price, categoryId });
  useEffect(() => {
    formRef.current = { title, description, pricing, price, categoryId };
  }, [title, description, pricing, price, categoryId]);

  const locked = book?.status === "pending_review" || book?.status === "published";

  const load = useCallback(async () => {
    if (!id) return;
    setError("");
    try {
      const [data, categoryPayload, mineSeries] = await Promise.all([
        api.getBook(id),
        api.listCategories(),
        api.listSeries({ mine: true }),
      ]);
      setBook(data.book);
      setChapters(data.chapters);
      setCategories(categoryPayload.categories);
      setSeriesList(mineSeries.series);
      setTitle(data.book.title);
      setDescription(data.book.description);
      setPricing(data.book.price_cents > 0 ? "paid" : "free");
      setPrice(((data.book.price_cents || 499) / 100).toFixed(2));
      setCategoryId(data.book.category?.id || categoryPayload.categories[0]?.id || "");
      setSeriesId(data.book.series?.id || "");
      setSeasonNumber(String(data.book.season_number || 1));
      setEpisodeNumber(String(data.book.episode_number || 1));
      try {
        const glossary = await api.listGlossary(id);
        setGlossaryCount(glossary.count);
      } catch {
        setGlossaryCount(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load book.");
    }
  }, [api, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function persistMeta(overrides?: Partial<typeof formRef.current>) {
    if (!id || locked) return;
    const current = { ...formRef.current, ...overrides };
    await api.updateBook(id, {
      title: current.title,
      description: current.description,
      pricing: current.pricing,
      price: Number(current.price),
      category_id: current.categoryId,
    });
    formRef.current = current;
  }

  async function saveSeriesPlacement() {
    if (!id) return;
    setBusy("series");
    setMessage("");
    setError("");
    try {
      if (!seriesId) {
        await api.updateBook(id, { clear_series: true });
        setMessage("Removed from series.");
      } else {
        await api.updateBook(id, {
          series_id: seriesId,
          season_number: Number(seasonNumber),
          episode_number: Number(episodeNumber),
        });
        setMessage("Series placement saved.");
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save series placement.");
    } finally {
      setBusy("");
    }
  }

  async function suggestWithAi() {
    if (locked || !book?.has_raw_text) return;
    setBusy("suggest");
    setMessage("");
    setError("");
    setSuggestion(null);
    try {
      await persistMeta();
      const payload = await api.suggestBookMetadata(id!, {
        language: suggestLanguage,
      });
      if (!payload.category && !payload.description) {
        setError("AI did not return a usable suggestion. Try again.");
        return;
      }
      setSuggestion({
        category: payload.category,
        description: payload.description,
      });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 503 || err.message === "ai_unavailable")) {
        Alert.alert("Unavailable", "AI suggestions are unavailable.");
        return;
      }
      const body = err instanceof ApiError ? (err.body as { error?: string } | null) : null;
      if (body?.error === "ai_unavailable") {
        Alert.alert("Unavailable", "AI suggestions are unavailable.");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not suggest metadata.");
    } finally {
      setBusy("");
    }
  }

  async function applySuggestion() {
    if (!suggestion) return;
    const nextDescription = suggestion.description ?? description;
    const nextCategoryId = suggestion.category?.id ?? categoryId;
    if (suggestion.description) setDescription(suggestion.description);
    if (suggestion.category?.id) setCategoryId(suggestion.category.id);
    setSuggestion(null);
    try {
      await persistMeta({
        description: nextDescription,
        categoryId: nextCategoryId,
      });
      setMessage("Suggestion applied.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not apply suggestion.");
    }
  }

  async function split() {
    setBusy("split");
    setMessage("");
    setError("");
    try {
      await persistMeta();
      const payload = await api.splitBook(id!, {
        length: splitLength,
        title_components: ["part"],
        title_language: suggestLanguage,
      });
      setMessage(`Created ${payload.chapter_count} segments.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Split failed.");
    } finally {
      setBusy("");
    }
  }

  async function applySegmentTitles() {
    if (locked || chapters.length === 0) return;
    setBusy("titles");
    setMessage("");
    setError("");
    try {
      await persistMeta();
      const payload = await api.nameBookSegments(id!, {
        title_components: titleComponents,
        title_language: suggestLanguage,
      });
      setMessage(
        titleComponents.includes("name")
          ? `Named ${payload.chapter_count} segments.`
          : `Updated ${payload.chapter_count} segment titles.`
      );
      await load();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 503 || err.message === "ai_unavailable")) {
        Alert.alert("Unavailable", "AI naming is unavailable. Try again or turn off Distinctive name.");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not update segment titles.");
    } finally {
      setBusy("");
    }
  }

  async function submit() {
    setBusy("submit");
    setMessage("");
    setError("");
    try {
      await persistMeta();
      await api.submitReview(id!);
      setMessage("Submitted for admin review.");
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.message === "terms_required") {
        router.push(`/legal/accept?action=submit&bookId=${id}`);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Submit failed.");
    } finally {
      setBusy("");
    }
  }

  function confirmDiscard() {
    if (!book || book.status !== "draft") return;
    Alert.alert(
      "Discard draft?",
      "This permanently deletes the manuscript, cover, and chapters. You can’t undo this.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            void discardDraft();
          },
        },
      ]
    );
  }

  async function discardDraft() {
    if (!id) return;
    setBusy("discard");
    setMessage("");
    setError("");
    try {
      await api.discardBook(id);
      router.replace("/publisher");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not discard draft.");
      setBusy("");
    }
  }

  async function replaceCover() {
    if (locked) return;
    const picked = await pickBookCoverImage();
    if (!picked) return;
    setBusy("cover");
    setMessage("");
    setError("");
    setLocalCoverUri(picked.uri);
    try {
      const form = new FormData();
      form.append("file", {
        uri: picked.uri,
        name: picked.name,
        type: picked.mimeType,
      } as unknown as Blob);
      await api.uploadBookCover(id!, form);
      setMessage("Cover updated.");
      await load();
    } catch (err) {
      setLocalCoverUri(null);
      setError(err instanceof ApiError ? err.message : "Cover upload failed.");
    } finally {
      setBusy("");
    }
  }

  async function uploadGlossary() {
    if (locked) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "org.openxmlformats.wordprocessingml.document",
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setBusy("glossary");
    setMessage("");
    setError("");
    try {
      await persistMeta();
      const form = new FormData();
      form.append("file", {
        uri: asset.uri,
        name: asset.name || "glossary.docx",
        type:
          asset.mimeType ||
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      } as unknown as Blob);
      const payload = await api.uploadGlossary(id!, form);
      setMessage(`Imported ${payload.count} character notes.`);
      setGlossaryCount(payload.count);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Glossary upload failed.");
    } finally {
      setBusy("");
    }
  }

  function toggleTitleComponent(component: SegmentTitleComponent) {
    setTitleComponents((prev) => {
      if (prev.includes(component)) {
        if (prev.length <= 1) return prev;
        return prev.filter((item) => item !== component);
      }
      return [...prev, component];
    });
  }

  function moveTitleComponent(component: SegmentTitleComponent, direction: -1 | 1) {
    setTitleComponents((prev) => {
      const index = prev.indexOf(component);
      if (index < 0) return prev;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, item);
      return copy;
    });
  }

  if (!book) {
    return (
      <View style={styles.centered}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.sage} />}
      </View>
    );
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: book.title }} />
      <View style={styles.coverRow}>
        <BookCover
          title={book.title}
          categorySlug={book.category?.slug}
          categoryLabel={book.category?.label}
          coverUrl={
            book.cover_url
              ? api.bookCoverUrl(book.cover_url, { cacheKey: book.updated_at })
              : null
          }
          localUri={localCoverUri}
          width={110}
          height={coverHeightForWidth(110)}
        />
        <View style={styles.coverMeta}>
          <Text style={styles.title}>{book.title}</Text>
          <Text style={styles.sub}>
            {bookStatusLabel(book.status)} · {formatPrice(book.price_cents)}
            {book.category ? ` · ${book.category.label}` : ""}
            {book.source_filename ? ` · ${displayFilename(book.source_filename)}` : ""}
          </Text>
          <Pressable
            style={[styles.secondaryBtn, styles.coverBtn, locked && styles.disabled]}
            onPress={replaceCover}
            disabled={locked || busy === "cover"}
          >
            <Text style={styles.secondaryBtnText}>
              {busy === "cover" ? "Uploading…" : book.cover_url ? "Replace cover" : "Upload cover"}
            </Text>
          </Pressable>
        </View>
      </View>
      {book.status === "rejected" && book.review_note ? (
        <Text style={styles.rejectNote}>Rejected: {book.review_note}</Text>
      ) : null}
      {book.status === "pending_review" ? (
        <Text style={styles.pendingNote}>Waiting for admin review. Editing is locked.</Text>
      ) : null}

      <Text style={styles.section}>Details</Text>
      <TextInput
        style={[styles.input, locked && styles.disabledInput]}
        value={title}
        onChangeText={setTitle}
        editable={!locked}
        placeholder="Title"
        placeholderTextColor={colors.inkSoft}
      />

      {!locked && book.has_raw_text ? (
        <>
          <Text style={styles.hint}>
            Suggest category and description from the manuscript, then Apply.
          </Text>
          <Text style={styles.label}>Suggestion language</Text>
          <View style={styles.pricingRow}>
            {SUGGEST_LANGUAGE_OPTIONS.map((option) => {
              const active = suggestLanguage === option.value;
              return (
                <Pressable
                  key={option.value}
                  style={[styles.choice, active && styles.choiceActive]}
                  onPress={() => setSuggestLanguage(option.value)}
                >
                  <Text style={[styles.choiceText, active && styles.choiceTextActive]}>
                    {option.label}
                  </Text>
                  <Text style={[styles.choiceHint, active && styles.choiceHintActive]}>
                    {option.hint}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            style={[styles.secondaryBtn, styles.suggestBtn, busy === "suggest" && styles.disabled]}
            onPress={() => void suggestWithAi()}
            disabled={busy === "suggest"}
          >
            <Text style={styles.secondaryBtnText}>
              {busy === "suggest" ? "Suggesting…" : "Suggest with AI"}
            </Text>
          </Pressable>
        </>
      ) : null}

      {suggestion ? (
        <View style={styles.suggestCard}>
          <Text style={styles.suggestTitle}>AI suggestion</Text>
          {suggestion.category ? (
            <Text style={styles.suggestLine}>
              Category: <Text style={styles.suggestStrong}>{suggestion.category.label}</Text>
            </Text>
          ) : null}
          {suggestion.description ? (
            <Text style={styles.suggestBlurb}>{suggestion.description}</Text>
          ) : null}
          <View style={styles.suggestActions}>
            <Pressable style={styles.suggestApply} onPress={() => void applySuggestion()}>
              <Text style={styles.suggestApplyText}>Apply</Text>
            </Pressable>
            <Pressable style={styles.suggestDismiss} onPress={() => setSuggestion(null)}>
              <Text style={styles.suggestDismissText}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.multiline, locked && styles.disabledInput]}
        value={description}
        onChangeText={setDescription}
        editable={!locked}
        placeholder="Description / blurb"
        placeholderTextColor={colors.inkSoft}
        multiline
      />

      <Text style={styles.label}>Category</Text>
      <View style={styles.categoryWrap}>
        {categories.map((category) => {
          const active = categoryId === category.id;
          return (
            <Pressable
              key={category.id}
              disabled={locked}
              style={[styles.categoryChip, active && styles.categoryChipActive, locked && styles.disabled]}
              onPress={() => setCategoryId(category.id)}
            >
              <Text style={[styles.categoryText, active && styles.categoryTextActive]}>
                {category.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.pricingRow}>
        <Pressable
          style={[styles.choice, pricing === "free" && styles.choiceActive, locked && styles.disabled]}
          disabled={locked}
          onPress={() => setPricing("free")}
        >
          <Text style={[styles.choiceText, pricing === "free" && styles.choiceTextActive]}>Free</Text>
        </Pressable>
        <Pressable
          style={[styles.choice, pricing === "paid" && styles.choiceActive, locked && styles.disabled]}
          disabled={locked}
          onPress={() => setPricing("paid")}
        >
          <Text style={[styles.choiceText, pricing === "paid" && styles.choiceTextActive]}>Paid</Text>
        </Pressable>
      </View>
      {pricing === "paid" ? (
        <TextInput
          style={[styles.input, locked && styles.disabledInput]}
          value={price}
          onChangeText={setPrice}
          editable={!locked}
          keyboardType="decimal-pad"
          placeholder="4.99"
          placeholderTextColor={colors.inkSoft}
        />
      ) : null}

      <Text style={styles.section}>Series placement</Text>
      <Text style={styles.hint}>
        Each book is one episode. Attach it to a series with season and episode numbers.
      </Text>
      <View style={styles.categoryWrap}>
        <Pressable
          style={[styles.categoryChip, !seriesId && styles.categoryChipActive]}
          onPress={() => setSeriesId("")}
        >
          <Text style={[styles.categoryText, !seriesId && styles.categoryTextActive]}>
            Not in a series
          </Text>
        </Pressable>
        {seriesList.map((item) => {
          const active = seriesId === item.id;
          return (
            <Pressable
              key={item.id}
              style={[styles.categoryChip, active && styles.categoryChipActive]}
              onPress={() => setSeriesId(item.id)}
            >
              <Text style={[styles.categoryText, active && styles.categoryTextActive]}>
                {item.title}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {seriesId ? (
        <View style={styles.pricingRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={seasonNumber}
            onChangeText={setSeasonNumber}
            keyboardType="number-pad"
            placeholder="Season"
            placeholderTextColor={colors.inkSoft}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={episodeNumber}
            onChangeText={setEpisodeNumber}
            keyboardType="number-pad"
            placeholder="Episode"
            placeholderTextColor={colors.inkSoft}
          />
        </View>
      ) : null}
      <Pressable
        style={[styles.secondaryBtn, styles.saveBtn]}
        onPress={() => void saveSeriesPlacement()}
        disabled={busy === "series"}
      >
        <Text style={styles.secondaryBtnText}>
          {busy === "series" ? "Saving…" : "Save series placement"}
        </Text>
      </Pressable>
      <Pressable onPress={() => router.push("/publisher/series-new")}>
        <Text style={styles.link}>Create series</Text>
      </Pressable>

      <Text style={styles.section}>Character notes</Text>
      <Text style={styles.hint}>
        Upload a NHÂN VẬT.docx glossary so readers can long-press names for book notes
        without sending the whole chapter to AI.
      </Text>
      <Text style={styles.sub}>
        {glossaryCount == null
          ? "No glossary loaded yet."
          : `${glossaryCount} character note${glossaryCount === 1 ? "" : "s"} imported.`}
      </Text>
      <Pressable
        style={[styles.secondaryBtn, styles.saveBtn, locked && styles.disabled]}
        onPress={uploadGlossary}
        disabled={locked || busy === "glossary"}
      >
        <Text style={styles.secondaryBtnText}>
          {busy === "glossary"
            ? "Uploading…"
            : glossaryCount
              ? "Replace character notes"
              : "Upload character notes"}
        </Text>
      </Pressable>

      <Text style={styles.section}>Chapters</Text>
      <Text style={styles.hint}>
        Detects chapters and sections, then packs them into comfortable reading segments.
        Pick how long each part should feel.
      </Text>
      <View style={styles.pricingRow}>
        {SPLIT_LENGTH_OPTIONS.map((option) => {
          const active = splitLength === option.value;
          return (
            <Pressable
              key={option.value}
              disabled={locked}
              style={[styles.choice, active && styles.choiceActive, locked && styles.disabled]}
              onPress={() => setSplitLength(option.value)}
            >
              <Text style={[styles.choiceText, active && styles.choiceTextActive]}>
                {option.label}
              </Text>
              <Text style={[styles.choiceHint, active && styles.choiceHintActive]}>
                {option.hint}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        style={[styles.primaryBtn, (!book.has_raw_text || locked) && styles.disabled]}
        onPress={split}
        disabled={!book.has_raw_text || locked || busy === "split"}
      >
        <Text style={styles.primaryBtnText}>
          {busy === "split" ? "Splitting…" : "Auto-split into reading segments"}
        </Text>
      </Pressable>

      <View style={styles.list}>
        {chapters.length === 0 ? (
          <Text style={styles.meta}>No chapters yet.</Text>
        ) : (
          chapters.map((chapter) => (
            <View key={chapter.id} style={styles.row}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {chapter.title}
              </Text>
              <Text style={styles.rowMeta}>{chapter.word_count} words</Text>
            </View>
          ))
        )}
      </View>

      {chapters.length > 0 ? (
        <>
          <Text style={styles.section}>Segment titles</Text>
          <Text style={styles.hint}>
            After splitting, choose the title layout. Distinctive names use AI when available.
          </Text>
          <Text style={styles.label}>Title language</Text>
          <View style={styles.pricingRow}>
            {SUGGEST_LANGUAGE_OPTIONS.map((option) => {
              const active = suggestLanguage === option.value;
              return (
                <Pressable
                  key={option.value}
                  disabled={locked}
                  style={[styles.choice, active && styles.choiceActive, locked && styles.disabled]}
                  onPress={() => setSuggestLanguage(option.value)}
                >
                  <Text style={[styles.choiceText, active && styles.choiceTextActive]}>
                    {option.label}
                  </Text>
                  <Text style={[styles.choiceHint, active && styles.choiceHintActive]}>
                    {option.hint}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.previewLine}>
            Preview:{" "}
            {formatSegmentTitlePreview(titleComponents, {
              bookTitle: title || book.title,
              language: suggestLanguage,
            })}
          </Text>
          <View style={styles.formatList}>
            {titleComponents.map((component, index) => {
              const meta = SEGMENT_TITLE_COMPONENT_OPTIONS.find(
                (item) => item.value === component
              );
              return (
                <View key={component} style={styles.formatRow}>
                  <Pressable
                    style={[styles.formatToggle, styles.formatToggleOn]}
                    disabled={locked}
                    onPress={() => toggleTitleComponent(component)}
                  >
                    <Text style={styles.formatToggleTextOn}>✓</Text>
                  </Pressable>
                  <View style={styles.formatMeta}>
                    <Text style={styles.formatTitle}>{meta?.label ?? component}</Text>
                    <Text style={styles.formatHint}>{meta?.hint}</Text>
                  </View>
                  <View style={styles.formatMove}>
                    <Pressable
                      style={[styles.moveBtn, (locked || index === 0) && styles.disabled]}
                      disabled={locked || index === 0}
                      onPress={() => moveTitleComponent(component, -1)}
                    >
                      <Text style={styles.moveBtnText}>↑</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.moveBtn,
                        (locked || index === titleComponents.length - 1) && styles.disabled,
                      ]}
                      disabled={locked || index === titleComponents.length - 1}
                      onPress={() => moveTitleComponent(component, 1)}
                    >
                      <Text style={styles.moveBtnText}>↓</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
            {SEGMENT_TITLE_COMPONENT_OPTIONS.filter(
              (option) => !titleComponents.includes(option.value)
            ).map((option) => (
              <View key={option.value} style={styles.formatRow}>
                <Pressable
                  style={styles.formatToggle}
                  disabled={locked}
                  onPress={() => toggleTitleComponent(option.value)}
                >
                  <Text style={styles.formatToggleText}>+</Text>
                </Pressable>
                <View style={styles.formatMeta}>
                  <Text style={styles.formatTitleMuted}>{option.label}</Text>
                  <Text style={styles.formatHint}>{option.hint} · off</Text>
                </View>
              </View>
            ))}
          </View>
          <Pressable
            style={[styles.primaryBtn, locked && styles.disabled]}
            onPress={() => void applySegmentTitles()}
            disabled={locked || busy === "titles"}
          >
            <Text style={styles.primaryBtnText}>
              {busy === "titles"
                ? "Updating titles…"
                : titleComponents.includes("name")
                  ? "Name segments with AI"
                  : "Apply titles"}
            </Text>
          </Pressable>
        </>
      ) : null}

      <View style={styles.publishRow}>
        <Pressable
          style={[
            styles.publishBtn,
            (chapters.length === 0 || locked || !categoryId) && styles.disabled,
          ]}
          onPress={submit}
          disabled={chapters.length === 0 || locked || !categoryId || busy === "submit"}
        >
          <Text style={styles.publishBtnText}>
            {busy === "submit"
              ? "Submitting…"
              : book.status === "rejected"
                ? "Resubmit for review"
                : "Submit for review"}
          </Text>
        </Pressable>
        {book.status === "draft" ? (
          <Pressable
            style={[styles.discardBtn, busy === "discard" && styles.disabled]}
            onPress={confirmDiscard}
            disabled={busy === "discard"}
          >
            <Text style={styles.discardBtnText}>
              {busy === "discard" ? "Discarding…" : "Discard draft"}
            </Text>
          </Pressable>
        ) : null}
        {book.status === "published" && chapters[0] ? (
          <Pressable
            style={styles.secondaryBtn}
            onPress={() => router.push(`/read/${book.id}/${chapters[0].id}`)}
          >
            <Text style={styles.secondaryBtnText}>Open reader</Text>
          </Pressable>
        ) : null}
      </View>

      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormScroll>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 8, paddingBottom: 60 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.mist },
  coverRow: { flexDirection: "row", gap: 14, alignItems: "flex-start", marginTop: 4 },
  coverMeta: { flex: 1, gap: 8 },
  coverBtn: { alignSelf: "flex-start", marginTop: 4 },
  title: { fontSize: 24, fontWeight: "700", color: colors.ink },
  sub: { color: colors.inkSoft, marginTop: 2 },
  rejectNote: {
    marginTop: 8,
    color: colors.danger,
    backgroundColor: "rgba(155,28,28,0.08)",
    padding: 12,
    borderRadius: 10,
  },
  pendingNote: {
    marginTop: 8,
    color: colors.sageDeep,
    backgroundColor: "rgba(63,111,92,0.1)",
    padding: 12,
    borderRadius: 10,
  },
  section: {
    marginTop: 20,
    fontSize: 12,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: colors.inkSoft,
    fontWeight: "600",
  },
  label: {
    marginTop: 8,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.inkSoft,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,0.85)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: colors.ink,
    marginTop: 6,
  },
  disabledInput: { opacity: 0.6 },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  categoryWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  categoryChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  categoryChipActive: { backgroundColor: colors.sage, borderColor: colors.sage },
  categoryText: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  categoryTextActive: { color: "#fff" },
  suggestBtn: { marginTop: 10, alignSelf: "flex-start" },
  suggestCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.card,
    padding: 14,
    gap: 8,
  },
  suggestTitle: { color: colors.ink, fontWeight: "700", fontSize: 14 },
  suggestLine: { color: colors.inkSoft, fontSize: 13 },
  suggestStrong: { color: colors.ink, fontWeight: "700" },
  suggestBlurb: { color: colors.ink, fontSize: 14, lineHeight: 20 },
  suggestActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  suggestApply: {
    backgroundColor: colors.sage,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  suggestApplyText: { color: "#fff", fontWeight: "700" },
  suggestDismiss: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  suggestDismissText: { color: colors.inkSoft, fontWeight: "600" },
  pricingRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  choice: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  choiceActive: { backgroundColor: colors.sage, borderColor: colors.sage },
  choiceText: { color: colors.ink, fontWeight: "600" },
  choiceTextActive: { color: "#fff" },
  choiceHint: { color: colors.inkSoft, fontSize: 11, marginTop: 2 },
  choiceHintActive: { color: "rgba(255,255,255,0.85)" },
  hint: { color: colors.inkSoft, fontSize: 13, marginTop: 6 },
  link: {
    color: colors.sage,
    fontSize: 14,
    fontWeight: "600",
    marginTop: 10,
    textDecorationLine: "underline",
  },
  primaryBtn: {
    marginTop: 12,
    backgroundColor: colors.sage,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  saveBtn: { marginTop: 12 },
  secondaryBtnText: { color: colors.ink, fontWeight: "600" },
  list: {
    marginTop: 12,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowTitle: { color: colors.ink, flex: 1 },
  rowMeta: { color: colors.inkSoft, fontSize: 13 },
  meta: { color: colors.inkSoft, padding: 14 },
  publishRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16, alignItems: "center" },
  publishBtn: {
    backgroundColor: colors.ink,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  publishBtnText: { color: colors.paper, fontWeight: "600" },
  discardBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    backgroundColor: "rgba(155,28,28,0.06)",
  },
  discardBtnText: { color: colors.danger, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  success: { color: colors.sageDeep, marginTop: 12 },
  error: { color: colors.danger, marginTop: 12 },
  previewLine: { color: colors.ink, fontSize: 14, marginTop: 8, lineHeight: 20 },
  formatList: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  formatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  formatToggle: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  formatToggleOn: { backgroundColor: colors.sage, borderColor: colors.sage },
  formatToggleText: { color: colors.inkSoft, fontWeight: "700" },
  formatToggleTextOn: { color: "#fff", fontWeight: "700" },
  formatMeta: { flex: 1, gap: 2 },
  formatTitle: { color: colors.ink, fontWeight: "600" },
  formatTitleMuted: { color: colors.inkSoft, fontWeight: "600" },
  formatHint: { color: colors.inkSoft, fontSize: 12 },
  formatMove: { flexDirection: "row", gap: 4 },
  moveBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  moveBtnText: { color: colors.ink, fontWeight: "700", fontSize: 14 },
});
