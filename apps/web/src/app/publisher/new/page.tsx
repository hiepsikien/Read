"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, type Category } from "@read/api-client";
import { createBrowserApi } from "@/lib/api";

export default function NewBookPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pricing, setPricing] = useState<"free" | "paid">("free");
  const [price, setPrice] = useState("4.99");
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void createBrowserApi()
      .listCategories()
      .then((data) => {
        setCategories(data.categories);
        if (data.categories[0]) setCategoryId(data.categories[0].id);
      })
      .catch(() => setError("Could not load categories."));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose a DOCX manuscript.");
      return;
    }
    if (!categoryId) {
      setError("Choose a category.");
      return;
    }

    setLoading(true);
    setError("");

    const form = new FormData();
    form.set("title", title);
    form.set("description", description);
    form.set("pricing", pricing);
    form.set("price", price);
    form.set("category_id", categoryId);
    form.set("file", file);

    try {
      const data = await createBrowserApi().createBook(form);
      router.push(`/publisher/${data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fade-up mx-auto max-w-xl">
      <Link href="/publisher" className="text-sm text-[var(--ink-soft)] underline underline-offset-4">
        ← Publisher home
      </Link>
      <h1 className="brand-mark mt-6 text-4xl font-semibold text-[var(--ink)]">Upload a book</h1>
      <p className="mt-2 text-[var(--ink-soft)]">
        Original DOCX manuscripts only. After upload you can auto-split chapters and submit for review.
      </p>

      <form onSubmit={onSubmit} className="surface mt-8 space-y-4 rounded-2xl p-6">
        <label className="block text-sm">
          <span className="mb-1.5 block text-[var(--ink-soft)]">Title</span>
          <input
            required
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

        <fieldset className="space-y-2">
          <legend className="text-sm text-[var(--ink-soft)]">Category</legend>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setCategoryId(category.id)}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  categoryId === category.id
                    ? "border-[var(--sage)] bg-[var(--sage)] text-white"
                    : "border-[var(--line)] bg-white/70"
                }`}
              >
                {category.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm text-[var(--ink-soft)]">Pricing</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="pricing"
              checked={pricing === "free"}
              onChange={() => setPricing("free")}
            />
            Free
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="pricing"
              checked={pricing === "paid"}
              onChange={() => setPricing("paid")}
            />
            Paid
          </label>
          {pricing === "paid" && (
            <label className="block text-sm">
              <span className="mb-1.5 block text-[var(--ink-soft)]">Price (USD)</span>
              <input
                type="number"
                min="0.99"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2.5 outline-none ring-[var(--sage)] focus:ring-2"
              />
              <span className="mt-1 block text-xs text-[var(--ink-soft)]">
                Chapter 1 stays free as a preview inside Read.
              </span>
            </label>
          )}
        </fieldset>

        <label className="block text-sm">
          <span className="mb-1.5 block text-[var(--ink-soft)]">Manuscript (DOCX)</span>
          <input
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full text-sm"
            required
          />
        </label>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-[var(--sage)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--sage-deep)] disabled:opacity-50"
        >
          {loading ? "Uploading…" : "Upload & extract"}
        </button>
      </form>
    </div>
  );
}
