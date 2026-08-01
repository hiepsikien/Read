"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TtsSettingsPayload } from "@read/api-client";
import { useAuth } from "@/components/AuthProvider";
import { createBrowserApi, getApiBaseUrl } from "@/lib/api";
import { cn } from "@/lib/format";
import { CURRENT_LEGAL_VERSION } from "@/lib/legal";

type TabId = "account" | "narration";

const PREVIEW_TEXT =
  "Tàu chở dầu đi qua eo biển Hormuz mỗi ngày. Từ Washington đến eo biển Malacca, các tuyến đường này quyết định giá dầu toàn cầu.";

export default function SettingsPage() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState<TabId>("account");
  const [legalBusy, setLegalBusy] = useState(false);
  const [legalError, setLegalError] = useState("");

  async function acceptLegal() {
    setLegalBusy(true);
    setLegalError("");
    try {
      await createBrowserApi().acceptLegal(user?.current_legal_version || CURRENT_LEGAL_VERSION);
      await refresh();
    } catch (err) {
      setLegalError(err instanceof Error ? err.message : "Could not save agreement.");
    } finally {
      setLegalBusy(false);
    }
  }

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return <p className="text-[var(--ink-soft)]">Loading settings…</p>;
  }

  const tabs: Array<{ id: TabId; label: string; adminOnly?: boolean }> = [
    { id: "account", label: "Account" },
    { id: "narration", label: "Narration", adminOnly: true },
  ];

  return (
    <div className="fade-up mx-auto max-w-2xl">
      <header className="mb-6">
        <p className="text-sm uppercase tracking-[0.14em] text-[var(--ink-soft)]">Preferences</p>
        <h1 className="brand-mark mt-1 text-4xl text-[var(--ink)]">Settings</h1>
      </header>

      <div className="mb-5 flex gap-1 border-b border-[var(--line)]">
        {tabs
          .filter((item) => !item.adminOnly || isAdmin)
          .map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "border-b-2 px-3 py-2 text-sm transition",
                tab === item.id
                  ? "border-[var(--sage)] text-[var(--ink)]"
                  : "border-transparent text-[var(--ink-soft)] hover:text-[var(--ink)]"
              )}
            >
              {item.label}
            </button>
          ))}
      </div>

      {tab === "account" && (
        <section className="surface rounded-2xl p-5">
          <h2 className="text-lg font-semibold">Account</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div>
              <dt className="text-[var(--ink-soft)]">Name</dt>
              <dd className="mt-0.5 font-medium">{user.name}</dd>
            </div>
            <div>
              <dt className="text-[var(--ink-soft)]">Handle</dt>
              <dd className="mt-0.5 font-medium">
                {user.handle ? (
                  <Link href={`/@${user.handle}`} className="underline underline-offset-4">
                    @{user.handle}
                  </Link>
                ) : (
                  <Link href="/claim-handle" className="underline underline-offset-4">
                    Choose a handle
                  </Link>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--ink-soft)]">Email</dt>
              <dd className="mt-0.5 font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="text-[var(--ink-soft)]">Role</dt>
              <dd className="mt-0.5 font-medium capitalize">{user.role}</dd>
            </div>
          </dl>
          <div className="mt-6 border-t border-[var(--line)] pt-5">
            <h3 className="font-semibold">Legal</h3>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <Link href="/legal/terms" className="underline underline-offset-4">Terms</Link>
              <Link href="/legal/privacy" className="underline underline-offset-4">Privacy</Link>
              <Link href="/legal/publisher" className="underline underline-offset-4">Publisher agreement</Link>
              <Link href="/legal/community" className="underline underline-offset-4">Guidelines</Link>
            </div>
            <p className="mt-3 text-sm text-[var(--ink-soft)]">
              {user.needs_legal_acceptance
                ? "Review and accept the current agreement before publishing."
                : `Accepted ${user.accepted_legal_version || CURRENT_LEGAL_VERSION}`}
            </p>
            {user.needs_legal_acceptance && (
              <button
                type="button"
                disabled={legalBusy}
                onClick={() => void acceptLegal()}
                className="mt-3 rounded-lg bg-[var(--sage)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {legalBusy ? "Saving…" : "Accept current agreement"}
              </button>
            )}
            {legalError && <p className="mt-2 text-sm text-red-700">{legalError}</p>}
          </div>
        </section>
      )}

      {tab === "narration" && isAdmin && <NarrationSettings />}
    </div>
  );
}

