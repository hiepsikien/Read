export type UserRole = "reader" | "publisher" | "admin";

export type BookStatus = "draft" | "pending_review" | "published" | "rejected";

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

export interface BookDetail {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  status: BookStatus;
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
      return request<{ id: string }>("/api/books", { method: "POST", body: form });
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
    adminQueue() {
      return request<{ books: BookListItem[] }>("/api/admin/queue");
    },
    adminBook(id: string) {
      return request<{
        book: BookDetail & { publisher_name: string };
        chapters: ChapterListItem[];
      }>(`/api/admin/books/${id}`);
    },
    adminApprove(id: string) {
      return request<{ ok: boolean; status: BookStatus }>(`/api/admin/books/${id}/approve`, {
        method: "POST",
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
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
