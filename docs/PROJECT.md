# Tài liệu dự án Read

> Ứng dụng đọc sách: **web-app (Next.js)** + **mobile native (React Native / Expo, iOS + Android)** + **FastAPI** — đọc trong app, không mở PDF ngoài.

- **Repo:** https://github.com/hiepsikien/Read  
- **Thương hiệu:** Read  
- **Ngôn ngữ UI (MVP):** English  
- **Trạng thái:** MVP+ (web đầy đủ; mobile reader + publisher + admin; Firebase auth thật; **cloud TTS narration**; API tách riêng)  
- **Đã merge gần nhất:** cloud TTS narration + admin voice controls (commit `ea572e0`) — xem §4b và §12  

---

## 1. Mục tiêu sản phẩm

Cho phép:

1. **Publisher** upload tài liệu **DOCX** (original manuscript)
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
| Auth | **Firebase ID token** (AUTH_DEV_MODE stand-in khi chưa cấu hình Firebase) |
| Định dạng upload | **DOCX only** (PDF bị khóa để giữ styling/original content) |
| Vai trò | `reader` \| `publisher` \| `admin` |
| Publish | Author submit review → admin approve/reject |
| Category | Một primary category bắt buộc trước khi submit |
| Định dạng nội dung lúc này | **Markdown nhẹ** — DOCX giữ bold/italic |
| Thanh toán | **Mock** (ghi purchase trong DB, chưa Stripe) |
| Ngôn ngữ UI | **Tiếng Anh trước** |
| Preview sách trả phí | **Cả logical Chapter 1** miễn phí (mọi đoạn thuộc chapter 1) |
| Nơi đọc | **Trong app** — text/chapter reader, không mở file gốc bên ngoài |

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
- Đăng nhập role publisher (hoặc bật author mode từ reader)
- Upload **DOCX** + title, description, category, Free/Paid (+ giá)
- Server extract text từ file
- Nút **Auto-split into reading segments**
- **Submit for review** (không tự publish)
- Quản lý sách của mình; chỉnh lại khi bị reject

### Admin (mobile-first)
- Queue sách `pending_review`
- Preview metadata/chapters
- Approve → published, hoặc Reject + note

### Auth (demo)
| Role | Email | Password |
|------|-------|----------|
| Reader | `reader@read.app` | `reader123` |
| Publisher | `publisher@read.app` | `publisher123` |
| Admin | `admin@read.app` | `admin123` |

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

## 4b. Audio / TTS narration (đã merge `main`)

Đọc thành tiếng bằng **Google Cloud Text-to-Speech**, tổng hợp phía server, cache MP3 theo từng segment, phát trong in-app reader.

**Backend** (`apps/api/app/tts.py`, `tts_settings.py`, `routers/tts.py`):

- **Engine × giọng:** `standard` · `wavenet` · `neural2` · `chirp3` (Chirp3 HD có nhiều persona), mỗi engine có giọng **nam/nữ** tiếng Việt (`VOICE_CATALOG`). Chirp3 chọn persona riêng qua `google_tts_chirp_persona`.
- **Admin đổi giọng động, không cần restart:** lưu ở bảng `app_settings` (model `AppSetting`); `get_active_tts` đọc DB trước, fallback về biến môi trường. `resolved_tts_voice` quy ra tên giọng cuối cùng.
- **Chuẩn hoá text cho giọng đọc** (`normalize_for_speech`):
  - **ALL CAPS → Title Case** để tên riêng (CALICUT, VASCO DA GAMA) đọc thành từ thay vì đánh vần từng chữ. **Giữ nguyên** viết tắt thật (`_SPELLED_ACRONYMS`: VOC, EIC, GDP…) và **số La Mã** (`_ROMAN_NUMERALS`: II, XVI…). Cố ý loại `DI`/`VI` khỏi số La Mã vì trong sách chúng là từ tiếng Việt (DI DÂN, NGOẠI VI).
  - Bỏ markdown/URL/chú thích số; gộp khoảng trắng; chia theo giới hạn `MAX_TTS_INPUT_BYTES`.
