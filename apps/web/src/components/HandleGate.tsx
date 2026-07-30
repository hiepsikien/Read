"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

const ALLOWED_WITHOUT_HANDLE = new Set(["/claim-handle", "/login", "/logout"]);

export function HandleGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user || user.handle) return;
    if (ALLOWED_WITHOUT_HANDLE.has(pathname) || pathname.startsWith("/legal/")) return;
    router.replace("/claim-handle");
  }, [loading, user, pathname, router]);

  if (!loading && user && !user.handle && !ALLOWED_WITHOUT_HANDLE.has(pathname) && !pathname.startsWith("/legal/")) {
    return <p className="text-[var(--ink-soft)]">Choose a handle to continue…</p>;
  }

  return <>{children}</>;
}
