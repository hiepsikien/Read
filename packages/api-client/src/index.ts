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

export interface BookSourceWork {
  hub_work_id: string;
  title: string;
  year: number | null;
  language: string;
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
  author_name?: string;
  author_hub_id?: string;
  translator_name?: string;
  translator_role?: string;
  source?: BookSourceWork | null;
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

export function displayAuthorName(book: {
  author_name?: string | null;
  publisher_name?: string | null;
}): string {
  return (book.author_name || book.publisher_name || "").trim();
}

export function publisherIsDistinct(book: {
  author_name?: string | null;
  publisher_name?: string | null;
}): boolean {
  const author = displayAuthorName(book);
  const publisher = (book.publisher_name || "").trim();
  return Boolean(publisher && author && publisher !== author);
}

export function translatorCreditLine(book: {
  translator_name?: string | null;
  translator_role?: string | null;
}): string | null {
  const name = (book.translator_name || "").trim();
  if (!name) return null;
  if (book.translator_role === "hub_editorial" || name === "Knowledge Hub") {
    return `Bản dịch ${name}`;
  }
  return name;
}

export function sourceCreditLine(book: { source?: BookSourceWork | null }): string | null {
  const title = book.source?.title?.trim();
  if (!title) return null;
  const year = book.source?.year;
  return year ? `Dịch từ ${title} (${year})` : `Dịch từ ${title}`;
}

export function isHubPublisherProfile(profile: {
  handle?: string | null;
  name?: string | null;
}): boolean {
  return profile.handle === "knowledgehub" || profile.name === "Knowledge Hub";
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
  summary?: string;
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
  author_name?: string;
  author_hub_id?: string;
  translator_name?: string;
  translator_role?: string;
  source?: BookSourceWork | null;
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
  noteId?: string;
}

export interface ReaderNote {
  id: string;
  name: string;
  aliases: string[];
  episode_key: string;
  episode_title: string;
  group_label: string;
  summary?: string;
}

export interface NoteSpan {
  start: number;
  end: number;
  note: ReaderNote;
}

export type ContentBlock =
  | { type: "text"; value: string }
  | { type: "figure"; src: string; caption: string };

/** Hub REF/1 block (pilot subset). */
export interface RefSpan {
  style?: string;
  start?: number;
  end?: number;
  text?: string;
  note?: string;
}

export interface RefBlock {
  type?: string;
  text?: string;
  level?: number;
  spans?: RefSpan[];
}

export type ReaderRenderRole =
  | "paragraph"
  | "heading"
  | "blockquote"
  | "verse"
  | "list_item"
  | "dialogue"
  | "stage_direction";

export type ReaderRenderBlock =
  | {
      kind: "prose";
      role: ReaderRenderRole;
      level?: number;
      value: string;
      tokens: InlineMarkdownToken[];
    }
  | { kind: "figure"; src: string; caption: string }
  | { kind: "hr" };

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
  return value.replace(/\\([\\*_])/g, "$1");
}

function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch && /[0-9A-Za-zÀ-ỹ]/.test(ch));
}

