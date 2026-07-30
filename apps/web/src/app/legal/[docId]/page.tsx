import { notFound } from "next/navigation";
import { CURRENT_LEGAL_VERSION, LEGAL_DOCUMENTS, type LegalDocumentId } from "@/lib/legal";

export function generateStaticParams() {
  return Object.keys(LEGAL_DOCUMENTS).map((docId) => ({ docId }));
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = await params;
  const document = LEGAL_DOCUMENTS[docId as LegalDocumentId];
  if (!document) notFound();

  return (
    <article className="mx-auto max-w-2xl fade-up">
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--sage)]">
        Version {CURRENT_LEGAL_VERSION}
      </p>
      <h1 className="brand-mark mt-2 text-4xl text-[var(--ink)]">{document.title}</h1>
      <div className="surface mt-6 space-y-5 rounded-2xl p-6">
        {document.paragraphs.map((paragraph) => (
          <p key={paragraph} className="leading-7 text-[var(--ink-soft)]">
            {paragraph}
          </p>
        ))}
      </div>
    </article>
  );
}
