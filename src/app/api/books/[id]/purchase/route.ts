import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createPurchase, getBook, hasPurchase } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const session = await getSession();
  if (!session.user) {
    return NextResponse.json({ error: "Please sign in to purchase." }, { status: 401 });
  }

  const { id } = await params;
  const book = getBook(id);
  if (!book || book.status !== "published") {
    return NextResponse.json({ error: "Book not found." }, { status: 404 });
  }

  if (book.price_cents <= 0) {
    return NextResponse.json({ error: "This book is free." }, { status: 400 });
  }

  if (book.publisher_id === session.user.id || hasPurchase(session.user.id, book.id)) {
    return NextResponse.json({ ok: true, alreadyOwned: true });
  }

  // Mock checkout — records ownership without a payment provider.
  createPurchase(session.user.id, book.id, book.price_cents);

  return NextResponse.json({
    ok: true,
    mock: true,
    amount_cents: book.price_cents,
  });
}
