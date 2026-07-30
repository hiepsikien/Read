import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import type { Book, Chapter, Purchase, User } from "./types";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, "read.db");

const globalForDb = globalThis as unknown as { __readDb?: Database.Database };

function createDb() {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('reader', 'publisher')),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      publisher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
      source_filename TEXT,
      source_path TEXT,
      raw_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, book_id)
    );

    CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
    CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id, position);
  `);

  seedIfEmpty(db);
  return db;
}

function seedIfEmpty(db: Database.Database) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  if (count.c > 0) return;

  const now = new Date().toISOString();
  const publisherId = nanoid();
  const readerId = nanoid();
  const freeBookId = nanoid();
  const paidBookId = nanoid();

  const insertUser = db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, created_at)
     VALUES (@id, @email, @name, @role, @password_hash, @created_at)`
  );

  insertUser.run({
    id: publisherId,
    email: "publisher@read.app",
    name: "North Harbor Press",
    role: "publisher",
    password_hash: bcrypt.hashSync("publisher123", 10),
    created_at: now,
  });

  insertUser.run({
    id: readerId,
    email: "reader@read.app",
    name: "Alex Reader",
    role: "reader",
    password_hash: bcrypt.hashSync("reader123", 10),
    created_at: now,
  });

  const insertBook = db.prepare(
    `INSERT INTO books (
      id, publisher_id, title, description, price_cents, status,
      source_filename, source_path, raw_text, created_at, updated_at
    ) VALUES (
      @id, @publisher_id, @title, @description, @price_cents, @status,
      @source_filename, @source_path, @raw_text, @created_at, @updated_at
    )`
  );

  const freeText = SAMPLE_FREE.map((c) => `${c.title}\n\n${c.content}`).join("\n\n");
  const paidText = SAMPLE_PAID.map((c) => `${c.title}\n\n${c.content}`).join("\n\n");

  insertBook.run({
    id: freeBookId,
    publisher_id: publisherId,
    title: "Letters from the Quiet Coast",
    description:
      "A short free collection of coastal sketches — mornings, harbors, and the people who wait for the tide.",
    price_cents: 0,
    status: "published",
    source_filename: null,
    source_path: null,
    raw_text: freeText,
    created_at: now,
    updated_at: now,
  });

  insertBook.run({
    id: paidBookId,
    publisher_id: publisherId,
    title: "The Cartographer's Apprentice",
    description:
      "A paid novella about maps that refuse to stay still. Chapter 1 is free; unlock the rest with a mock purchase.",
    price_cents: 499,
    status: "published",
    source_filename: null,
    source_path: null,
    raw_text: paidText,
    created_at: now,
    updated_at: now,
  });

  const insertChapter = db.prepare(
    `INSERT INTO chapters (id, book_id, position, title, content, word_count)
     VALUES (@id, @book_id, @position, @title, @content, @word_count)`
  );

  SAMPLE_FREE.forEach((chapter, index) => {
    insertChapter.run({
      id: nanoid(),
      book_id: freeBookId,
      position: index + 1,
      title: chapter.title,
      content: chapter.content,
      word_count: countWords(chapter.content),
    });
  });

  SAMPLE_PAID.forEach((chapter, index) => {
    insertChapter.run({
      id: nanoid(),
      book_id: paidBookId,
      position: index + 1,
      title: chapter.title,
      content: chapter.content,
      word_count: countWords(chapter.content),
    });
  });
}

export function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function getDb() {
  if (!globalForDb.__readDb) {
    globalForDb.__readDb = createDb();
  }
  return globalForDb.__readDb;
}

export function getUploadDir() {
  return UPLOAD_DIR;
}

export function getUserByEmail(email: string) {
  return getDb().prepare("SELECT * FROM users WHERE email = ?").get(email) as User | undefined;
}

export function getUserById(id: string) {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
}

export function listPublishedBooks() {
  return getDb()
    .prepare(
      `SELECT b.id, b.title, b.description, b.price_cents, b.status, b.created_at,
              u.name AS publisher_name,
              (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id) AS chapter_count
       FROM books b
       JOIN users u ON u.id = b.publisher_id
       WHERE b.status = 'published'
       ORDER BY b.created_at DESC`
    )
    .all();
}

export function listPublisherBooks(publisherId: string) {
  return getDb()
    .prepare(
      `SELECT b.*,
              (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id) AS chapter_count
       FROM books b
       WHERE b.publisher_id = ?
       ORDER BY b.updated_at DESC`
    )
    .all(publisherId);
}

export function getBook(id: string) {
  return getDb()
    .prepare(
      `SELECT b.*, u.name AS publisher_name
       FROM books b
       JOIN users u ON u.id = b.publisher_id
       WHERE b.id = ?`
    )
    .get(id) as (Book & { publisher_name: string }) | undefined;
}

export function getChapters(bookId: string) {
  return getDb()
    .prepare(
      `SELECT id, book_id, position, title, word_count, content
       FROM chapters
       WHERE book_id = ?
       ORDER BY position ASC`
    )
    .all(bookId) as Chapter[];
}

