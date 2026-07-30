import { redirect } from "next/navigation";
import { createServerApi } from "@/lib/api-server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ bookId: string }> };

export default async function ReadBookIndexPage({ params }: Props) {
  const { bookId } = await params;
  try {
    const api = await createServerApi();
    const { chapters } = await api.getBook(bookId);
    if (!chapters[0]) {
      redirect(`/books/${bookId}`);
    }
    redirect(`/read/${bookId}/${chapters[0].id}`);
  } catch {
    redirect(`/books/${bookId}`);
  }
}
