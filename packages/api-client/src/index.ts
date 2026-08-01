export type UserRole = "reader" | "publisher" | "admin";

export type BookStatus = "draft" | "pending_review" | "published" | "rejected";
export type BookVisibility = "listed" | "hidden" | "removed";
export type ReportReason = "copyright" | "inappropriate" | "spam" | "misleading" | "other";
export type ReportStatus = "open" | "resolved" | "dismissed";

export type SplitLength = "short" | "standard" | "long";
export type SuggestLanguage = "en" | "vi" | "bilingual";
export type SegmentTitleComponent = "book" | "name" | "part";

export const SPLIT_LENGTH_OPTIONS: Array<{
  value: SplitLength;
  label: string;
  hint: string;
}> = [
  { value: "short", label: "Short", hint: "~5–8 min" },
  { value: "standard", label: "Standard", hint: "~10–15 min" },
  { value: "long", label: "Long", hint: "~20–25 min" },
];

export const SUGGEST_LANGUAGE_OPTIONS: Array<{
  value: SuggestLanguage;
  label: string;
  hint: string;
}> = [
  { value: "en", label: "English", hint: "EN" },
  { value: "vi", label: "Tiếng Việt", hint: "VI" },
  { value: "bilingual", label: "Bilingual", hint: "EN + VI" },
];

export const SEGMENT_TITLE_COMPONENT_OPTIONS: Array<{
  value: SegmentTitleComponent;
  label: string;
  hint: string;
}> = [
  { value: "book", label: "Book title", hint: "Optional" },
  { value: "name", label: "Distinctive name", hint: "AI" },
  { value: "part", label: "Part", hint: "1, 2, 3…" },
];

export const DEFAULT_SEGMENT_TITLE_COMPONENTS: SegmentTitleComponent[] = [
  "name",
  "part",
];

export function formatSegmentTitlePreview(
  components: SegmentTitleComponent[],
  options?: {
    bookTitle?: string;
    distinctiveName?: string;
    partIndex?: number;
    language?: SuggestLanguage;
  }
): string {
  const bookTitle = (options?.bookTitle || "").trim();
  const name = (options?.distinctiveName || "Storm Rising").trim();
  const partIndex = options?.partIndex ?? 1;
  const language = options?.language ?? "en";
  const part =
    language === "vi" || language === "bilingual"
      ? `Phần ${partIndex}`
      : `Part ${partIndex}`;
  const pieces: string[] = [];
  for (const component of components) {
    if (component === "book" && bookTitle) pieces.push(bookTitle);
    if (component === "name" && name) pieces.push(name);
    if (component === "part") pieces.push(part);
  }
  return pieces.join(" · ") || part;
}

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;
export const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

const RESERVED_HANDLES = new Set([
  "about",
  "admin",
  "api",
  "assets",
  "books",
  "claim-handle",
  "health",
  "help",
  "legal",
  "login",
  "me",
  "null",
  "publisher",
  "read",
  "settings",
  "static",
  "support",
  "undefined",
  "www",
]);

export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export function validateHandleInput(raw: string): string | null {
  const handle = normalizeHandle(raw);
  if (!HANDLE_PATTERN.test(handle)) {
    return `Handle must be ${HANDLE_MIN_LENGTH}–${HANDLE_MAX_LENGTH} characters using lowercase letters, numbers, or underscores.`;
  }
  if (RESERVED_HANDLES.has(handle)) {
    return "That handle is reserved.";
  }
  return null;
}

export function profilePath(handle: string): string {
  return `/@${normalizeHandle(handle)}`;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  handle?: string | null;
  role: UserRole;
  accepted_legal_version?: string | null;
  accepted_legal_at?: string | null;
  current_legal_version?: string;
  needs_legal_acceptance?: boolean;
}

export interface Category {
  id: string;
  slug: string;
  label: string;
}

export interface SeriesRef {
  id: string;
  title: string;
}

