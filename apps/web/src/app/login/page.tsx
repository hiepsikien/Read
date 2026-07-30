"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ApiError } from "@read/api-client";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/components/AuthProvider";
import { createBrowserApi } from "@/lib/api";
import { CURRENT_LEGAL_VERSION } from "@/lib/legal";

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
    note: "Upload DOCX and submit for review",
  },
  {
    role: "Admin",
    email: "admin@read.app",
    password: "admin123",
    note: "Moderate the review queue on mobile",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("reader@read.app");
  const [password, setPassword] = useState("reader123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedLegal, setAcceptedLegal] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (mode === "signup" && !acceptedLegal) {
      setError("Accept the Terms and Privacy Policy to create an account.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await createBrowserApi().login(
        email,
        password,
        mode === "signup" ? name || email.split("@")[0] : undefined
      );
      setSession(data.user, data.token);
      let profile = data.user;
      if (mode === "signup") {
        const accepted = await createBrowserApi().acceptLegal(
          data.user.current_legal_version || CURRENT_LEGAL_VERSION
        );
        profile = accepted.user;
        setSession(profile);
      }
      router.push(profile.role === "publisher" ? "/publisher" : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md fade-up">
      <BrandLogo variant="mark" height={48} priority />
      <p className="mt-5 text-xs uppercase tracking-[0.18em] text-[var(--sage)]">Welcome back</p>
      <h1 className="brand-mark mt-2 text-4xl font-semibold text-[var(--ink)]">
        {mode === "signin" ? "Sign in to Read" : "Create account"}
      </h1>
      <p className="mt-3 text-[var(--ink-soft)]">
        Free books stay readable without an account. Sign in to unlock paid titles or publish DOCX manuscripts.
      </p>

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={() => setMode("signin")}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
            mode === "signin"
              ? "border-[var(--sage)] bg-[var(--sage)] text-white"
              : "border-[var(--line)] bg-white/70"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
            mode === "signup"
              ? "border-[var(--sage)] bg-[var(--sage)] text-white"
              : "border-[var(--line)] bg-white/70"
          }`}
        >
          Create account
        </button>
      </div>

      <form onSubmit={onSubmit} className="surface mt-4 space-y-4 rounded-2xl p-6">
        {mode === "signup" ? (
          <label className="block text-sm">
            <span className="mb-1.5 block text-[var(--ink-soft)]">Display name</span>
            <input
              className="w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2.5 outline-none ring-[var(--sage)] focus:ring-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        ) : null}
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
        {mode === "signup" && (
          <label className="flex items-start gap-3 text-sm text-[var(--ink-soft)]">
            <input
              type="checkbox"
              checked={acceptedLegal}
              onChange={(event) => setAcceptedLegal(event.target.checked)}
              className="mt-1"
            />
            <span>
              I agree to the{" "}
              <Link href="/legal/terms" className="underline">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/legal/privacy" className="underline">
                Privacy Policy
              </Link>
              , and confirm I am old enough to enter this agreement.
            </span>
          </label>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={loading || (mode === "signup" && !acceptedLegal)}
          className="w-full rounded-lg bg-[var(--sage)] px-4 py-2.5 font-medium text-white transition hover:bg-[var(--sage-deep)] disabled:opacity-60"
        >
          {loading ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <div className="mt-6 space-y-3">
        {DEMOS.map((demo) => (
          <button
            key={demo.email}
            type="button"
            onClick={() => {
              setMode("signin");
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
