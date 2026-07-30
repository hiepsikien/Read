"use client";

import { usePathname } from "next/navigation";
import { HandleGate } from "@/components/HandleGate";
import { SiteHeader } from "@/components/SiteHeader";
import { useAuth } from "@/components/AuthProvider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const isReader = pathname.startsWith("/read/");

  if (isReader) {
    return <HandleGate>{children}</HandleGate>;
  }

  return (
    <HandleGate>
      <SiteHeader user={user} />
      <main className="mx-auto min-h-[calc(100vh-4.5rem)] w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
        {children}
      </main>
    </HandleGate>
  );
}