- **Hội thoại kịch bản → SSML:** dạng `NHÂN VẬT *(sắc thái)* Lời thoại` (và biến thể không có sắc thái, hoặc chỉ có chỉ dẫn đứng đầu) được dựng thành `<speak>` với `<break>` ngắt nhịp và `<prosody>` chỉnh `rate`/`pitch`/`volume` theo sắc thái (`_dialogue_prosody`: trầm/khàn, thì thầm, hét, run sợ, tức giận…). Đoạn tiếp theo vẫn thuộc cùng nhân vật nếu mở bằng gạch ngang (`-` / `–` / `—` / `―` / …) **hoặc** là cả đoạn in nghiêng không gạch (vd `*Điều thứ nhất: …*`). Prose thường (vd `AFONSO (58 tuổi) đứng trên boong`) **không** bị nhận nhầm thành thoại.
- **Cache:** khoá = `sha256(version · voice · [ssml] · text-đã-chuẩn-hoá)`; file MP3 ở `uploads/tts-cache/<xx>/<hash>.mp3`. Khoá tính từ text đã chuẩn hoá nên chỉ đoạn thật sự đổi mới phải tổng hợp lại. Đổi `TTS_CACHE_VERSION` để vô hiệu toàn bộ cache khi cần.

**API:**
- `GET /api/tts/options` — liệt kê engine/gender/persona + giọng đang active
- `GET /api/tts/preview` — nghe thử một đoạn với cấu hình bất kỳ
- `GET /api/tts/compare` — trang HTML so sánh các giọng
- `GET/PUT /api/admin/settings/tts` — admin xem/đổi giọng active (bảo vệ bởi `require_admin`)
- `POST /api/books/{id}/chapters/{cid}/audio` — chuẩn bị segment audio; `GET …/audio/{index}` — stream MP3

**Client:**
- Web: trang `/settings` có tab **Narration** (chỉ admin) — chọn engine/gender/persona, nghe preview, lưu.
- Mobile: `apps/mobile/app/settings.tsx` (Narration cho admin) + **voice picker ngay trong reader** (`lib/voice-picker.tsx`). Hook `lib/use-ios-narration.ts` phát audio cloud (fallback native), `reloadVoice()` đổi giọng mà giữ vị trí đang nghe, và **tự cuộn** theo paragraph đang đọc.
- Chi phí tham khảo: Neural2 ~ **$16 / 1M ký tự**; sách V3 (~105k ký tự) ≈ $1.7/lượt, nằm trong hạn mức free 1M ký tự/tháng.

---

## 5. Kiến trúc kỹ thuật

```
Web (apps/web Next.js)          Mobile (apps/mobile Expo RN)
  Library / Reader / Publisher     Reader + Publisher + Admin
                 \                 /
      Firebase ID token (client)  /
                  \               /
                   v             v
              FastAPI (apps/api)
     verify Firebase token · books · split
     submit-review · admin approve/reject
     purchase · gated chapters · categories
                        |
                        v
              PostgreSQL + uploads/
```

### Stack
- **Web:** Next.js 15 (App Router) + TypeScript + Tailwind CSS 4
- **Mobile:** React Native qua **Expo SDK 54** (cross-platform iOS + Android)
- **API:** FastAPI + SQLAlchemy + Alembic + PostgreSQL
- **Auth:** **Firebase ID token** — client lấy token (Firebase JS SDK, persistence qua `@react-native-async-storage/async-storage`), server verify bằng **firebase-admin**. `AUTH_DEV_MODE=true` dùng token stand-in HS256 khi chưa cấu hình Firebase. `packages/api-client` dùng chung.
- **Extract:** `python-docx` (**DOCX only** — PDF đã khóa)
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

- **users** — `reader` | `publisher` | `admin`; `firebase_uid` (unique, nullable), `password_hash` nullable (chỉ dùng cho dev token)
- **categories** — `slug`, `label`, `sort_order` (seed từ `apps/api/app/categories.py`)
- **series** — catalog parent (`title`, `description`, `publisher_id`, `visibility` `listed|hidden`); Season không có bảng riêng
- **books** — title, description, `price_cents` (0 = free), `category_id`, optional `series_id` + `season_number` + `episode_number` (**Episode = Book**, đơn vị bán), status `draft|pending_review|published|rejected`, moderation fields (`submitted_at`, `reviewed_at`, `reviewed_by`, `review_note`), `raw_text`, file nguồn
- **chapters** — reading segments / **parts trong một episode**: `position`, `title`, `content`, `word_count`, **`group_index`**
- **purchases** — user ↔ book/episode (mock)
- **app_settings** — key/value cấu hình runtime (TTS engine/gender/persona); cho admin đổi giọng đọc không cần restart
- **reading shelf** — `GET /api/reading` trả `items` (in-progress) + `series_continue` (episode kế sau khi hoàn thành)

Hierarchy catalog: **Series → Season (số) → Episode (Book) → Parts (Chapters)**. Schema: `0012_series.py`, `0013_series_visibility.py` (idempotent — an toàn với DB đã `create_all`).

