# Tài liệu dự án Read

> Ứng dụng đọc sách trên browser (mobile + desktop), đọc **trong app** — không mở PDF bằng trình xem ngoài.

- **Repo:** https://github.com/hiepsikien/Read  
- **Thương hiệu:** Read  
- **Ngôn ngữ UI (MVP):** English  
- **Trạng thái:** MVP  

---

## 1. Mục tiêu sản phẩm

Cho phép:

1. **Publisher** upload tài liệu **PDF** hoặc **DOCX**
2. Tự động chia thành các **đoạn đọc (reading segments)** một cách thông minh
3. Chọn sách **Free** hoặc **Paid**
4. **Reader** đọc free ngay; sách trả phí phải mua (mock payment)
5. Trải nghiệm đọc nằm **trong app Read** (in-app reader), thân thiện mobile và desktop browser

---

## 2. Quyết định đã chốt (MVP)

| Hạng mục | Quyết định |
|----------|------------|
| Tên | **Read** |
| Định dạng upload | **PDF + DOCX** (không hỗ trợ DOC cũ) |
| Thanh toán | **Mock** (ghi purchase trong DB, chưa Stripe) |
| Ngôn ngữ UI | **Tiếng Anh trước** |
| Preview sách trả phí | **Cả logical Chapter 1** miễn phí (mọi đoạn thuộc chapter 1) |
| Nơi đọc | **Trong app** — text/chapter reader, không mở file gốc bên ngoài |
| Định dạng nội dung lúc này | **Plain text** — chưa giữ bold/italic/font/size từ file gốc (cải thiện sau) |

---

## 3. Tính năng MVP

### Reader
- Thư viện sách đã publish
- Chi tiết sách: mô tả, giá, danh sách đoạn đọc
- Sách free: đọc toàn bộ trong app
- Sách paid: toàn bộ **chapter logic 1** free; các chapter sau cần mua
- In-app reader:
  - Theme: Paper / Ink / Sepia
  - Tăng/giảm cỡ chữ
  - Mục lục (contents sheet)
  - Thanh tiến độ đọc
  - Nhớ chapter đang đọc (`localStorage`)
  - Prev / Next giữa các đoạn

### Publisher
- Đăng nhập role publisher
- Upload PDF/DOCX + title, description, Free/Paid (+ giá)
- Server extract text từ file
- Nút **Auto-split into reading segments**
- Xem danh sách đoạn đã chia → **Publish to library**
- Quản lý sách của mình

### Auth (demo)
| Role | Email | Password |
|------|-------|----------|
| Reader | `reader@read.app` | `reader123` |
| Publisher | `publisher@read.app` | `publisher123` |

---

## 4. Chia chapter thông minh (quan trọng)

File: `src/lib/chapters.ts`

Luồng:

1. **Nhận chapter có sẵn** trong tài liệu  
   - `Chapter 1`, `Chương`, `Part`, `Book`,…  
   - Hoặc dạng `1. Title` / `2. Title` nếu không có chữ “Chapter”
2. **Trong mỗi chapter**, nhận **mục/section** (`Section`, `Mục`, heading đánh số con,…)
3. **Gói các mục** thành đoạn đọc khoảng **~850 từ** (vừa đọc trên mobile)
4. **Không cắt một mục nằm giữa 2 đoạn** — mỗi section là đơn vị nguyên
5. Nếu một mục quá dài (> ~1300 từ): chỉ tách theo **đoạn văn (paragraph)**, không cắt giữa paragraph
6. Mỗi reading segment lưu `group_index` = số chapter logic gốc  
   - Paid preview: mọi segment có `group_index === 1` đều free

Chạy test:

```bash
npm test
```

---

## 5. Kiến trúc kỹ thuật

```
Browser (Next.js UI)
  ├── Library / Book detail / Login
  ├── In-app Reader
  └── Publisher dashboard
        ↓
Next.js App Router API
  ├── Auth (iron-session cookie)
  ├── Books CRUD + upload
  ├── Split / Publish / Purchase
  └── Chapter content (gated)
        ↓
SQLite (data/read.db) + uploads/
```

### Stack
- **Next.js 15** (App Router) + TypeScript + Tailwind CSS 4
- **SQLite** qua `better-sqlite3`
- **pdf-parse** (PDF) + **mammoth** (DOCX) — extract plain text
- **iron-session** — session cookie
- **bcryptjs** — hash mật khẩu demo
- Thanh toán: mock (không cổng thật)

