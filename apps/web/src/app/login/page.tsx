"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ApiError } from "@read/api-client";
import { useAuth } from "@/components/AuthProvider";
import { createBrowserApi } from "@/lib/api";

const DEMOS = [
  {
    role: "Reader",
    email: "reader@read.app",
    password: "reader123",
    note: "Browse, buy, and read in-app",
  },
  {
    role: "Publisher",
    email: "publisher@read.app",
    password: "publisher123",
    note: "Upload PDF/DOCX and split chapters",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const [email, setEmail] = useState("reader@read.app");
  const [password, setPassword] = useState("reader123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await createBrowserApi().login(email, password);
      setSession(data.user, data.token);
      router.push(data.user.role === "publisher" ? "/publisher" : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md fade-up">
      <p className="text-xs uppercase tracking-[0.18em] text-[var(--sage)]">Welcome back</p>
      <h1 className="brand-mark mt-2 text-4xl font-semibold text-[var(--ink)]">Sign in to Read</h1>
      <p className="mt-3 text-[var(--ink-soft)]">
        Demo accounts are ready — reading always happens inside the app, not in an external PDF viewer.
      </p>

      <form onSubmit={onSubmit} className="surface mt-8 space-y-4 rounded-2xl p-6">
        <label className="block text-sm">
          <span className="mb-1.5 block text-[var(--ink-soft)]">Email</span>
          <input
            className="w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2.5 outline-none ring-[var(--sage)] focus:ring-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="username"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-[var(--ink-soft)]">Password</span>
          <input
            className="w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2.5 outline-none ring-[var(--sage)] focus:ring-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-[var(--sage)] px-4 py-2.5 font-medium text-white transition hover:bg-[var(--sage-deep)] disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="mt-6 space-y-3">
        {DEMOS.map((demo) => (
          <button
            key={demo.email}
            type="button"
            onClick={() => {
              setEmail(demo.email);
              setPassword(demo.password);
            }}
            className="w-full rounded-xl border border-[var(--line)] bg-white/40 px-4 py-3 text-left transition hover:bg-white/70"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-[var(--ink)]">{demo.role}</span>
              <span className="text-xs text-[var(--sage)]">Use account</span>
            </div>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">{demo.note}</p>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              {demo.email} / {demo.password}
            </p>
          </button>
        ))}
      </div>

      <p className="mt-6 text-sm text-[var(--ink-soft)]">
        <Link href="/" className="underline decoration-[var(--sage)] underline-offset-4">
          Back to library
        </Link>
      </p>
    </div>
  );
}