export function getChapter(bookId: string, chapterId: string) {
  return getDb()
    .prepare(`SELECT * FROM chapters WHERE book_id = ? AND id = ?`)
    .get(bookId, chapterId) as Chapter | undefined;
}

export function hasPurchase(userId: string, bookId: string) {
  const row = getDb()
    .prepare(`SELECT id FROM purchases WHERE user_id = ? AND book_id = ?`)
    .get(userId, bookId) as { id: string } | undefined;
  return Boolean(row);
}

export function createPurchase(userId: string, bookId: string, amountCents: number) {
  const purchase: Purchase = {
    id: nanoid(),
    user_id: userId,
    book_id: bookId,
    amount_cents: amountCents,
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO purchases (id, user_id, book_id, amount_cents, created_at)
       VALUES (@id, @user_id, @book_id, @amount_cents, @created_at)`
    )
    .run(purchase);
  return purchase;
}

export function canAccessChapter(options: {
  book: Book;
  chapter: Chapter;
  userId?: string | null;
}) {
  const { book, chapter, userId } = options;
  if (book.price_cents === 0) return true;
  if (chapter.position === 1) return true;
  if (!userId) return false;
  if (book.publisher_id === userId) return true;
  return hasPurchase(userId, book.id);
}

const SAMPLE_FREE = [
  {
    title: "Chapter 1 — First Light",
    content: `The ferry left before the shops opened. Mist held the water so still that the hull seemed to slide across glass. Mara counted the buoys the way other people count breaths — one for luck, one for home, one for whatever waited on the far pier.

She had packed lightly: a notebook, a thermos, and the letter she had not yet opened. The envelope was soft at the corners, carried too long in a coat pocket. On the front, in a careful hand, only her name.

When the island appeared, it was smaller than memory. Rooflines leaned into the wind. A dog barked once and decided against a second try. Mara stepped onto the wet planks and felt the morning settle into her shoes.`,
  },
  {
    title: "Chapter 2 — Harbor Names",
    content: `Old maps still used names the tourists never learned. The green shed by the winch was not a shed; it was the Listening House, where nets were mended and gossip was sorted by tide.

Mara asked for tea and received advice. “If you walk the north path before noon,” said the woman with salt in her hair, “the cliffs keep their stories. After noon they only keep their wind.”

She walked anyway, both before and after, and wrote down the names painted under peeling signs: Knot Mercy, Quiet Debt, Second Chance Cove. Some names were jokes. Some were warnings wearing joke clothes.`,
  },
  {
    title: "Chapter 3 — The Unopened Letter",
    content: `On the third evening she opened the letter. It did not ask her to return. It asked her to look carefully.

“There is a bench facing west,” it said. “Sit until the lighthouse forgets to impress anyone. Then write what remains.”

Mara sat. The light swept the water with professional patience. What remained was simple: a coast that did not need her, and a notebook that somehow did. She began with the ferry, then the buoys, then the dog that barked once. By midnight the quiet coast had become a book in waiting.`,
  },
];

const SAMPLE_PAID = [
  {
    title: "Chapter 1 — Ink That Moves",
    content: `The apprenticeship began with a warning: never trust a map that looks finished.

Eli arrived with clean sleeves and an expensive compass. Master Rowan gave him a table by the window, a jar of iron gall ink, and a coastline that refused to agree with itself. Each morning the peninsula drifted a finger’s width. Each evening the harbor mouth narrowed as if embarrassed by visitors.

“You are not here to copy the world,” Rowan said. “You are here to notice when the world edits you.”

Eli laughed, then stopped laughing when his own sketch erased a road he was certain he had drawn.`,
  },
  {
    title: "Chapter 2 — The Client from Nowhere",
    content: `She wore no crest and paid in unmarked silver. She wanted a map of a city that did not appear in any ledger. “It exists on Tuesdays,” she said, as if that clarified the contract.

Rowan accepted. Eli protested. The silver stayed.

They drafted grids, erased grids, and argued about north. On the seventh draft a plaza appeared that neither of them remembered inventing. In the plaza stood a fountain shaped like an open book. Eli touched the parchment and felt damp stone.`,
  },
  {
    title: "Chapter 3 — Borders with Opinions",
    content: `Borders, Rowan taught, are gossip that got promoted.

The Tuesday city grew confident. Alleys multiplied overnight. A wall migrated three streets west and took two bakeries with it. Eli began sleeping in the studio so he would not miss a revision.

One dawn he found a note in his own handwriting he did not recall writing: “Follow the fountain. Bring no finished maps.”`,
  },
  {
    title: "Chapter 4 — Apprentice No Longer",
    content: `When Eli stepped into the plaza, the fountain’s water ran with ink. Rowan waited on the far side, older and somehow less surprised.

“Every cartographer becomes the territory eventually,” Rowan said. “The work is choosing which coast you become.”

Eli set down his blank sheet. For the first time the paper stayed blank on purpose. The city paused, polite as a held breath, and let him decide where north should begin.`,
  },
];
