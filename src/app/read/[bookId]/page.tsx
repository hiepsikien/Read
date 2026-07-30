import { redirect } from "next/navigation";
import { getChapters } from "@/lib/db";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ bookId: string }> };

export default async function ReadBookIndexPage({ params }: Props) {
  const { bookId } = await params;
  const chapters = getChapters(bookId);
  if (!chapters[0]) {
    redirect(`/books/${bookId}`);
  }
  redirect(`/read/${bookId}/${chapters[0].id}`);
}