export interface SeriesListItem {
  id: string;
  title: string;
  description: string;
  publisher_id: string;
  publisher_name?: string | null;
  publisher_handle?: string | null;
  episode_count: number;
  visibility?: "listed" | "hidden";
  cover_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookListItem {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  status: BookStatus;
  featured?: boolean;
  featured_at?: string | null;
  visibility?: BookVisibility;
  visibility_note?: string | null;
  report_count?: number;
  publisher_name?: string;
  publisher_handle?: string | null;
  publisher_id?: string;
  source_filename?: string | null;
  chapter_count: number;
  created_at: string;
  updated_at?: string;
  category?: Category | null;
  review_note?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  cover_url?: string | null;
  cast_status?: "draft" | "ready";
  series?: SeriesRef | null;
  season_number?: number | null;
  episode_number?: number | null;
}

export interface SeriesSeason {
  season_number: number;
  episodes: BookListItem[];
}

export interface ChapterListItem {
  id: string;
  position: number;
  title: string;
  word_count: number;
  group_index: number;
  locked?: boolean;
  content_preview?: string;
}

export interface ReadingProgress {
  chapter_id: string;
  paragraph_index: number;
  scroll_fraction: number;
  updated_at?: string;
  completed_at?: string | null;
}

export interface ReadingShelfItem {
  book: BookListItem;
  progress: ReadingProgress & {
    chapter_title: string;
    chapter_position: number;
    chapter_count: number;
  };
}

export interface SeriesContinueItem {
  series: SeriesRef | null;
  episode_code: string | null;
  book: BookListItem;
  owned: boolean;
}

export function formatEpisodeCode(
  seasonNumber?: number | null,
  episodeNumber?: number | null
): string | null {
  if (seasonNumber == null || episodeNumber == null) return null;
  return `S${seasonNumber}E${episodeNumber}`;
}

export interface ChapterAudioSegment {
  index: number;
  paragraph_index: number;
  kind?: "narration" | "dialogue";
  speaker?: string | null;
  voice?: string;
  url: string;
}

export interface ChapterAudioManifest {
  engine?: string;
  gender?: string;
  voice: string;
  cache_hit: boolean;
  segments: ChapterAudioSegment[];
}

export interface TtsActiveSettings {
  engine: string;
  gender: string;
  chirp_persona: string;
  voice_override: string;
  voice: string;
  enabled: boolean;
  source?: string;
  narrator_rate?: number;
  narrator_pitch?: number;
  dialogue_rate?: number;
  dialogue_pitch?: number;
  break_start_ms?: number;
  break_end_ms?: number;
  speak_speaker_names?: boolean;
  speak_stage_directions?: boolean;
  max_character_voices?: number;
}

export interface TtsSettingsPayload {
  engines: Array<{ id: string; label: string }>;
  genders: string[];
  age_bands?: string[];
  presences?: string[];
  chirp3_personas: { male: string[]; female: string[] };
  cast_personas?: { male: string[]; female: string[] };
  voices: Array<{
    engine: string;
    engine_label: string;
    gender: string;
    voice: string;
  }>;
  defaults?: {
    narrator_rate: number;
    narrator_pitch: number;
    dialogue_rate: number;
    dialogue_pitch: number;
    break_start_ms: number;
    break_end_ms: number;
    max_character_voices: number;
  };
  active: TtsActiveSettings;
}

export interface BookCastEntry {
  id: string | null;
  speaker_key: string;
  speaker_cue?: string;
  name: string;
  aliases: string[];
  episode_key: string;
  group_label: string;
  summary: string;
  gender: "male" | "female" | null;
  age_band: "youth" | "adult" | "elder" | null;
  presence: "soft" | "neutral" | "forceful" | null;
  tts_voice: string | null;
  cast_locked: boolean;
  matched?: boolean;
  line_count?: number;
  first_chapter_id?: string;
  first_chapter_title?: string;
  first_chapter_position?: number;
  source?: "speaking" | "glossary_only" | "unmatched";
}

export interface BookCastImportSource {
  id: string;
  title: string;
  season_number: number | null;
  episode_number: number | null;
  cast_status: "draft" | "ready" | string;
}

export interface BookCastPayload {
  book_id: string;
  book_title: string;
  engine: string;
  narrator_voice: string;
  cast_status?: "draft" | "ready";
  scope?: "speaking" | "all";
  speaking_count?: number;
  glossary_count?: number;
  unmatched_count?: number;
  warnings?: string[];
  cast_personas: { male: string[]; female: string[] };
  voices: Array<{
    engine: string;
    engine_label: string;
    gender: string;
    voice: string;
  }>;
  entries: BookCastEntry[];
  series_id?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
  import_sources?: BookCastImportSource[];
}

export interface GlossaryEntryCompact {
  id: string;
  name: string;
  aliases: string[];
  episode_key: string;
  group_label: string;
  summary?: string;
  episode_title?: string;
}

export interface ExplainCandidate {
  id: string;
  name: string;
  episode_key: string;
  group_label: string;
  score?: number;
}

export interface ExplainCard {
  title: string;
  book_note: string;
  ai_context: string;
  sources: Array<"book" | "ai" | string>;
  followups: string[];
  glossary_entry: GlossaryEntryCompact | null;
}

export interface ExplainResponse {
  status: "ok" | "candidates";
  query: string;
  candidates: ExplainCandidate[];
  card: ExplainCard | null;
  cache_hit: boolean;
  ai_used: boolean;
}

export interface BookDetail {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  status: BookStatus;
  featured?: boolean;
  featured_at?: string | null;
  visibility?: BookVisibility;
  visibility_note?: string | null;
  report_count?: number;
  allowed_actions?: string[];
  publisher_name: string;
  publisher_handle?: string | null;
  publisher_id: string;
  source_filename: string | null;
  created_at: string;
  updated_at: string;
  has_raw_text: boolean;
  category?: Category | null;
  review_note?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  cover_url?: string | null;
  cast_status?: "draft" | "ready";
  series?: SeriesRef | null;
  season_number?: number | null;
  episode_number?: number | null;
  next_episode?: BookListItem | null;
}

export interface PublicProfile {
  id: string;
  name: string;
  handle: string;
  role: UserRole;
}

export interface ModerationEvent {
  id: string;
  action: string;
  actor_id?: string | null;
  from_status?: BookStatus | null;
  to_status?: BookStatus | null;
  from_visibility?: BookVisibility | null;
  to_visibility?: BookVisibility | null;
  note?: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ContentReport {
  id: string;
  book_id: string;
  book_title: string;
  book_visibility: BookVisibility;
  reporter_user_id?: string | null;
  reporter_name: string;
  reporter_email: string;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  created_at: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_note?: string | null;
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  fetch?: typeof fetch;
}

export interface InlineMarkdownToken {
  text: string;
  bold: boolean;
  italic: boolean;
}

export type ContentBlock =
  | { type: "text"; value: string }
  | { type: "figure"; src: string; caption: string };

function isEscaped(value: string, index: number) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && value[i] === "\\"; i -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function findClosingMarker(value: string, marker: string, start: number) {
  let index = value.indexOf(marker, start);
  while (index >= 0) {
    if (!isEscaped(value, index)) return index;
    index = value.indexOf(marker, index + marker.length);
  }
  return -1;
}

function unescapeInlineMarkdown(value: string) {
  return value.replace(/\\([\\*])/g, "$1");
}

function unescapeCaption(value: string) {
  return value.replace(/\\([\\\[\]])/g, "$1");
}

const FIGURE_BLOCK = /^!\[((?:\\.|[^\]])*)\]\(([^)\s]+)\)$/;

