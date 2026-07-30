"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/types";
import { cn } from "@/lib/format";

export function SiteHeader({ user }: { user: SessionUser | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const hideChrome = pathname.startsWith("/read/");

  if (hideChrome) return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--mist)_82%,white)]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="brand-mark text-2xl font-semibold text-[var(--ink)]">
          Read
        </Link>

        <nav className="flex items-center gap-2 text-sm sm:gap-3">
          <Link
            href="/"
            className={cn(
              "rounded-md px-2 py-1.5 text-[var(--ink-soft)] transition hover:text-[var(--ink)]",
              pathname === "/" && "text-[var(--ink)]"
            )}
          >
            Library
          </Link>
          {user?.role === "publisher" && (
            <Link
              href="/publisher"
              className={cn(
                "rounded-md px-2 py-1.5 text-[var(--ink-soft)] transition hover:text-[var(--ink)]",
                pathname.startsWith("/publisher") && "text-[var(--ink)]"
              )}
            >
              Publish
            </Link>
          )}
          {user ? (
            <div className="flex items-center gap-2">
              <span className="hidden max-w-[10rem] truncate text-[var(--ink-soft)] sm:inline">
                {user.name}
              </span>
              <button
                type="button"
                onClick={logout}
                className="rounded-md border border-[var(--line)] bg-white/50 px-3 py-1.5 text-[var(--ink)] transition hover:bg-white"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-md bg-[var(--sage)] px-3 py-1.5 font-medium text-white transition hover:bg-[var(--sage-deep)]"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