---

## 6. Luồng nghiệp vụ

### Publisher publish sách
1. Sign in publisher (hoặc bật author mode từ reader)  
2. Upload **DOCX** + metadata + **category** (bắt buộc)  
3. Server lưu file → extract `raw_text`  
4. Auto-split (short/standard/long) → tạo các rows trong `chapters`  
5. **Submit for review** → status `pending_review` (không tự publish)  
6. Admin **approve** → `published` (hiện trên Library), hoặc **reject** + note → author sửa rồi submit lại  

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
cd apps/api && .venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --port 8000
# Trên máy thật (điện thoại): thêm --host 0.0.0.0 để LAN truy cập được
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
- API: `DATABASE_URL`, `UPLOAD_DIR`, `CORS_ORIGINS`, `AUTH_DEV_MODE`, `AUTH_DEV_SECRET`, `ADMIN_EMAILS`, `FIREBASE_PROJECT_ID`, `FIREBASE_CREDENTIALS_JSON`; TTS: `GOOGLE_TTS_ENABLED`, `GOOGLE_TTS_ENGINE`, `GOOGLE_TTS_GENDER`, `GOOGLE_TTS_CHIRP_PERSONA`, `GOOGLE_TTS_VOICE`, `TTS_CACHE_DIR` (xác thực Google qua Application Default Credentials)
- Web: `NEXT_PUBLIC_API_URL`
- Mobile: `EXPO_PUBLIC_API_URL` (dùng **LAN IP** khi test điện thoại thật, không dùng `localhost`), `EXPO_PUBLIC_FIREBASE_*`

Chi tiết Firebase: xem [docs/FIREBASE_SETUP.md](./FIREBASE_SETUP.md). Secrets (`apps/api/.env`, `apps/mobile/.env`, `*firebase-adminsdk*.json`, `*service-account*.json`) đều bị `.gitignore` — **không commit**.

---

## 8. Routes chính

| Path | Mô tả |
|------|--------|
| `/` | Thư viện |
| `/login` | Đăng nhập demo |
| `/books/[id]` | Chi tiết sách / episode |
| `/series/[id]` | Series browse theo Season → Episode |
| `/read/[bookId]/[chapterId]` | In-app reader |
| `/settings` | Account + tab **Narration** (TTS, chỉ admin) |
| `/publisher` | Danh sách series + episode của publisher |
| `/publisher/series/new` | Tạo series |
| `/publisher/series/[id]` | Quản lý series (meta/cover, xóa; admin thêm hide/show) |
| `/publisher/new` | Upload episode (DOCX) |
| `/publisher/[id]` | Quản lý / gắn series / split / publish |

Mobile bổ sung: `/admin` (queue + **Series** tab), `/admin/[id]` (review + series link), `/admin/[id]/edit` (catalog + series placement), `/series/[id]`, `/publisher/series-new`, `/publisher/series/[id]`.

API tiêu biểu:
- Auth: `/api/auth/dev-login` (chỉ khi `AUTH_DEV_MODE`), `/api/auth/me`, `/api/auth/enable-author`
- Books: `/api/books`, `/api/books/[id]/split`, `/api/books/[id]/submit-review`, `/api/books/categories/list`, `/api/books/[id]/purchase`, `/api/chapters/[chapterId]`
- Series: `/api/series` (`mine=1`, `all=1`), `/api/series/[id]` (GET/PATCH/DELETE); `visibility` `listed|hidden` (PATCH visibility = admin); DELETE unassign episodes
- Admin: `/api/admin/queue`, `/api/admin/books/[id]` (PATCH catalog + series placement), `/api/admin/books/[id]/approve`, `/api/admin/books/[id]/reject`, `/api/admin/settings/tts` (GET/PUT)
- TTS: `/api/tts/options`, `/api/tts/preview`, `/api/tts/compare`, `/api/books/[id]/chapters/[cid]/audio` (POST prepare + GET segment)

---

## 9. Phase sau

### Native mobile (reader + publisher + admin đã xong)
- Library → book detail → in-app reader (theme, font — **persist qua SecureStore**, TOC, prev/next)
- Mock purchase + unlock chapter
- Publisher: upload DOCX → chọn category → split (short/standard/long) → submit-review → xem trạng thái/note
- Admin: queue → review → approve/reject
- Còn lại: EAS Build / store distribution, persist tiến độ đọc

### AI (đã bàn, chưa code)
- Smart split / metadata / blurb bằng AI (publisher)
- Ask-this-chapter, define/explain (reader, gated theo quyền đọc)

