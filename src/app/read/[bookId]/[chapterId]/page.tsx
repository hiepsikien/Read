import { InAppReader } from "@/components/InAppReader";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ bookId: string; chapterId: string }> };

export default async function ReadChapterPage({ params }: Props) {
  const { bookId, chapterId } = await params;
  return <InAppReader bookId={bookId} chapterId={chapterId} />;
}