/** Word/DOCX often stores the asset filename as drawing name; hide those as captions. */
export function isFilenameLikeCaption(caption: string): boolean {
  const value = caption.trim();
  if (!value) return true;
  if (/\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(value)) return true;
  if (/^(?:picture|image|photo|img|hình(?:\s*ảnh)?|ảnh)[\s._-]?\d*$/i.test(value)) {
    return true;
  }
  return false;
}

/**
 * Split chapter content into text paragraphs and figure blocks.
 * Figures are emitted by the DOCX importer as `![caption](/api/books/.../media/....jpg)`.
 */
export function parseContentBlocks(content: string): ContentBlock[] {
  return content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map((paragraph) => {
      const match = FIGURE_BLOCK.exec(paragraph);
      if (match) {
        const raw = unescapeCaption(match[1] ?? "");
        return {
          type: "figure" as const,
          caption: isFilenameLikeCaption(raw) ? "" : raw,
          src: match[2] ?? "",
        };
      }
      return { type: "text" as const, value: paragraph };
    });
}

/**
 * Parse the deliberately small Markdown subset emitted by the DOCX importer:
 * `**bold**`, `*italic*`, and `***bold italic***`.
 */
export function parseInlineMarkdown(value: string): InlineMarkdownToken[] {
  const tokens: InlineMarkdownToken[] = [];
  let plain = "";

  function push(text: string, bold: boolean, italic: boolean) {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.bold === bold && last.italic === italic) {
      last.text += text;
      return;
    }
    tokens.push({ text, bold, italic });
  }

  function flushPlain() {
    if (!plain) return;
    push(unescapeInlineMarkdown(plain), false, false);
    plain = "";
  }

  for (let index = 0; index < value.length; ) {
    if (value[index] === "\\" && index + 1 < value.length) {
      plain += value[index + 1];
      index += 2;
      continue;
    }

    let marker: string | null = null;
    if (value.startsWith("***", index)) marker = "***";
    else if (value.startsWith("**", index)) marker = "**";
    else if (value[index] === "*") marker = "*";

    if (!marker) {
      plain += value[index];
      index += 1;
      continue;
    }

    const closing = findClosingMarker(value, marker, index + marker.length);
    if (closing < 0) {
      plain += marker;
      index += marker.length;
      continue;
    }

    flushPlain();
    const text = unescapeInlineMarkdown(value.slice(index + marker.length, closing));
    push(text, marker.length >= 2, marker.length === 1 || marker.length === 3);
    index = closing + marker.length;
  }

  flushPlain();
  return tokens;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const token = await options.getToken?.();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await doFetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    }).catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : "network error";
      throw new ApiError(
        `Cannot reach API at ${baseUrl} (${detail}). Check Wi‑Fi and EXPO_PUBLIC_API_URL.`,
        0,
        null
      );
    });

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new ApiError(
          `Request failed (${response.status}): non-JSON response from ${baseUrl}${path}`,
          response.status,
          text
        );
      }
    }

    if (!response.ok) {
      const message =
        data && typeof data === "object" && data !== null && "error" in data
          ? String((data as { error: string }).error)
          : `Request failed (${response.status})`;
      throw new ApiError(message, response.status, data);
    }

    return data as T;
  }

  return {
    /** Local/dev stand-in for Firebase email auth when the API has AUTH_DEV_MODE. */
    login(email: string, password: string, name?: string) {
      return request<{ user: SessionUser; token: string }>("/api/auth/dev-login", {
        method: "POST",
        body: JSON.stringify({ email, password, name }),
      });
    },
    logout() {
      return request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
    },
    me() {
      return request<{ user: SessionUser | null }>("/api/auth/me");
    },
    enableAuthor(enabled = true) {
      return request<{ user: SessionUser }>("/api/auth/enable-author", {
        method: "POST",
        body: JSON.stringify({ enabled }),
      });
    },
    acceptLegal(version: string) {
      return request<{ ok: boolean; user: SessionUser }>("/api/auth/accept-legal", {
        method: "POST",
        body: JSON.stringify({ version }),
      });
    },
    claimHandle(handle: string) {
      return request<{ ok: boolean; user: SessionUser }>("/api/auth/claim-handle", {
        method: "POST",
        body: JSON.stringify({ handle }),
      });
    },
    getProfile(handle: string) {
      const normalized = handle.replace(/^@/, "");
      return request<{ profile: PublicProfile; books: BookListItem[] }>(
        `/api/profiles/${encodeURIComponent(normalized)}`
      );
    },
    listCategories() {
      return request<{ categories: Category[] }>("/api/books/categories/list");
    },
    listBooks(options?: { mine?: boolean; category?: string }) {
      const params = new URLSearchParams();
      if (options?.mine) params.set("mine", "1");
      if (options?.category) params.set("category", options.category);
      const q = params.toString();
      return request<{ books: BookListItem[] }>(`/api/books${q ? `?${q}` : ""}`);
    },
    getBook(id: string) {
      return request<{
        book: BookDetail;
        chapters: ChapterListItem[];
        access: {
          owned: boolean;
          isPublisherOwner: boolean;
          previewChapterId: string | null;
          progress?: ReadingProgress | null;
        };
      }>(`/api/books/${id}`);
    },
    getBookRecommendations(id: string) {
      return request<{
        next_episode: BookListItem | null;
        next_episode_owned: boolean | null;
        same_author: BookListItem[];
        related: BookListItem[];
      }>(`/api/books/${id}/recommendations`);
    },
    listSeries(params?: { mine?: boolean; all?: boolean }) {
      const q = new URLSearchParams();
      if (params?.mine) q.set("mine", "1");
      if (params?.all) q.set("all", "1");
      const qs = q.toString();
      return request<{ series: SeriesListItem[] }>(`/api/series${qs ? `?${qs}` : ""}`);
    },
    getSeries(id: string) {
      return request<{
        series: SeriesListItem;
        seasons: SeriesSeason[];
      }>(`/api/series/${id}`);
    },
    createSeries(body: { title: string; description?: string }) {
      return request<{ series: SeriesListItem }>("/api/series", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    updateSeries(
      id: string,
      body: {
        title?: string;
        description?: string;
        visibility?: "listed" | "hidden";
      }
    ) {
      return request<{ ok: boolean; series: SeriesListItem }>(`/api/series/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    deleteSeries(id: string) {
      return request<{ ok: boolean; cleared_episodes: number }>(`/api/series/${id}`, {
        method: "DELETE",
      });
    },
    uploadSeriesCover(id: string, form: FormData) {
      return request<{ ok: boolean; cover_url: string }>(`/api/series/${id}/cover`, {
        method: "POST",
        body: form,
      });
    },
    listReading() {
      return request<{ items: ReadingShelfItem[]; series_continue: SeriesContinueItem[] }>(
        "/api/reading"
      );
    },
    createBook(form: FormData) {
      return request<{ id: string; cover_url?: string | null }>("/api/books", {
        method: "POST",
        body: form,
      });
    },
    uploadBookCover(id: string, form: FormData) {
      return request<{ ok: boolean; cover_url: string }>(`/api/books/${id}/cover`, {
        method: "POST",
        body: form,
      });
    },
    bookCoverUrl(
      coverUrl: string | null | undefined,
      options?: { cacheKey?: string | number | null }
    ) {
      if (!coverUrl) return null;
      const absolute =
        coverUrl.startsWith("http://") || coverUrl.startsWith("https://")
          ? coverUrl
          : `${baseUrl}${coverUrl}`;
      if (options?.cacheKey == null || options.cacheKey === "") return absolute;
      const sep = absolute.includes("?") ? "&" : "?";
      return `${absolute}${sep}v=${encodeURIComponent(String(options.cacheKey))}`;
    },
    /** Resolve a relative or absolute manuscript figure URL against the API base. */
    mediaUrl(src: string | null | undefined) {
      if (!src) return null;
      if (src.startsWith("http://") || src.startsWith("https://")) return src;
      return `${baseUrl}${src.startsWith("/") ? src : `/${src}`}`;
    },
    updateBook(
      id: string,
      body: {
        title?: string;
        description?: string;
        pricing?: "free" | "paid";
        price?: number;
        category_id?: string;
        series_id?: string;
        season_number?: number;
        episode_number?: number;
        clear_series?: boolean;
      }
    ) {
      return request<{ ok: boolean; status?: BookStatus }>(`/api/books/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    discardBook(id: string) {
      return request<{ ok: boolean }>(`/api/books/${id}`, {
        method: "DELETE",
      });
    },
    suggestBookMetadata(
      id: string,
      options?: {
        fields?: Array<"category" | "description">;
        language?: SuggestLanguage;
      }
    ) {
      return request<{
        category: Category | null;
        description: string | null;
        ai_used: boolean;
      }>(`/api/books/${id}/suggest-metadata`, {
        method: "POST",
        body: JSON.stringify({
          fields: options?.fields,
          language: options?.language ?? "en",
        }),
      });
    },
    splitBook(
      id: string,
      options?: {
        length?: SplitLength;
        title_components?: SegmentTitleComponent[];
        title_language?: SuggestLanguage;
      }
    ) {
      return request<{ ok: boolean; chapter_count: number }>(`/api/books/${id}/split`, {
        method: "POST",
        body: JSON.stringify({
          length: options?.length ?? "standard",
          title_components: options?.title_components,
          title_language: options?.title_language ?? "en",
        }),
      });
    },
    nameBookSegments(
      id: string,
      options?: {
        title_components?: SegmentTitleComponent[];
        title_language?: SuggestLanguage;
      }
    ) {
      return request<{ ok: boolean; chapter_count: number }>(
        `/api/books/${id}/segment-titles`,
        {
          method: "POST",
          body: JSON.stringify({
            title_components: options?.title_components ?? ["part"],
            title_language: options?.title_language ?? "en",
          }),
        }
      );
    },
    submitReview(id: string) {
      return request<{ ok: boolean; status: BookStatus }>(`/api/books/${id}/submit-review`, {
        method: "POST",
      });
    },
    /** @deprecated Prefer submitReview — kept as an alias for older clients. */
    publishBook(id: string) {
      return request<{ ok: boolean; status: BookStatus }>(`/api/books/${id}/publish`, {
        method: "POST",
      });
    },
    purchaseBook(id: string) {
      return request<{
        ok: boolean;
        mock?: boolean;
        alreadyOwned?: boolean;
        amount_cents?: number;
      }>(`/api/books/${id}/purchase`, { method: "POST" });
    },
    reportBook(id: string, body: { reason: ReportReason; details?: string }) {
      return request<{ ok: boolean; report_id: string }>(`/api/books/${id}/report`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    getChapter(bookId: string, chapterId: string) {
      return request<{
        book: {
          id: string;
          title: string;
          price_cents: number;
          publisher_name: string;
        };
        chapter: {
          id: string;
          position: number;
          title: string;
          content: string;
          word_count: number;
        };
        chapters: ChapterListItem[];
        progress?: ReadingProgress | null;
      }>(`/api/books/${bookId}/chapters/${chapterId}`);
    },
    saveReadingProgress(
      bookId: string,
      body: {
        chapter_id: string;
        paragraph_index?: number;
        scroll_fraction?: number;
        completed?: boolean;
      }
    ) {
      return request<{ ok: boolean; progress: ReadingProgress }>(
        `/api/books/${bookId}/progress`,
        {
          method: "PUT",
          body: JSON.stringify(body),
        }
      );
    },
    listGlossary(bookId: string, options?: { episode?: string; compact?: boolean }) {
      const params = new URLSearchParams();
      if (options?.episode) params.set("episode", options.episode);
      if (options?.compact === false) params.set("compact", "false");
      const q = params.toString();
      return request<{ count: number; entries: GlossaryEntryCompact[] }>(
        `/api/books/${bookId}/glossary${q ? `?${q}` : ""}`
      );
    },
    uploadGlossary(bookId: string, form: FormData) {
      return request<{ ok: boolean; count: number; episodes: string[] }>(
        `/api/books/${bookId}/glossary`,
        { method: "POST", body: form }
      );
    },
    explainChapter(
      bookId: string,
      chapterId: string,
      body: {
        query?: string;
        paragraph_index?: number;
        entry_id?: string;
        need_context?: boolean;
      }
    ) {
      return request<ExplainResponse>(`/api/books/${bookId}/chapters/${chapterId}/explain`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    async prepareChapterAudio(bookId: string, chapterId: string) {
      const manifest = await request<ChapterAudioManifest>(
        `/api/books/${bookId}/chapters/${chapterId}/audio`,
        { method: "POST" }
      );
      return {
        ...manifest,
        segments: manifest.segments.map((segment) => ({
          ...segment,
          url: `${baseUrl}${segment.url}`,
        })),
      };
    },
    adminQueue() {
      return request<{ books: BookListItem[] }>("/api/admin/queue");
    },
    adminSummary() {
      return request<{
        pending_count: number;
        library_count: number;
        report_count: number;
        series_count: number;
        library_counts: {
          listed: number;
          featured: number;
          rejected: number;
          hidden: number;
          removed: number;
        };
        report_counts: {
          open: number;
          resolved: number;
          dismissed: number;
        };
      }>("/api/admin/summary");
    },
    adminListBooks(options?: {
      status?: BookStatus;
      visibility?: BookVisibility;
      featured?: boolean;
      q?: string;
    }) {
      const params = new URLSearchParams();
      if (options?.status) params.set("status", options.status);
      if (options?.visibility) params.set("visibility", options.visibility);
      if (options?.featured !== undefined) params.set("featured", options.featured ? "1" : "0");
      if (options?.q) params.set("q", options.q);
      const query = params.toString();
      return request<{ books: BookListItem[] }>(
        `/api/admin/books${query ? `?${query}` : ""}`
      );
    },
    adminBook(id: string) {
      return request<{
        book: BookDetail & { publisher_name: string };
        chapters: ChapterListItem[];
        moderation_history: ModerationEvent[];
      }>(`/api/admin/books/${id}`);
    },
    adminUpdateBook(
      id: string,
      body: {
        title?: string;
        description?: string;
        pricing?: "free" | "paid";
        price?: number;
        category_id?: string;
        series_id?: string;
        season_number?: number;
        episode_number?: number;
        clear_series?: boolean;
      }
    ) {
      return request<{
        ok: boolean;
        book: {
          id: string;
          title: string;
          description: string;
          price_cents: number;
          status: BookStatus;
          visibility: BookVisibility;
          featured: boolean;
          category?: Category | null;
          cover_url?: string | null;
          updated_at: string;
          series?: SeriesRef | null;
          season_number?: number | null;
          episode_number?: number | null;
        };
      }>(`/api/admin/books/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    adminUploadBookCover(id: string, form: FormData) {
      return request<{ ok: boolean; cover_url: string }>(`/api/admin/books/${id}/cover`, {
        method: "POST",
        body: form,
      });
    },
    adminApprove(id: string, featured = false) {
      return request<{
        ok: boolean;
        status: BookStatus;
        visibility: BookVisibility;
        featured: boolean;
        cast_status?: "draft" | "ready";
        warnings?: string[];
      }>(`/api/admin/books/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ featured }),
      });
    },
    adminReject(id: string, note: string) {
      return request<{ ok: boolean; status: BookStatus; review_note: string }>(
        `/api/admin/books/${id}/reject`,
        {
          method: "POST",
          body: JSON.stringify({ note }),
        }
      );
    },
    adminSetFeatured(id: string, featured: boolean) {
      return request<{ ok: boolean; featured: boolean }>(`/api/admin/books/${id}/feature`, {
        method: "POST",
        body: JSON.stringify({ featured }),
      });
    },
    adminSetVisibility(id: string, visibility: BookVisibility, note = "") {
      return request<{ ok: boolean; visibility: BookVisibility; featured: boolean }>(
        `/api/admin/books/${id}/visibility`,
        {
          method: "POST",
          body: JSON.stringify({ visibility, note }),
        }
      );
    },
    adminReports(status: ReportStatus = "open") {
      return request<{ reports: ContentReport[] }>(`/api/admin/reports?status=${status}`);
    },
    adminResolveReport(
      id: string,
      action: "resolve" | "dismiss" | "hide",
      note = ""
    ) {
      return request<{
        ok: boolean;
        status: ReportStatus;
        book_visibility: BookVisibility;
      }>(`/api/admin/reports/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ action, note }),
      });
    },
    adminGetTtsSettings() {
      return request<TtsSettingsPayload>("/api/admin/settings/tts");
    },
    adminUpdateTtsSettings(body: {
      engine: string;
      gender: string;
      chirp_persona?: string;
      narrator_rate?: number;
      narrator_pitch?: number;
      dialogue_rate?: number;
      dialogue_pitch?: number;
      break_start_ms?: number;
      break_end_ms?: number;
      speak_speaker_names?: boolean;
      speak_stage_directions?: boolean;
      max_character_voices?: number;
    }) {
      return request<{ ok: boolean; active: TtsActiveSettings }>("/api/admin/settings/tts", {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
    adminGetBookCast(bookId: string, scope: "speaking" | "all" = "speaking") {
      return request<BookCastPayload>(`/api/admin/books/${bookId}/cast?scope=${scope}`);
    },
    adminUpdateBookCast(
      bookId: string,
      entries: Array<{
        id?: string | null;
        speaker_key?: string | null;
        gender: "male" | "female";
        age_band: "youth" | "adult" | "elder";
        presence: "soft" | "neutral" | "forceful";
        tts_voice: string;
        cast_locked?: boolean;
      }>
    ) {
      return request<{ ok: boolean; updated: number; cast_status?: string }>(
        `/api/admin/books/${bookId}/cast`,
        {
          method: "PUT",
          body: JSON.stringify({ entries }),
        }
      );
    },
    adminRebuildBookCast(bookId: string, unlock = false) {
      return request<{ ok: boolean; updated: number; cast_status?: string }>(
        `/api/admin/books/${bookId}/cast/rebuild`,
        {
          method: "POST",
          body: JSON.stringify({ unlock }),
        }
      );
    },
    adminImportBookCast(bookId: string, sourceBookId: string) {
      return request<{
        ok: boolean;
        cast_status: string;
        source_book_id: string;
        source_title: string;
        updated: number;
        skipped_locked: number;
        matched: number;
        unmatched: number;
        carried: number;
      }>(`/api/admin/books/${bookId}/cast/import-from`, {
        method: "POST",
        body: JSON.stringify({ source_book_id: sourceBookId }),
      });
    },
    adminRecommendBookCast(
      bookId: string,
      body: {
        entry_id?: string | null;
        speaker_key?: string | null;
        used_voices?: string[];
      }
    ) {
      return request<{
        ok: boolean;
        entry_id: string | null;
        speaker_key: string;
        name: string;
        gender: "male" | "female";
        age_band: "youth" | "adult" | "elder";
        presence: "soft" | "neutral" | "forceful";
        tts_voice: string;
        chirp_persona: string;
        rationale: string;
        source: "ai" | "heuristic";
      }>(`/api/admin/books/${bookId}/cast/recommend`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    adminSetBookCastStatus(bookId: string, status: "draft" | "ready") {
      return request<{ ok: boolean; cast_status: string; warnings: string[] }>(
        `/api/admin/books/${bookId}/cast/status`,
        {
          method: "POST",
          body: JSON.stringify({ status }),
        }
      );
    },
    adminListUsers(options?: {
      q?: string;
      role?: UserRole;
      limit?: number;
    }) {
      const params = new URLSearchParams();
      if (options?.q) params.set("q", options.q);
      if (options?.role) params.set("role", options.role);
      if (options?.limit != null) params.set("limit", String(options.limit));
      const query = params.toString();
      return request<{
        users: Array<{
          id: string;
          email: string;
          name: string;
          handle: string | null;
          role: UserRole;
          created_at: string;
          book_count: number;
        }>;
      }>(`/api/admin/users${query ? `?${query}` : ""}`);
    },
    adminUpdateUserRole(id: string, role: "reader" | "publisher") {
      return request<{
        ok: boolean;
        user: {
          id: string;
          email: string;
          name: string;
          handle: string | null;
          role: UserRole;
          created_at: string;
          book_count: number;
        };
      }>(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
    },
    ttsPreviewUrl(options: {
      engine: string;
      gender: string;
      chirp_persona?: string;
      text?: string;
    }) {
      const params = new URLSearchParams({
        engine: options.engine,
        gender: options.gender,
      });
      if (options.chirp_persona) params.set("chirp_persona", options.chirp_persona);
      if (options.text) params.set("text", options.text);
      return `${baseUrl}/api/tts/preview?${params.toString()}`;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