function NarrationSettings() {
  const api = useMemo(() => createBrowserApi(), []);
  const [payload, setPayload] = useState<TtsSettingsPayload | null>(null);
  const [engine, setEngine] = useState("neural2");
  const [gender, setGender] = useState("male");
  const [chirpPersona, setChirpPersona] = useState("");
  const [narratorRate, setNarratorRate] = useState(98);
  const [narratorPitch, setNarratorPitch] = useState(-1);
  const [dialogueRate, setDialogueRate] = useState(100);
  const [dialoguePitch, setDialoguePitch] = useState(0);
  const [breakStart, setBreakStart] = useState(200);
  const [breakEnd, setBreakEnd] = useState(100);
  const [speakNames, setSpeakNames] = useState(false);
  const [speakDirections, setSpeakDirections] = useState(false);
  const [maxVoices, setMaxVoices] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewKey, setPreviewKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.adminGetTtsSettings();
      setPayload(data);
      setEngine(data.active.engine);
      setGender(data.active.gender);
      setChirpPersona(data.active.chirp_persona || "");
      setNarratorRate(data.active.narrator_rate ?? data.defaults?.narrator_rate ?? 98);
      setNarratorPitch(data.active.narrator_pitch ?? data.defaults?.narrator_pitch ?? -1);
      setDialogueRate(data.active.dialogue_rate ?? data.defaults?.dialogue_rate ?? 100);
      setDialoguePitch(data.active.dialogue_pitch ?? data.defaults?.dialogue_pitch ?? 0);
      setBreakStart(data.active.break_start_ms ?? data.defaults?.break_start_ms ?? 200);
      setBreakEnd(data.active.break_end_ms ?? data.defaults?.break_end_ms ?? 100);
      setSpeakNames(Boolean(data.active.speak_speaker_names));
      setSpeakDirections(Boolean(data.active.speak_stage_directions));
      setMaxVoices(data.active.max_character_voices ?? data.defaults?.max_character_voices ?? 3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load narration settings.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const personas = useMemo(() => {
    if (!payload) return [];
    return payload.chirp3_personas[gender as "male" | "female"] ?? [];
  }, [payload, gender]);

  useEffect(() => {
    if (engine !== "chirp3") return;
    if (chirpPersona && personas.includes(chirpPersona)) return;
    setChirpPersona(personas[0] ?? "");
  }, [engine, gender, personas, chirpPersona]);

  const previewUrl = useMemo(() => {
    const params = new URLSearchParams({
      engine,
      gender,
      text: PREVIEW_TEXT,
    });
    if (engine === "chirp3" && chirpPersona) {
      params.set("chirp_persona", chirpPersona);
    }
    return `${getApiBaseUrl()}/api/tts/preview?${params.toString()}&_=${previewKey}`;
  }, [engine, gender, chirpPersona, previewKey]);

  async function onSave() {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const result = await api.adminUpdateTtsSettings({
        engine,
        gender,
        chirp_persona: engine === "chirp3" ? chirpPersona : "",
        narrator_rate: narratorRate,
        narrator_pitch: narratorPitch,
        dialogue_rate: dialogueRate,
        dialogue_pitch: dialoguePitch,
        break_start_ms: breakStart,
        break_end_ms: breakEnd,
        speak_speaker_names: speakNames,
        speak_stage_directions: speakDirections,
        max_character_voices: maxVoices,
      });
      setPayload((prev) => (prev ? { ...prev, active: result.active } : prev));
      setStatus(`Saved · ${result.active.voice}`);
      setPreviewKey((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save narration settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-[var(--ink-soft)]">Loading narration settings…</p>;
  }

  return (
    <section className="surface rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Narration voice</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Admin-only global defaults. Per-book cast overrides are on each book’s admin page in the app.
          </p>
        </div>
        {payload?.active.enabled === false && (
          <span className="rounded-full bg-[color-mix(in_srgb,var(--sand)_35%,white)] px-3 py-1 text-xs font-medium">
            Cloud TTS disabled in env
          </span>
        )}
      </div>

      <div className="mt-5 grid gap-4">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Engine</span>
          <select
            value={engine}
            onChange={(event) => setEngine(event.target.value)}
            className="rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2.5"
          >
            {(payload?.engines ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Gender</legend>
          <div className="flex gap-2">
            {(["male", "female"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setGender(value)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm capitalize transition",
                  gender === value
                    ? "border-[var(--sage)] bg-[var(--sage)] text-white"
                    : "border-[var(--line)] bg-white/60 hover:bg-white"
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </fieldset>

        {engine === "chirp3" && (
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Chirp3 persona</span>
            <select
              value={chirpPersona}
              onChange={(event) => setChirpPersona(event.target.value)}
              className="rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2.5"
            >
              {personas.map((persona) => (
                <option key={persona} value={persona}>
                  {persona}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Narrator rate (%)</span>
            <input type="number" value={narratorRate} onChange={(e) => setNarratorRate(Number(e.target.value))} className="rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2.5" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Narrator pitch (st)</span>
            <input type="number" value={narratorPitch} onChange={(e) => setNarratorPitch(Number(e.target.value))} className="rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2.5" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Dialogue rate (%)</span>
            <input type="number" value={dialogueRate} onChange={(e) => setDialogueRate(Number(e.target.value))} className="rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2.5" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Dialogue pitch (st)</span>
            <input type="number" value={dialoguePitch} onChange={(e) => setDialoguePitch(Number(e.target.value))} className="rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2.5" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Break before (ms)</span>
            <input type="number" value={breakStart} onChange={(e) => setBreakStart(Number(e.target.value))} className="rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2.5" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Break after (ms)</span>
            <input type="number" value={breakEnd} onChange={(e) => setBreakEnd(Number(e.target.value))} className="rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2.5" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Max character voices</span>
            <input type="number" min={1} max={6} value={maxVoices} onChange={(e) => setMaxVoices(Number(e.target.value))} className="rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2.5" />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={speakNames} onChange={(e) => setSpeakNames(e.target.checked)} />
          Speak speaker names
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={speakDirections} onChange={(e) => setSpeakDirections(e.target.checked)} />
          Speak stage directions
        </label>

        <div className="rounded-xl border border-[var(--line)] bg-white/50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">Preview</span>
            <button
              type="button"
              onClick={() => setPreviewKey((value) => value + 1)}
              className="text-[var(--sage-deep)] hover:underline"
            >
              Reload sample
            </button>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-[var(--ink-soft)]">{PREVIEW_TEXT}</p>
          <audio key={previewUrl} controls preload="none" src={previewUrl} className="w-full" />
        </div>

        {payload?.active && (
          <p className="text-xs text-[var(--ink-soft)]">
            Active now: <code>{payload.active.voice}</code>
            {payload.active.source ? ` · ${payload.active.source}` : ""}
          </p>
        )}

        {error && <p className="text-sm text-red-700">{error}</p>}
        {status && <p className="text-sm text-[var(--sage-deep)]">{status}</p>}

        <button
          type="button"
          disabled={saving}
          onClick={() => void onSave()}
          className="justify-self-start rounded-full bg-[var(--sage)] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--sage-deep)] disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save narration settings"}
        </button>
      </div>
    </section>
  );
}
