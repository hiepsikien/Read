import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getSession } from "@/lib/auth";
import { splitIntoChapters } from "@/lib/chapters";
import { countWords, getBook, getDb } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const session = await getSession();
  if (!session.user || session.user.role !== "publisher") {
    return NextResponse.json({ error: "Publisher login required." }, { status: 403 });
  }

  const { id } = await params;
  const book = getBook(id);
  if (!book || book.publisher_id !== session.user.id) {
    return NextResponse.json({ error: "Book not found." }, { status: 404 });
  }

  if (!book.raw_text?.trim()) {
    return NextResponse.json({ error: "No extracted text available to split." }, { status: 400 });
  }

  const chapters = splitIntoChapters(book.raw_text);
  if (chapters.length === 0) {
    return NextResponse.json({ error: "Could not create chapters from this document." }, { status: 400 });
  }

  const db = getDb();
  const wipe = db.prepare(`DELETE FROM chapters WHERE book_id = ?`);
  const insert = db.prepare(
    `INSERT INTO chapters (id, book_id, position, title, content, word_count)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const touch = db.prepare(`UPDATE books SET updated_at = ? WHERE id = ?`);

  const tx = db.transaction(() => {
    wipe.run(id);
    chapters.forEach((chapter, index) => {
      insert.run(
        nanoid(),
        id,
        index + 1,
        chapter.title,
        chapter.content,
        countWords(chapter.content)
      );
    });
    touch.run(new Date().toISOString(), id);
  });

  tx();

  return NextResponse.json({
    ok: true,
    chapter_count: chapters.length,
  });
}
