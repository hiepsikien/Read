"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@read/api-client";
import { useAuth } from "@/components/AuthProvider";
import { createBrowserApi } from "@/lib/api";
import { formatPrice } from "@/lib/format";

export function PurchaseButton({
  bookId,
  priceCents,
}: {
  bookId: string;
  priceCents: number;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function purchase() {
    if (!user) {
      router.push("/login");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await createBrowserApi().purchaseBook(bookId);
      setMessage("Purchase complete (mock). Full book unlocked.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Purchase failed.");
    } finally {
      setLoading(false);
    }
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
      {!user && (
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
