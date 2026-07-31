import { redirect } from "next/navigation";
import { createServerApi } from "@/lib/api-server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ bookId: string }> };

export default async function ReadBookIndexPage({ params }: Props) {
  const { bookId } = await params;
  try {
    const api = await createServerApi();
    const { chapters, access } = await api.getBook(bookId);
    if (!chapters[0]) {
      redirect(`/books/${bookId}`);
    }
    const chapterId = access.progress?.chapter_id ?? chapters[0].id;
    redirect(`/read/${bookId}/${chapterId}`);
  } catch {
    redirect(`/books/${bookId}`);
  }
}
