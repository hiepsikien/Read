import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getBook, getChapters, getDb, hasPurchase } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const book = getBook(id);
  if (!book) {
    return NextResponse.json({ error: "Book not found." }, { status: 404 });
  }

  const session = await getSession();
  const chapters = getChapters(id).map((chapter) => ({
    id: chapter.id,
    position: chapter.position,
    title: chapter.title,
    word_count: chapter.word_count,
  }));

  const owned =
    Boolean(session.user) &&
    (book.publisher_id === session.user!.id ||
      book.price_cents === 0 ||
      hasPurchase(session.user!.id, book.id));

  const isPublisherOwner = session.user?.id === book.publisher_id;

  if (book.status !== "published" && !isPublisherOwner) {
    return NextResponse.json({ error: "Book not found." }, { status: 404 });
  }

  return NextResponse.json({
    book: {
      id: book.id,
      title: book.title,
      description: book.description,
      price_cents: book.price_cents,
      status: book.status,
      publisher_name: book.publisher_name,
      publisher_id: book.publisher_id,
      source_filename: book.source_filename,
      created_at: book.created_at,
      updated_at: book.updated_at,
      has_raw_text: Boolean(book.raw_text),
    },
    chapters,
    access: {
      owned,
      isPublisherOwner,
      previewChapterId: chapters[0]?.id ?? null,
    },
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const session = await getSession();
  if (!session.user || session.user.role !== "publisher") {
    return NextResponse.json({ error: "Publisher login required." }, { status: 403 });
  }

  const { id } = await params;
  const book = getBook(id);
  if (!book || book.publisher_id !== session.user.id) {
    return NextResponse.json({ error: "Book not found." }, { status: 404 });
  }

  const body = await request.json();
  const title = body.title !== undefined ? String(body.title).trim() : book.title;
  const description =
    body.description !== undefined ? String(body.description).trim() : book.description;
  let price_cents = book.price_cents;

  if (body.pricing === "free") {
    price_cents = 0;
  } else if (body.pricing === "paid" || body.price !== undefined) {
    const dollars = Number(body.price ?? price_cents / 100);
    price_cents = Math.max(1, Math.round((Number.isFinite(dollars) ? dollars : 1) * 100));
  }

  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE books
       SET title = ?, description = ?, price_cents = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(title, description, price_cents, now, id);

  return NextResponse.json({ ok: true });
}