### Trải nghiệm đọc
- ~~TTS đọc thành tiếng~~ ✅ cloud TTS (Google) + admin đổi giọng động, SSML cho hội thoại kịch bản, tự cuộn theo audio (xem §4b)
- Còn lại: focus mode, lock-screen / Now Playing controls (mức đầy đủ)

### Rich format
- Đã giữ **bold / italic** từ DOCX trên mobile + web reader
- DOCX giữ nguyên paragraph thật; scene heading all-caps được tách dòng
- Còn lại: heading style/underline/font/size; PDF giữ style trung thực khó hơn

### Khác
- Stripe thật  
- EPUB, DRM, highlight/note sync  
- Offline PWA đầy đủ  
- ~~Admin moderation~~ ✅ đã xong

### Chưa làm (đã bàn trong roadmap, chưa code)
- Toggle đọc **cuộn (scroll)** vs **lật (flip)**
- Reader cho chọn **font hỗ trợ đa ngôn ngữ** (default + 2 lựa chọn/ngôn ngữ)
- Redesign **Library** chuyên nghiệp hơn
- **i18n** đa ngôn ngữ (English là main)
- **AI**: gợi ý category + viết mô tả (publisher); ask-this-chapter (reader)

---

## 10. Ghi chú thiết kế UI

- Brand **Read** nổi trên viewport đầu  
- Typography: Fraunces (brand), Source Serif 4 (đọc), DM Sans (UI)  
- Tone màu ink / sage / mist — tránh purple generic và cream+terracotta cliché  
- Reader full-screen trong app; chrome ẩn khi scroll  

### Logo & brand assets

| Asset | Path | Dùng cho |
|-------|------|----------|
| **Original showcase** | `apps/web/public/brand/read-wordmark-hero.png` | Hero Library + nguồn sự thật |
| Wordmark PNG/SVG | `read-wordmark.png` / `.svg` | Header, reader chrome |
| Mark PNG/SVG (book only) | `read-mark.png` / `.svg` | Login, favicon source, compact UI |
| Mono ink / white | `read-*-ink.*`, `read-*-white.*` | Reader theme tối (không tintColor) |
| App icon (mist bg) | `apps/web/src/app/icon.png`, `apple-icon.png` | Favicon / Apple touch |
| OG / social | `apps/web/public/brand/og-image.png` | Open Graph + Twitter card |
| Mobile icon/splash | `apps/mobile/assets/icon.png`, `adaptive-icon.png`, `splash.png` | Expo `app.json` |
| Mobile UI | `mark.png`, `wordmark.png`, `*-ink.png`, `*-white.png` | Library / login / reader |

**Quy ước UI**
- **Wordmark** = chữ + sách → dùng **một mình**, không kèm text “Read”
- **Mark** = **chỉ icon sách** (không kèm chữ “d”) → compact chrome, login, app icon
- `BrandLogo` hỗ trợ `tone`: `color` \| `ink` \| `white`
- Hero Library dùng `read-wordmark-hero.png` (bản gốc có nền mist)

---

## 11. Lịch sử quyết định nhanh

1. Làm **MVP trước**, chưa nhúng AI  
2. Nội dung lưu dạng Markdown nhẹ; DOCX giữ bold/italic, PDF vẫn plain text
3. Smart split **bắt buộc trong MVP**: tôn trọng chapter/mục có sẵn, đoạn vừa đọc, không cắt giữa mục  
4. Đọc **trong app**, không phụ thuộc PDF viewer ngoài  

---

## 12. Bàn giao (state hiện tại — để làm tiếp ở thread khác)

**Đã merge vào `main`** (commit `011a05f`): Firebase auth thật, DOCX-only upload, categories, moderation workflow, admin mobile flows, AsyncStorage persistence cho Firebase.

**Firebase đã cấu hình & verify chạy được:**
- Project `read-99d4d`. `AUTH_DEV_MODE=false`, `firebase-admin` verify token thật OK, token sai trả **401** (đã fix từ 500).
- Service account: `apps/api/read-99d4d-firebase-adminsdk-*.json` (đã `.gitignore`, **không commit**).
- Admin email: cấu hình trong `ADMIN_EMAILS` (email nào khớp sẽ tự lên role `admin` lần gọi API đầu).
- Provider Email/Password cần được bật trong Firebase Console; account demo (`*.@read.app`) **không** login được nữa vì `dev-login` đã tắt — phải tạo account thật.

