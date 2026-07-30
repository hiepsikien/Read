"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatPrice } from "@/lib/format";

export function PurchaseButton({
  bookId,
  priceCents,
  signedIn,
}: {
  bookId: string;
  priceCents: number;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function purchase() {
    if (!signedIn) {
      router.push("/login");
      return;
    }
    setLoading(true);
    setMessage("");
    const response = await fetch(`/api/books/${bookId}/purchase`, { method: "POST" });
    const data = await response.json();
    setLoading(false);

    if (!response.ok) {
      setMessage(data.error || "Purchase failed.");
      return;
    }

    setMessage("Purchase complete (mock). Full book unlocked.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={purchase}
        disabled={loading}
        className="rounded-lg border border-[var(--ink)] bg-[var(--ink)] px-5 py-2.5 font-medium text-[var(--paper)] transition hover:opacity-90 disabled:opacity-60"
      >
        {loading ? "Processing…" : `Buy · ${formatPrice(priceCents)}`}
      </button>
      {message && <p className="text-sm text-[var(--sage-deep)]">{message}</p>}
      {!signedIn && (
        <p className="text-xs text-[var(--ink-soft)]">
          <Link href="/login" className="underline underline-offset-2">
            Sign in
          </Link>{" "}
          required to purchase.
        </p>
      )}
    </div>
  );
}
