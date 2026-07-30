import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import path from "node:path";
import fs from "node:fs/promises";
import { getSession } from "@/lib/auth";
import { getDb, getUploadDir, listPublishedBooks, listPublisherBooks } from "@/lib/db";
import { extractTextFromFile } from "@/lib/parse";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mine = searchParams.get("mine") === "1";
  const session = await getSession();

  if (mine) {
    if (!session.user || session.user.role !== "publisher") {
      return NextResponse.json({ error: "Publisher login required." }, { status: 403 });
    }
    return NextResponse.json({ books: listPublisherBooks(session.user.id) });
  }

  return NextResponse.json({ books: listPublishedBooks() });
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session.user || session.user.role !== "publisher") {
      return NextResponse.json({ error: "Publisher login required." }, { status: 403 });
    }

    const form = await request.formData();
    const title = String(form.get("title") || "").trim();
    const description = String(form.get("description") || "").trim();
    const pricing = String(form.get("pricing") || "free");
    const priceValue = Number(form.get("price") || 0);
    const file = form.get("file");

    if (!title) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A PDF or DOCX file is required." }, { status: 400 });
    }

    const originalName = file.name || "upload.bin";
    const ext = path.extname(originalName).toLowerCase();
    if (![".pdf", ".docx"].includes(ext)) {
      return NextResponse.json({ error: "Only PDF and DOCX files are supported." }, { status: 400 });
    }

    const price_cents =
      pricing === "paid" ? Math.max(1, Math.round((Number.isFinite(priceValue) ? priceValue : 0) * 100)) : 0;

    const id = nanoid();
    const storedName = `${id}${ext}`;
    const storedPath = path.join(getUploadDir(), storedName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(storedPath, buffer);

    let raw_text: string | null = null;
    try {
      raw_text = await extractTextFromFile(storedPath, originalName);
    } catch (error) {
      await fs.unlink(storedPath).catch(() => undefined);
      const message = error instanceof Error ? error.message : "Failed to parse document.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO books (
          id, publisher_id, title, description, price_cents, status,
          source_filename, source_path, raw_text, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        session.user.id,
        title,
        description,
        price_cents,
        originalName,
        storedPath,
        raw_text,
        now,
        now
      );

    return NextResponse.json({ id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
