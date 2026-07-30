export type UserRole = "reader" | "publisher" | "admin";

export type BookStatus = "draft" | "pending_review" | "published" | "rejected";
export type BookVisibility = "listed" | "hidden" | "removed";
export type ReportReason = "copyright" | "inappropriate" | "spam" | "misleading" | "other";
export type ReportStatus = "open" | "resolved" | "dismissed";

export type SplitLength = "short" | "standard" | "long";

export const SPLIT_LENGTH_OPTIONS: Array<{
  value: SplitLength;
  label: string;
  hint: string;
}> = [
  { value: "short", label: "Short", hint: "~5–8 min" },
  { value: "standard", label: "Standard", hint: "~10–15 min" },
  { value: "long", label: "Long", hint: "~20–25 min" },
];

export interface SessionUser {
  id: string;
  email: string;
  name: string;
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

export interface ChapterAudioSegment {
  index: number;
  paragraph_index: number;
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
}

export interface TtsSettingsPayload {
  engines: Array<{ id: string; label: string }>;
  genders: string[];
  chirp3_personas: { male: string[]; female: string[] };
  voices: Array<{
    engine: string;
    engine_label: string;
    gender: string;
    voice: string;
  }>;
  active: TtsActiveSettings;
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
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const message =
        data && typeof data === "object" && "error" in data
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
        };
      }>(`/api/books/${id}`);
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
    bookCoverUrl(coverUrl: string | null | undefined) {
      if (!coverUrl) return null;
      if (coverUrl.startsWith("http://") || coverUrl.startsWith("https://")) return coverUrl;
      return `${baseUrl}${coverUrl}`;
    },
    updateBook(
      id: string,
      body: {
        title?: string;
        description?: string;
        pricing?: "free" | "paid";
        price?: number;
        category_id?: string;
      }
    ) {
      return request<{ ok: boolean; status?: BookStatus }>(`/api/books/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    splitBook(id: string, options?: { length?: SplitLength }) {
      return request<{ ok: boolean; chapter_count: number }>(`/api/books/${id}/split`, {
        method: "POST",
        body: JSON.stringify({ length: options?.length ?? "standard" }),
      });
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
      }>(`/api/books/${bookId}/chapters/${chapterId}`);
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
    adminApprove(id: string, featured = false) {
      return request<{
        ok: boolean;
        status: BookStatus;
        visibility: BookVisibility;
        featured: boolean;
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
    }) {
      return request<{ ok: boolean; active: TtsActiveSettings }>("/api/admin/settings/tts", {
        method: "PUT",
        body: JSON.stringify(body),
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
