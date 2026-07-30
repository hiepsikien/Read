import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getBook, getChapters, getDb } from "@/lib/db";

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

  const chapters = getChapters(id);
  if (chapters.length === 0) {
    return NextResponse.json(
      { error: "Split chapters before publishing." },
      { status: 400 }
    );
  }

  getDb()
    .prepare(`UPDATE books SET status = 'published', updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);

  return NextResponse.json({ ok: true, status: "published" });
}
