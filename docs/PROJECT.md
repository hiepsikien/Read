# Tài liệu dự án Read

> Ứng dụng đọc sách: **web-app (Next.js)** + **mobile native (React Native / Expo, iOS + Android)** + **FastAPI** — đọc trong app, không mở PDF ngoài.

- **Repo:** https://github.com/hiepsikien/Read  
- **Thương hiệu:** Read  
- **Ngôn ngữ UI (MVP):** English  
- **Trạng thái:** MVP (web đầy đủ; mobile reader flow; API tách riêng)  

---

## 1. Mục tiêu sản phẩm

Cho phép:

1. **Publisher** upload tài liệu **PDF** hoặc **DOCX**
2. Tự động chia thành các **đoạn đọc (reading segments)** một cách thông minh
3. Chọn sách **Free** hoặc **Paid**
4. **Reader** đọc free ngay; sách trả phí phải mua (mock payment)
5. Trải nghiệm đọc nằm **trong app Read** (web + native mobile reader flow)

---

## 2. Quyết định đã chốt (MVP)

| Hạng mục | Quyết định |
|----------|------------|
| Tên | **Read** |
| Clients | **Web (Next.js)** + **Mobile (React Native / Expo, iOS+Android)** |
| Backend | **FastAPI** + **PostgreSQL** (tách khỏi Next) |
| Auth | **JWT Bearer** (web + mobile dùng chung) |
| Định dạng upload | **PDF + DOCX** (không hỗ trợ DOC cũ) |
| Thanh toán | **Mock** (ghi purchase trong DB, chưa Stripe) |
| Ngôn ngữ UI | **Tiếng Anh trước** |
| Preview sách trả phí | **Cả logical Chapter 1** miễn phí (mọi đoạn thuộc chapter 1) |
| Nơi đọc | **Trong app** — text/chapter reader, không mở file gốc bên ngoài |
| Định dạng nội dung lúc này | **Markdown nhẹ** — DOCX giữ bold/italic; PDF vẫn plain text |

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

File: `apps/api/app/chapters.py` (port từ logic MVP trước)

Luồng:

0. **Reflow văn bản** về paragraph thật (`normalize_document_text`)
   - PDF extraction cho ra *dòng hiển thị*, có khi mỗi từ một dòng
   - HTML tự collapse whitespace nên web không thấy lỗi, native thì xuống dòng thật
1. **Nhận chapter có sẵn** trong tài liệu  
   - `Chapter 1`, `Chương`, `Part`, `Book`,…  
   - Hoặc dạng `1. Title` / `2. Title` nếu không có chữ “Chapter”
2. **Trong mỗi chapter**, nhận **mục/section** (`Section`, `Mục`, heading đánh số con,…)
3. **Gói các mục** thành đoạn đọc khoảng **~2000 từ**
4. **Không cắt một mục nằm giữa 2 đoạn** — mỗi section là đơn vị nguyên
5. Nếu một mục quá dài (> ~3000 từ): chỉ tách theo **đoạn văn (paragraph)**, không cắt giữa paragraph
6. Mỗi reading segment lưu `group_index` = số chapter logic gốc  
   - Paid preview: mọi segment có `group_index === 1` đều free

Chạy test:

```bash
cd apps/api && .venv/bin/pytest -q
```

---

## 5. Kiến trúc kỹ thuật

```
Web (apps/web Next.js)          Mobile (apps/mobile Expo RN)
  Library / Reader / Publisher     Login + Library (scaffold)
                 \                 /
                  \               /
                   v             v
              FastAPI (apps/api)
           JWT auth · books · split
           publish · purchase · gated chapters
                        |
                        v
              PostgreSQL + uploads/
```

### Stack
- **Web:** Next.js 15 (App Router) + TypeScript + Tailwind CSS 4
- **Mobile:** React Native qua **Expo** (cross-platform iOS + Android)
- **API:** FastAPI + SQLAlchemy + Alembic + PostgreSQL
- **Auth:** JWT Bearer (`packages/api-client` dùng chung)
- **Extract:** `pypdf` (PDF) + `python-docx` (DOCX)
- Thanh toán: mock (không cổng thật)

### Cấu trúc thư mục chính

```
read/
├── apps/
│   ├── web/                 # Next.js web-app (UI only)
│   ├── api/                 # FastAPI + Alembic + pytest
│   └── mobile/              # Expo React Native (reader MVP)
├── packages/
│   └── api-client/          # typed fetch + DTOs
├── docker-compose.yml       # PostgreSQL
├── docs/PROJECT.md
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
docker compose up -d db          # PostgreSQL :5433
python3 -m venv apps/api/.venv
apps/api/.venv/bin/pip install -r apps/api/requirements.txt
cp apps/api/.env.example apps/api/.env
cd apps/api && .venv/bin/uvicorn app.main:app --reload --port 8000
# terminal khác:
cd Read && npm install && cp apps/web/.env.local.example apps/web/.env.local
npm run dev:web                  # http://localhost:3000
```

Mobile scaffold:

```bash
cd apps/mobile && npm install && npx expo start
```

Lệnh khác:

```bash
npm run build                    # build web production
cd apps/api && .venv/bin/pytest -q
```

Dữ liệu runtime:
- DB: PostgreSQL (Docker)
- Upload: `uploads/` (relative keys trong DB)

Biến môi trường:
- API: `DATABASE_URL`, `JWT_SECRET`, `UPLOAD_DIR`, `CORS_ORIGINS`
- Web: `NEXT_PUBLIC_API_URL`
- Mobile: `EXPO_PUBLIC_API_URL`

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

## 9. Phase sau

### Native mobile (reader + publisher đã xong)
- Library → book detail → in-app reader (theme, font, TOC, prev/next)
- Mock purchase + unlock chapter 402
- Publisher: upload (PDF/DOCX qua document picker) → split → publish → mở reader
- Còn lại: EAS Build / store distribution, persist tiến độ đọc

### AI (đã bàn, chưa code)
- Smart split / metadata / blurb bằng AI (publisher)
- Ask-this-chapter, define/explain (reader, gated theo quyền đọc)

### Trải nghiệm đọc
- Focus mode, TTS, transition chapter tinh gọn hơn

### Rich format
- Đã giữ **bold / italic** từ DOCX trên mobile + web reader
- DOCX giữ nguyên paragraph thật; scene heading all-caps được tách dòng
- Còn lại: heading style/underline/font/size; PDF giữ style trung thực khó hơn

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
2. Nội dung lưu dạng Markdown nhẹ; DOCX giữ bold/italic, PDF vẫn plain text
3. Smart split **bắt buộc trong MVP**: tôn trọng chapter/mục có sẵn, đoạn vừa đọc, không cắt giữa mục  
4. Đọc **trong app**, không phụ thuộc PDF viewer ngoài  

---

*Cập nhật cùng codebase trên nhánh `main` của repo Read.*
