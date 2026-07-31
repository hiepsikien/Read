import type { BookStatus, BookVisibility } from "@read/api-client";

const STATUS_LABELS: Record<BookStatus, string> = {
  draft: "Draft",
  pending_review: "In review",
  published: "Published",
  rejected: "Needs changes",
};

const VISIBILITY_LABELS: Record<BookVisibility, string> = {
  listed: "On shelf",
  hidden: "Hidden",
  removed: "Removed",
};

export function bookStatusLabel(status: string | null | undefined) {
  if (!status) return "Draft";
  return STATUS_LABELS[status as BookStatus] || status.replace(/_/g, " ");
}

export function visibilityLabel(visibility: string | null | undefined) {
  if (!visibility) return "On shelf";
  return VISIBILITY_LABELS[visibility as BookVisibility] || visibility.replace(/_/g, " ");
}

/** Show store badge for published books, or whenever visibility is not listed. */
export function shouldShowStoreBadge(book: {
  status: string;
  visibility?: string | null;
}) {
  if (book.visibility && book.visibility !== "listed") return true;
  return book.status === "published";
}

export function formatRelativeTime(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const deltaSec = Math.round((now - then) / 1000);
  if (deltaSec < 60) return "just now";
  const minutes = Math.round(deltaSec / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Decode percent-encoded upload filenames (e.g. My%20Book.docx). */
export function displayFilename(name: string | null | undefined): string | null {
  if (!name) return null;
  try {
    let decoded = name;
    // Some clients double-encode; decode while %xx remains and progress is made.
    for (let i = 0; i < 3 && /%[0-9A-Fa-f]{2}/.test(decoded); i += 1) {
      const next = decodeURIComponent(decoded.replace(/\+/g, " "));
      if (next === decoded) break;
      decoded = next;
    }
    return decoded;
  } catch {
    return name;
  }
}

export function bookActionTimeLine(book: {
  status: string;
  updated_at?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
}) {
  if (book.status === "pending_review" && book.submitted_at) {
    const when = formatRelativeTime(book.submitted_at);
    return when ? `Submitted ${when}` : "Submitted";
  }
  if (book.status === "rejected" && book.reviewed_at) {
    const when = formatRelativeTime(book.reviewed_at);
    return when ? `Reviewed ${when}` : "Reviewed";
  }
  if (book.status === "published" && book.reviewed_at) {
    const when = formatRelativeTime(book.reviewed_at);
    return when ? `Published ${when}` : "Live";
  }
  const when = formatRelativeTime(book.updated_at);
  return when ? `Updated ${when}` : null;
}

/** Publisher list meta: time · chapters (no status, no filename). */
export function publisherBookMetaLine(book: {
  status: string;
  updated_at?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
  chapter_count?: number;
}) {
  const parts: string[] = [];
  const action = bookActionTimeLine(book);
  if (action) parts.push(action);

  if (typeof book.chapter_count === "number") {
    parts.push(
      book.chapter_count === 1 ? "1 chapter" : `${book.chapter_count} chapters`
    );
  }

  return parts.join(" · ");
}

/** One-line activity for publisher / admin list rows. */
export function bookActivityLine(
  book: {
    status: string;
    updated_at?: string | null;
    submitted_at?: string | null;
    reviewed_at?: string | null;
    source_filename?: string | null;
    chapter_count?: number;
  },
  options?: { includeFilename?: boolean; includeChapterCount?: boolean }
) {
  const includeFilename = options?.includeFilename !== false;
  const includeChapterCount = options?.includeChapterCount !== false;
  const parts: string[] = [bookStatusLabel(book.status)];

  const action = bookActionTimeLine(book);
  if (action) parts.push(action);

  if (includeChapterCount && typeof book.chapter_count === "number") {
    parts.push(
      book.chapter_count === 1 ? "1 chapter" : `${book.chapter_count} chapters`
    );
  }

  if (includeFilename) {
    const filename = displayFilename(book.source_filename);
    if (filename) parts.push(filename);
  }

  return parts.join(" · ");
}