function underscoreRunLength(value: string, index: number): number {
  let n = 0;
  while (index + n < value.length && value[index + n] === "_") n += 1;
  return n;
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

function takeInlineMarker(
  value: string,
  index: number
): { marker: string; end: number } | { literal: string; end: number } | null {
  if (value.startsWith("***", index)) return { marker: "***", end: index + 3 };
  if (value.startsWith("**", index)) return { marker: "**", end: index + 2 };
  if (value[index] === "*") return { marker: "*", end: index + 1 };
  if (value[index] !== "_") return null;

  const run = underscoreRunLength(value, index);
  if (run >= 3 && !isWordChar(value[index + run])) {
    return { literal: value.slice(index, index + run), end: index + run };
  }
  if (isWordChar(value[index - 1])) return null;
  if (value.startsWith("___", index)) return { marker: "___", end: index + 3 };
  if (value.startsWith("__", index)) return { marker: "__", end: index + 2 };
  return { marker: "_", end: index + 1 };
}

function closedInlineSpan(value: string, marker: string, openEnd: number): number {
  const closing = findClosingMarker(value, marker, openEnd);
  if (closing < 0) return -1;
  const inner = value.slice(openEnd, closing);
  if (
    marker[0] === "_" &&
    (!inner || !/[A-Za-zÀ-ỹ]/.test(inner) || isWordChar(value[closing + marker.length]))
  ) {
    return -1;
  }
  return closing;
}

/** True when `_…` / `*…` opened in this paragraph but the closer is missing. */
export function hasUnclosedInlineMarker(value: string): boolean {
  for (let index = 0; index < value.length; ) {
    if (value[index] === "\\" && index + 1 < value.length) {
      index += 2;
      continue;
    }
    const taken = takeInlineMarker(value, index);
    if (!taken) {
      index += 1;
      continue;
    }
    if ("literal" in taken) {
      index = taken.end;
      continue;
    }
    const closing = closedInlineSpan(value, taken.marker, taken.end);
    if (closing < 0) return true;
    index = closing + taken.marker.length;
  }
  return false;
}

/**
 * Split chapter content into text paragraphs and figure blocks.
 * Figures are emitted by the DOCX importer as `![caption](/api/books/.../media/....jpg)`.
 * Gutenberg often wraps one `_italic title_` across visual lines; Hub/Read
 * then stores each line as its own paragraph, so those halves are rejoined.
 */
export function parseContentBlocks(content: string): ContentBlock[] {
  const blocks = content
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

  const merged: ContentBlock[] = [];
  for (const block of blocks) {
    const prev = merged[merged.length - 1];
    if (prev?.type === "text" && block.type === "text" && hasUnclosedInlineMarker(prev.value)) {
      prev.value = `${prev.value} ${block.value}`;
      continue;
    }
    merged.push(block);
  }
  return merged;
}

/**
 * Parse the small Markdown subset used by the DOCX importer and Gutenberg
 * plain text: `**bold**` / `__bold__`, `*italic*` / `_italic_`, and the
 * triple-marker bold-italic forms. Decorative underscore rules stay literal.
 */
export function parseInlineMarkdown(value: string): InlineMarkdownToken[] {
  return groupStyledChars(parseStyledChars(value));
}

/**
 * One rendered character plus the offset it came from in the raw paragraph.
 * Keeping the offset lets note spans be layered on top of parsed markdown
 * instead of slicing the raw text first, which would split `_…_` pairs apart.
 */
interface StyledChar {
  ch: string;
  bold: boolean;
  italic: boolean;
  source: number;
}

function parseStyledChars(value: string): StyledChar[] {
  const chars: StyledChar[] = [];

  function emit(ch: string, bold: boolean, italic: boolean, source: number) {
    chars.push({ ch, bold, italic, source });
  }

  function emitRange(from: number, to: number, bold: boolean, italic: boolean) {
    for (let i = from; i < to; i += 1) emit(value[i], bold, italic, i);
  }

  for (let index = 0; index < value.length; ) {
    if (value[index] === "\\" && index + 1 < value.length) {
      emit(value[index + 1], false, false, index + 1);
      index += 2;
      continue;
    }

    const taken = takeInlineMarker(value, index);
    if (!taken) {
      emit(value[index], false, false, index);
      index += 1;
      continue;
    }
    if ("literal" in taken) {
      emitRange(index, taken.end, false, false);
      index = taken.end;
      continue;
    }

    const closing = closedInlineSpan(value, taken.marker, taken.end);
    if (closing < 0) {
      emitRange(index, taken.end, false, false);
      index = taken.end;
      continue;
    }

    const marker = taken.marker;
    const bold = marker.length >= 2;
    const italic = marker.length === 1 || marker.length === 3;
    for (let i = taken.end; i < closing; ) {
      if (value[i] === "\\" && i + 1 < closing && /[\\*_]/.test(value[i + 1])) {
        emit(value[i + 1], bold, italic, i + 1);
        i += 2;
        continue;
      }
      emit(value[i], bold, italic, i);
      i += 1;
    }
    index = closing + marker.length;
  }

  return chars;
}

function groupStyledChars(
  chars: StyledChar[],
  noteIdAt?: (source: number) => string | undefined
): InlineMarkdownToken[] {
  const tokens: InlineMarkdownToken[] = [];
  for (const char of chars) {
    const noteId = noteIdAt?.(char.source);
    const last = tokens[tokens.length - 1];
    if (
      last &&
      last.bold === char.bold &&
      last.italic === char.italic &&
      last.noteId === noteId
    ) {
      last.text += char.ch;
      continue;
    }
    const token: InlineMarkdownToken = {
      text: char.ch,
      bold: char.bold,
      italic: char.italic,
    };
    if (noteId) token.noteId = noteId;
    tokens.push(token);
  }
  return tokens;
}

const FOOTNOTE_MARKER = /^\[\d+\]$/;

export function footnoteMarkerOf(note: ReaderNote): string | null {
  for (const part of [note.name, ...note.aliases]) {
    const trimmed = part.trim();
    if (FOOTNOTE_MARKER.test(trimmed)) return trimmed;
  }
  return null;
}

function foldVi(value: string) {
  return value.toLocaleLowerCase("vi");
}

function uniquePhrases(parts: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    const key = foldVi(trimmed);
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** In-text hook for a footnote, longest first (full phrase down to last word). */
export function footnoteHooks(note: ReaderNote): string[] {
  const bases = uniquePhrases(
    [note.episode_title, note.name].map((part) => part.replace(/\s*\[\d+\]\s*$/, "").trim())
  );
  const hooks: string[] = [];
  for (const base of bases) {
    const words = base.split(/\s+/).filter(Boolean);
    for (let index = 0; index < words.length; index += 1) {
      hooks.push(words.slice(index).join(" "));
    }
  }
  return uniquePhrases(hooks).sort((a, b) => b.length - a.length);
}

function hookStartBeforeMarker(before: string, note: ReaderNote): number | null {
  const folded = foldVi(before);
  for (const hook of footnoteHooks(note)) {
    const foldedHook = foldVi(hook);
    if (folded.endsWith(foldedHook)) {
      return before.length - hook.length;
    }
    const punct = folded.match(/[\s.,;:!?…'"”]+$/);
    if (!punct) continue;
    const core = folded.slice(0, folded.length - punct[0].length);
    if (core.endsWith(foldedHook)) {
      return before.length - hook.length - punct[0].length;
    }
  }
  return null;
}

function extraNearFootnoteMarker(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 16), start);
  const after = text.slice(end, end + 32);
  if (/\[\d+\]/.test(`${before} ${after}`)) return true;
  const prefix = text.slice(0, start);
  const lastBreak = Math.max(prefix.lastIndexOf("."), prefix.lastIndexOf("!"), prefix.lastIndexOf("?"), prefix.lastIndexOf("\n"));
  const sentenceStart = lastBreak < 0 ? 0 : lastBreak + 1;
  const rest = text.slice(start);
  const nextBreak = rest.search(/[.!?\n]/);
  const sentenceEnd = nextBreak < 0 ? text.length : start + nextBreak;
  return /\[\d+\]/.test(text.slice(sentenceStart, sentenceEnd));
}

export function findNoteSpans(
  text: string,
  notes: ReaderNote[],
  options?: { phraseOnce?: Set<string> }
): NoteSpan[] {
  const occupied: Array<[number, number]> = [];
  const spans: NoteSpan[] = [];
  const phraseOnce = options?.phraseOnce;

  function overlaps(start: number, end: number) {
    return occupied.some(([left, right]) => start < right && end > left);
  }

  function take(start: number, end: number, note: ReaderNote) {
    if (start < 0 || end <= start || end > text.length || overlaps(start, end)) return false;
    occupied.push([start, end]);
    spans.push({ start, end, note });
    return true;
  }

  for (const note of notes) {
    const marker = footnoteMarkerOf(note);
    if (!marker) continue;
    let from = 0;
    while (from < text.length) {
      const at = text.indexOf(marker, from);
      if (at < 0) break;
      const hooked = hookStartBeforeMarker(text.slice(0, at), note);
      take(hooked ?? at, at + marker.length, note);
      from = at + marker.length;
    }
  }

  for (const note of notes) {
    if (footnoteMarkerOf(note)) continue;
    if (phraseOnce?.has(note.id)) continue;
    const phrases = uniquePhrases([note.episode_title, ...note.aliases, note.name])
      .filter((part) => part.length >= 3)
      .sort((a, b) => b.length - a.length);
    const folded = foldVi(text);
    for (const phrase of phrases) {
      const at = folded.indexOf(foldVi(phrase));
      if (at < 0 || extraNearFootnoteMarker(text, at, at + phrase.length)) continue;
      if (take(at, at + phrase.length, note)) {
        phraseOnce?.add(note.id);
        break;
      }
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}

export function annotateInlineTokens(
  value: string,
  notes: ReaderNote[],
  options?: { phraseOnce?: Set<string> }
): InlineMarkdownToken[] {
  const spans = findNoteSpans(value, notes, options);
  if (!spans.length) return parseInlineMarkdown(value);
  return groupStyledChars(parseStyledChars(value), (source) => {
    for (const span of spans) {
      if (source < span.start) break;
      if (source < span.end) return span.note.id;
    }
    return undefined;
  });
}

export function noteDisplayTitle(note: ReaderNote): string {
  const name = (note.name || "").trim();
  const group = (note.group_label || "").trim().toLowerCase();
  const section = group.startsWith("bối cảnh") || name.toLowerCase().startsWith("bối cảnh");
  if (!section) return name;
  for (const candidate of [note.episode_title, ...note.aliases]) {
    const text = (candidate || "").trim();
    if (text && !/^\[\d+\]$/.test(text) && foldVi(text) !== foldVi(name)) {
      return text.slice(0, 200);
    }
  }
  return name;
}

export function uniqueNotesFromTokens(
  tokens: InlineMarkdownToken[],
  notes: ReaderNote[]
): ReaderNote[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const seen = new Set<string>();
  const result: ReaderNote[] = [];
  for (const token of tokens) {
    if (!token.noteId || seen.has(token.noteId)) continue;
    seen.add(token.noteId);
    const note = byId.get(token.noteId);
    if (note) result.push(note);
  }
  return result;
}

function matchFootnoteNote(marker: string, notes: ReaderNote[]): ReaderNote | undefined {
  const needle = marker.trim();
  if (!needle) return undefined;
  for (const note of notes) {
    if (note.aliases.some((alias) => alias.trim() === needle)) return note;
    if (note.name.trim() === needle) return note;
    if (note.name.trim().endsWith(needle)) return note;
  }
  return undefined;
}

const REF_SPAN_NOTE_PREFIX = "span-note:";

function spanNoteId(marker: string): string {
  return `${REF_SPAN_NOTE_PREFIX}${marker || "note"}`;
}

export function isRefSpanNoteId(id: string | undefined | null): boolean {
  return Boolean(id && id.startsWith(REF_SPAN_NOTE_PREFIX));
}

/**
 * Merge Hub ``span.note`` bodies into the notes list used for matching/display.
 * Prefer a non-empty ``notes[]`` summary; otherwise take ``span.note``.
 * Web/mobile clients that pass ``data.notes`` separately should call this
 * before ``tokensFromRefSpans`` / ``uniqueNotesFromTokens``.
 */
export function notesFromRefBlocks(
  refBlocks: RefBlock[] | undefined | null,
  notes: ReaderNote[]
): ReaderNote[] {
  const merged: ReaderNote[] = notes.map((note) => ({
    ...note,
    aliases: [...(note.aliases || [])],
  }));
  for (const block of refBlocks || []) {
    for (const span of block.spans || []) {
      if (String(span.style || "") !== "footnote") continue;
      const body = String(span.note || "").trim();
      if (!body) continue;
      const marker = String(span.text || "").trim();
      const existing = matchFootnoteNote(marker, merged);
      if (existing) {
        if (!(existing.summary || "").trim()) existing.summary = body;
        continue;
      }
      merged.push({
        id: spanNoteId(marker),
        name: marker || "[note]",
        aliases: marker ? [marker] : [],
        episode_key: "",
        episode_title: "",
        group_label: "Chú thích",
        summary: body,
      });
    }
  }
  return merged;
}

function mergeAdjacentTokens(tokens: InlineMarkdownToken[]): InlineMarkdownToken[] {
  const out: InlineMarkdownToken[] = [];
  for (const token of tokens) {
    if (!token.text) continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.bold === token.bold &&
      prev.italic === token.italic &&
      prev.noteId === token.noteId
    ) {
      prev.text += token.text;
      continue;
    }
    out.push({ ...token });
  }
  return out;
}

/**
 * Build inline tokens from REF spans. When blocks are present, Read must not
 * re-parse markdown markers — honor Hub offsets for `em` / `footnote` only.
 */
export function tokensFromRefSpans(
  text: string,
  spans: RefSpan[] | undefined,
  notes: ReaderNote[]
): InlineMarkdownToken[] {
  const sorted = [...(spans || [])]
    .filter(
      (span) =>
        typeof span.start === "number" &&
        typeof span.end === "number" &&
        (span.end as number) > (span.start as number)
    )
    .sort((a, b) => (a.start as number) - (b.start as number) || (a.end as number) - (b.end as number));

  if (!sorted.length) {
    return [{ text, bold: false, italic: false }];
  }

  const tokens: InlineMarkdownToken[] = [];
  let cursor = 0;

  const emitPlain = (from: number, to: number) => {
    if (to <= from) return;
    tokens.push({ text: text.slice(from, to), bold: false, italic: false });
  };

  for (const span of sorted) {
    const start = Math.max(cursor, span.start as number);
    const end = Math.min(text.length, span.end as number);
    if (end <= start) continue;
    if (start > cursor) emitPlain(cursor, start);

    let chunk = text.slice(start, end);
    let italic = false;
    let noteId: string | undefined;
    const style = String(span.style || "");

    if (style === "em") {
      italic = true;
      if (chunk.length >= 2 && chunk.startsWith("_") && chunk.endsWith("_")) {
        chunk = chunk.slice(1, -1);
      }
    } else if (style === "footnote") {
      const marker = String(span.text || chunk).trim();
      const note = matchFootnoteNote(marker, notes);
      if (note) noteId = note.id;
      else if (String(span.note || "").trim()) noteId = spanNoteId(marker);
    }

    tokens.push({ text: chunk, bold: false, italic, noteId });
    cursor = end;
  }
  emitPlain(cursor, text.length);
  return mergeAdjacentTokens(tokens);
}

function refRoleForType(type: string): ReaderRenderRole | "skip" | "hr" {
  switch (type) {
    case "heading":
      return "heading";
    case "paragraph":
      return "paragraph";
    case "blockquote":
      return "blockquote";
    case "verse_line":
    case "stanza":
      return "verse";
    case "hr":
      return "hr";
    case "metadata":
      return "skip";
    case "list_item":
      return "list_item";
    case "dialogue":
      return "dialogue";
    case "stage_direction":
      return "stage_direction";
    default:
      return "paragraph";
  }
}

/**
 * Prefer Hub REF chapter `blocks` when present; otherwise fall back to
 * markdown content + note annotation.
 */
export function buildReaderBlocks(
  content: string,
  options?: { refBlocks?: RefBlock[] | null; notes?: ReaderNote[] }
): ReaderRenderBlock[] {
  const refBlocks = options?.refBlocks;
  const notes = notesFromRefBlocks(refBlocks, options?.notes ?? []);
  if (refBlocks && refBlocks.length) {
    const out: ReaderRenderBlock[] = [];
    for (const block of refBlocks) {
      const role = refRoleForType(String(block.type || "paragraph"));
      if (role === "skip") continue;
      if (role === "hr") {
        out.push({ kind: "hr" });
        continue;
      }
      const value = String(block.text || "");
      if (!value && role !== "heading") continue;
      out.push({
        kind: "prose",
        role,
        level: role === "heading" ? Math.min(4, Math.max(1, Number(block.level) || 1)) : undefined,
        value,
        tokens: tokensFromRefSpans(value, block.spans, notes),
      });
    }
    if (out.length) return out;
  }

  const phraseOnce = new Set<string>();
  return parseContentBlocks(content).map((block) => {
    if (block.type === "figure") {
      return { kind: "figure" as const, src: block.src, caption: block.caption };
    }
    return {
      kind: "prose" as const,
      role: "paragraph" as const,
      value: block.value,
      tokens: annotateInlineTokens(block.value, notes, { phraseOnce }),
    };
  });
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
          blocks?: RefBlock[] | null;
          hub_chapter_id?: string | null;
        };
        chapters: ChapterListItem[];
        progress?: ReadingProgress | null;
        notes?: ReaderNote[];
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
