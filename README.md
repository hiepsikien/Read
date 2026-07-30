# Read

Mobile-friendly in-app book reading product.

Publishers upload **PDF** or **DOCX**, auto-split into chapters, and publish as **Free** or **Paid**. Readers open books **inside the Read app** (formatted chapter reader) — not in an external PDF viewer.

> **Tài liệu dự án (Tiếng Việt):** [docs/PROJECT.md](./docs/PROJECT.md)

## MVP features

- Library of published books
- Free books: full in-app reading
- Paid books: **whole logical Chapter 1 free** (all reading segments in it), remaining unlock after mock purchase
- Publisher upload (PDF/DOCX) → extract text → **smart auto-split** into comfortable reading segments → publish
- In-app reader: themes (Paper / Ink / Sepia), font size, contents sheet, progress, remember last chapter
- English UI

## Demo accounts

| Role | Email | Password |
|------|-------|----------|
| Reader | `reader@read.app` | `reader123` |
| Publisher | `publisher@read.app` | `publisher123` |

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

SQLite database is created at `data/read.db`. Uploads go to `uploads/`.

## Scripts

```bash
npm test      # smart chapter-split unit tests
npm run build
npm start
```

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- SQLite (`better-sqlite3`)
- `pdf-parse` + `mammoth` for document text extraction
- Cookie sessions (`iron-session`)
- Mock purchases (no Stripe yet)

## Docs

- [docs/PROJECT.md](./docs/PROJECT.md) — đầy đủ mục tiêu, quyết định MVP, kiến trúc, luồng, phase sau
