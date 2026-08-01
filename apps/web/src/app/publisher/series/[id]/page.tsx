"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, formatEpisodeCode, type SeriesListItem, type SeriesSeason } from "@read/api-client";
import { useAuth } from "@/components/AuthProvider";
import { createBrowserApi } from "@/lib/api";
import { formatPrice } from "@/lib/format";

export default function ManageSeriesPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [series, setSeries] = useState<SeriesListItem | null>(null);
  const [seasons, setSeasons] = useState<SeriesSeason[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const isAdmin = user?.role === "admin";

  async function load() {
    try {
      const payload = await createBrowserApi().getSeries(params.id);
      setSeries(payload.series);
      setSeasons(payload.seasons);
      setTitle(payload.series.title);
      setDescription(payload.series.description || "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load series.");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function saveMeta(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setMessage("");
    setError("");
    try {
      const payload = await createBrowserApi().updateSeries(params.id, {
        title: title.trim(),
        description: description.trim(),
      });
      setSeries(payload.series);
      setMessage("Series details saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setBusy("");
    }
  }

  async function uploadCover(file: File | null) {
    if (!file) return;
    setBusy("cover");
    setMessage("");
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      await createBrowserApi().uploadSeriesCover(params.id, form);
      setMessage("Cover updated.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cover upload failed.");
    } finally {
      setBusy("");
    }
  }

  async function setVisibility(visibility: "listed" | "hidden") {
    setBusy("visibility");
    setMessage("");
    setError("");
    try {
      const payload = await createBrowserApi().updateSeries(params.id, { visibility });
      setSeries(payload.series);
      setMessage(visibility === "hidden" ? "Series hidden from catalog." : "Series shown on catalog.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Visibility update failed.");
    } finally {
      setBusy("");
    }
  }

  async function deleteSeries() {
    const count = seasons.reduce((sum, season) => sum + season.episodes.length, 0);
    const ok = window.confirm(
      count
        ? `Delete this series? ${count} episode${count === 1 ? "" : "s"} will become unassigned. Books stay.`
        : "Delete this series permanently?"
    );
    if (!ok) return;
    setBusy("delete");
    setMessage("");
    setError("");
    try {
      await createBrowserApi().deleteSeries(params.id);
      router.replace(isAdmin ? "/admin" : "/publisher");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed.");
      setBusy("");
    }
  }

  if (error && !series) {
    return <p className="text-red-700">{error}</p>;
  }
  if (!series) {
    return <p className="text-[var(--ink-soft)]">Loading series…</p>;
  }

  const episodeTotal = seasons.reduce((sum, season) => sum + season.episodes.length, 0);
  const coverUrl = createBrowserApi().bookCoverUrl(series.cover_url, {
    cacheKey: series.updated_at,
  });

  return (
    <div className="fade-up mx-auto max-w-2xl">
      <Link
        href={isAdmin ? "/admin" : "/publisher"}
        className="text-sm text-[var(--ink-soft)] underline underline-offset-4"
      >
        ← {isAdmin ? "Admin" : "Publisher home"}
      </Link>
      <h1 className="brand-mark mt-6 text-4xl font-semibold text-[var(--ink)]">{series.title}</h1>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">
        {episodeTotal} episode{episodeTotal === 1 ? "" : "s"}
        {series.visibility === "hidden" ? " · Hidden from catalog" : ""}
      </p>

      {coverUrl ? (
        <div className="mt-6 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverUrl}
            alt=""
            className="h-28 w-20 rounded-lg border border-[var(--line)] object-cover"
          />
          <p className="text-sm text-[var(--ink-soft)]">
            Shown on the public series page and Library series list.
          </p>
        </div>
      ) : null}

      <form onSubmit={saveMeta} className="surface mt-8 space-y-4 rounded-2xl p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
          Series details
        </h2>
        <label className="block text-sm">
          <span className="mb-1.5 block text-[var(--ink-soft)]">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2.5 outline-none ring-[var(--sage)] focus:ring-2"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-[var(--ink-soft)]">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2.5 outline-none ring-[var(--sage)] focus:ring-2"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-[var(--ink-soft)]">Cover</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => void uploadCover(e.target.files?.[0] || null)}
            disabled={busy === "cover"}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy === "save"}
            className="rounded-lg border border-[var(--line)] bg-white/70 px-4 py-2.5 text-sm font-medium"
          >
            {busy === "save" ? "Saving…" : "Save details"}
          </button>
          <Link
            href={`/series/${series.id}`}
            className="rounded-lg px-4 py-2.5 text-sm text-[var(--sage)] underline underline-offset-4"
          >
            Public page
          </Link>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {isAdmin ? (
          <button
            type="button"
            disabled={busy === "visibility"}
            onClick={() =>
              void setVisibility(series.visibility === "hidden" ? "listed" : "hidden")
            }
            className="rounded-lg border border-[var(--line)] bg-white/70 px-4 py-2.5 text-sm font-medium"
          >
            {busy === "visibility"
              ? "Updating…"
              : series.visibility === "hidden"
                ? "Show on catalog"
                : "Hide from catalog"}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy === "delete"}
          onClick={() => void deleteSeries()}
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-800"
        >
          {busy === "delete" ? "Deleting…" : "Delete series"}
        </button>
      </div>

      {(message || error) && (
        <p className={`mt-4 text-sm ${error ? "text-red-700" : "text-[var(--sage-deep)]"}`}>
          {error || message}
        </p>
      )}

      <section className="surface mt-6 rounded-2xl p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
          Episodes
        </h2>
        {seasons.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--ink-soft)]">
            No episodes yet. Attach books from each episode&apos;s manage page.
          </p>
        ) : (
          seasons.map((season) => (
            <div key={season.season_number} className="mt-5">
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                Season {season.season_number}
              </h3>
              <ul className="mt-2 divide-y divide-[var(--line)]">
                {season.episodes.map((ep) => {
                  const code = formatEpisodeCode(ep.season_number, ep.episode_number);
                  return (
                    <li key={ep.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-[var(--ink)]">
                          {code ? `${code} · ` : ""}
                          {ep.title}
                        </p>
                        <p className="text-[var(--ink-soft)]">
                          {ep.status} · {formatPrice(ep.price_cents)}
                        </p>
                      </div>
                      <Link
                        href={`/publisher/${ep.id}`}
                        className="shrink-0 text-[var(--sage)] underline underline-offset-4"
                      >
                        Manage
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