**Lưu ý môi trường khi chạy:**
- `apps/mobile/.env` → `EXPO_PUBLIC_API_URL` phải là **LAN IP** (vd `http://172.20.10.4:8000`), không dùng `localhost`, và đổi lại khi mạng đổi. Sau khi sửa `.env` phải `npx expo start -c`.
- API nên chạy `--host 0.0.0.0` để điện thoại truy cập. Tránh chạy 2 uvicorn cùng lúc.
- Test suite dùng `apps/api/tests/conftest.py` để pin `AUTH_DEV_MODE=true`, độc lập với `.env` thật. `27/27 pass`.

**Cloud TTS narration — đã merge `main`** (commit `ea572e0`, chi tiết §4b):
- Google Cloud TTS phía server, cache MP3 theo segment (`apps/api/app/tts.py`, `tts_settings.py`, `routers/tts.py`).
- Admin đổi engine/gender/persona động qua bảng `app_settings` — web `/settings` tab Narration, mobile settings + voice picker trong reader.
- Chuẩn hoá ALL CAPS (giữ acronym thật + số La Mã), SSML cho hội thoại kịch bản (break + prosody theo sắc thái), tự cuộn theo audio, `reloadVoice()` giữ vị trí đang nghe.
- Test: `apps/api/tests/test_tts.py`, toàn bộ suite pass (`38 passed`).

**Cấu hình cần cho TTS chạy:**
- Bật Cloud Text-to-Speech API; xác thực bằng **Application Default Credentials** cho local: `gcloud auth application-default login` rồi `gcloud auth application-default set-quota-project <project>`.
- Env TTS (xem `apps/api/.env.example`): `GOOGLE_TTS_ENABLED`, `GOOGLE_TTS_ENGINE`, `GOOGLE_TTS_GENDER`, `GOOGLE_TTS_CHIRP_PERSONA` (tùy chọn), `GOOGLE_TTS_VOICE` (override cứng, tùy chọn), `TTS_CACHE_DIR`. Giọng active lưu ở DB sẽ override env khi admin đổi.

**Hoàn thiện audio — kế hoạch:**

> Đã xong (đừng làm lại): cloud TTS + fallback giọng máy, play/pause/resume/stop, đổi tốc độ 0.8/1/1.2, **tự phát tiếp segment kế trong cùng chapter**, **auto-scroll bám theo đoạn đang đọc** (`followNarrationRef` — chỉ bám tới khi người đọc tự cuộn tay), highlight đoạn đang đọc, admin voice picker, **tự sang chapter kế** (unlocked → replace + auto-play; locked → màn mua; hết sách → finished overlay), **handoff chapter khi nghe tiếp** (giữ màn hình cũ lúc soft-load, banner “Chapter N · title” + fade ngắn, latch continue chống race `stop`/autoplay), **background audio mức nhẹ trên iOS** (`shouldPlayInBackground: true` + `UIBackgroundModes: ["audio"]`; stop khi rời reader / Back, không stop khi khóa màn; **chưa** có lock-screen / Control Center controls). Cần **rebuild native** sau khi đổi Info.plist.

Còn lại:

1. **Hỗ trợ Android** (dễ–trung bình, rủi ro thấp)
   - Đang khóa cứng `supported: Platform.OS === "ios"`; audio mode chỉ set cho iOS; hook đặt tên `use-ios-*`.
   - `expo-audio` (cloud) và `expo-speech` (fallback) vốn chạy được Android → việc chính: bỏ gate iOS, set audio mode cho Android, đổi tên hook cho trung tính, kiểm định giọng máy Android ở nhánh fallback; foreground service nếu muốn nghe nền. **Cần máy Android thật để test.**

2. **Background / lock-screen controls (mức đầy đủ)** — chưa làm
   - Hiện đã chốt và ship **mức nhẹ** (nghe khi khóa màn, không remote controls).
   - **Mức đầy đủ:** Now Playing / lock-screen (bìa, tên chương). `expo-audio` không cấp remote controls → cần media-session library (vd `react-native-track-player`) + dev build, có thể viết lại pipeline phát.

3. **Chi tiết nhỏ (tùy chọn)**
   - Cho reader thường (không phải admin) tự chọn giọng (giờ voice picker chỉ admin).
   - Mở rộng `detectSpeechLanguage` ngoài vi/en cho fallback giọng máy.
   - Tinh chỉnh thêm `_dialogue_prosody`; mở rộng `_SPELLED_ACRONYMS` khi gặp viết tắt mới.
   - Fallback `expo-speech` khi nền có thể bị iOS cắt — chấp nhận; ưu tiên cloud path.

---

*Cập nhật cùng codebase trên nhánh `main` của repo Read.*