### Cấu trúc thư mục chính

```
read-app/
├── src/
│   ├── app/
│   │   ├── page.tsx                 # Library
│   │   ├── login/
│   │   ├── books/[id]/             # Book detail
│   │   ├── read/[bookId]/...       # In-app reader
│   │   ├── publisher/              # Publisher dashboard
│   │   └── api/                    # REST API
│   ├── components/
│   │   ├── InAppReader.tsx
│   │   ├── SiteHeader.tsx
│   │   └── ...
│   └── lib/
│       ├── db.ts                   # Schema, seed, access control
│       ├── chapters.ts             # Smart split
│       ├── parse.ts                # PDF/DOCX → text
│       ├── auth.ts
│       └── types.ts
├── data/                           # SQLite (gitignored)
├── uploads/                        # File upload (gitignored)
├── docs/PROJECT.md                 # Tài liệu này
└── README.md
```

### Model dữ liệu (tóm tắt)

- **users** — `reader` | `publisher`
- **books** — title, description, `price_cents` (0 = free), status `draft|published`, `raw_text`, file nguồn
- **chapters** — reading segments: `position`, `title`, `content`, `word_count`, **`group_index`**
- **purchases** — user ↔ book (mock)

---

## 6. Luồng nghiệp vụ

### Publisher publish sách
1. Sign in publisher  
2. Upload PDF/DOCX + metadata  
3. Server lưu file → extract `raw_text`  
4. Auto-split → tạo các rows trong `chapters`  
5. Publish → hiện trên Library  

### Reader đọc / mua
1. Mở Library → Book detail  
2. Free → đọc mọi segment  
3. Paid → đọc mọi segment thuộc chapter 1; segment sau hiện Locked  
4. Buy (mock) → ghi `purchases` → mở toàn bộ trong in-app reader  

---

## 7. Chạy dự án local

```bash
git clone https://github.com/hiepsikien/Read.git
cd Read
npm install          # cài dependencies vào node_modules
npm run dev          # chạy dev server (thường http://localhost:3000)
```

Lệnh khác:

```bash
npm run build        # build production
npm start            # chạy bản build
npm test             # test bộ chia chapter
```

Dữ liệu runtime:
- DB: `data/read.db` (tự tạo + seed khi lần đầu)
- Upload: `uploads/`

Biến môi trường (xem `.env.local`):
- `SESSION_SECRET` — secret cho cookie session

---

## 8. Routes chính

| Path | Mô tả |
|------|--------|
| `/` | Thư viện |
| `/login` | Đăng nhập demo |
| `/books/[id]` | Chi tiết sách |
| `/read/[bookId]/[chapterId]` | In-app reader |
| `/publisher` | Danh sách sách của publisher |
| `/publisher/new` | Upload sách mới |
| `/publisher/[id]` | Quản lý / split / publish |

API tiêu biểu: `/api/auth/*`, `/api/books`, `/api/books/[id]/split`, `/publish`, `/purchase`, `/chapters/[chapterId]`.

---

## 9. Phase sau (chưa làm trong MVP)

### AI (đã bàn, chưa code)
- Smart split / metadata / blurb bằng AI (publisher)
- Ask-this-chapter, define/explain (reader, gated theo quyền đọc)

### Trải nghiệm đọc
- Focus mode, TTS, transition chapter tinh gọn hơn

### Rich format
- Giữ **bold / italic / heading** từ DOCX (`mammoth.convertToHtml`)
- PDF giữ style trung thực khó hơn — cân nhắc sau

### Khác
- Stripe thật  
- EPUB, DRM, highlight/note sync  
- Offline PWA đầy đủ  
- Admin moderation  

---

## 10. Ghi chú thiết kế UI

- Brand **Read** nổi trên viewport đầu  
- Typography: Fraunces (brand), Source Serif 4 (đọc), DM Sans (UI)  
- Tone màu ink / sage / mist — tránh purple generic và cream+terracotta cliché  
- Reader full-screen trong app; chrome ẩn khi scroll  

---

## 11. Lịch sử quyết định nhanh

1. Làm **MVP trước**, chưa nhúng AI  
2. Plain text OK cho MVP; rich format cải thiện sau  
3. Smart split **bắt buộc trong MVP**: tôn trọng chapter/mục có sẵn, đoạn vừa đọc, không cắt giữa mục  
4. Đọc **trong app**, không phụ thuộc PDF viewer ngoài  

---

*Cập nhật cùng codebase trên nhánh `main` của repo Read.*
