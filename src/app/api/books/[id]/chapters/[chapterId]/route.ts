import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessChapter, getBook, getChapter, getChapters } from "@/lib/db";

type Params = { params: Promise<{ id: string; chapterId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id, chapterId } = await params;
  const book = getBook(id);
  if (!book) {
    return NextResponse.json({ error: "Book not found." }, { status: 404 });
  }

  const session = await getSession();
  const isPublisherOwner = session.user?.id === book.publisher_id;

  if (book.status !== "published" && !isPublisherOwner) {
    return NextResponse.json({ error: "Book not found." }, { status: 404 });
  }

  const chapter = getChapter(id, chapterId);
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found." }, { status: 404 });
  }

  const allowed = canAccessChapter({
    book,
    chapter,
    userId: session.user?.id,
  });

  const chapters = getChapters(id).map((item) => ({
    id: item.id,
    position: item.position,
    title: item.title,
    word_count: item.word_count,
    locked: !canAccessChapter({ book, chapter: item, userId: session.user?.id }),
  }));

  if (!allowed) {
    return NextResponse.json(
      {
        error: "Purchase required to read this chapter.",
        locked: true,
        book: {
          id: book.id,
          title: book.title,
          price_cents: book.price_cents,
        },
        chapters,
      },
      { status: 402 }
    );
  }

  return NextResponse.json({
    book: {
      id: book.id,
      title: book.title,
      price_cents: book.price_cents,
      publisher_name: book.publisher_name,
    },
    chapter: {
      id: chapter.id,
      position: chapter.position,
      title: chapter.title,
      content: chapter.content,
      word_count: chapter.word_count,
    },
    chapters,
  });
}
