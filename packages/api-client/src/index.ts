export type UserRole = "reader" | "publisher";

export type BookStatus = "draft" | "published";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface BookListItem {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  status: BookStatus;
  publisher_name?: string;
  chapter_count: number;
  created_at: string;
  updated_at?: string;
}

export interface ChapterListItem {
  id: string;
  position: number;
  title: string;
  word_count: number;
  group_index: number;
  locked?: boolean;
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
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => string | null | undefined;
  fetch?: typeof fetch;
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

  async function request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const headers = new Headers(init.headers);
    const token = options.getToken?.();
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
    login(email: string, password: string) {
      return request<{ user: SessionUser; token: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
    },
    logout() {
      return request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
    },
    me() {
      return request<{ user: SessionUser | null }>("/api/auth/me");
    },
    listBooks(mine = false) {
      const q = mine ? "?mine=1" : "";
      return request<{ books: BookListItem[] }>(`/api/books${q}`);
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
      }
    ) {
      return request<{ ok: boolean }>(`/api/books/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    splitBook(id: string) {
      return request<{ ok: boolean; chapter_count: number }>(
        `/api/books/${id}/split`,
        { method: "POST" }
      );
    },
    publishBook(id: string) {
      return request<{ ok: boolean; status: string }>(
        `/api/books/${id}/publish`,
        { method: "POST" }
      );
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
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
