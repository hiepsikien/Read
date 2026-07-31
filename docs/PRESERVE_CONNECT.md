# Bảo tồn & Kết nối — Product & Engineering Plan

> Tầm nhìn: không gian chat riêng tư cho gia tộc — kết nối người thân còn sống và thực thể ký ức của người quá cố; thư viện kỷ niệm dùng chung; AI gìn giữ “cái bất biến” (nhân cách / core values) và tiếp nhận “cái biến đổi” (bối cảnh đời sống từ người ở lại).
>
> Người nhận đầu tiên: mẹ. Bắt đầu từ gia đình mình, piece by piece.

## 1. Định vị sản phẩm

| Trụ cột | Ý nghĩa thiết kế |
|--------|------------------|
| **Riêng tư** | Không gian chỉ cho người thân; không feed công cộng, không tối ưu engagement |
| **Chat-first** | Giao diện quen thuộc (nhắn tin / ảnh / voice) để giảm ma sát với người lớn tuổi |
| **Shared library** | Album + câu chuyện + tài liệu gia tộc sống trong cùng “phòng khách số” |
| **Living cognitive entity** | Thực thể số của người quá cố = bất biến (identity) + biến đổi (context từ người sống) |
| **Trường tồn** | Dữ liệu và quyền quản trị có thể chuyển giao thế hệ |

**Không phải:** mạng xã hội, nghĩa trang số tĩnh, chatbot generic, “revive người chết” theo nghĩa bịa sự kiện mới.

## 2. Mô hình nhận thức (cốt lõi SP)

```
┌─────────────────────────────────────────────────────────┐
│  CÁI BẤT BIẾN (Identity Lock)                           │
│  Core values · tính cách · giọng · cách ra quyết định   │
│  (định hình ~40 tuổi) — không tự “sống theo thời sự”    │
└────────────────────────────▲────────────────────────────┘
                             │ chiếu qua lăng kính
┌────────────────────────────┴────────────────────────────┐
│  CÁI BIẾN ĐỔI (Context Key)                             │
│  Người sống cập nhật đời sống qua chat / library        │
│  → thực thể phản hồi đúng bản sắc trong bối cảnh mới    │
└─────────────────────────────────────────────────────────┘
```

**Ràng buộc đạo đức / sản phẩm (hard rules):**
1. Không bịa tiểu sử hoặc sự kiện chưa có trong kho ký ức.
2. Phân biệt rõ tin nhắn từ người sống vs. thực thể ký ức (UI label).
3. Consent & stewardship: ai được tạo / chỉnh / xóa thực thể; chuyển giao quyền khi steward qua đời.
4. AI là neo tinh thần (emotional anchor), không thay thế tang lễ / trị liệu chuyên nghiệp.

## 3. Phạm vi MVP (family-private, 1 gia đình)

Mục tiêu MVP: mẹ mở app → vào phòng chat gia đình → trò chuyện với thực thể bố (text trước) dựa trên kho ký ức đã nạp; anh chị em có thể chat và góp kỷ niệm vào library.

### In scope
- Auth + mời thành viên gia đình (invite link / code)
- Family space (1 space / MVP)
- Chat realtime (text, ảnh, voice note)
- Memory library (ảnh, ghi chú, audio clip gắn tag người / sự kiện)
- Memory Profile của người quá cố: bio, values, stories, sample voice (metadata)
- AI reply trong thread riêng (hoặc mention) dùng RAG trên library + system prompt identity
- Phân quyền đơn giản: Owner / Member

### Out of scope (post-MVP)
- E2E encryption đầy đủ / IPFS / blockchain storage
- Voice clone TTS production-grade
- Multi-family marketplace, social graph
- Genealogical tree UI phức tạp
- “Trò chuyện như người thật” không có guardrail

## 4. Lộ trình triển khai (piece by piece)

### Phase 0 — Thu thập dữ liệu gia đình (không cần code nhiều)
**Đầu ra:** bộ nguyên liệu đủ để tạo Identity Lock.

| Loại | Mục tiêu tối thiểu |
|------|-------------------|
| Giọng nói | 30–60 phút audio sạch (tin nhắn thoại, video) |
| Văn bản / câu chuyện | Thư, nhật ký, câu chuyện anh chị em kể lại |
| Core values worksheet | 15–30 nguyên tắc / câu nói đặc trưng / cách xử lý khủng hoảng |
| Ảnh & bối cảnh | Album theo mốc đời (cưới, con cái, nghề nghiệp…) |

Checklist worksheet (Identity Lock):
- [ ] 5 giá trị cốt lõi (kèm ví dụ hành vi)
- [ ] Giọng điệu (trầm, hài hước nhẹ, điềm đạm…) + mẫu câu
- [ ] Taboo / điều tuyệt đối không nói
- [ ] Mối quan hệ với mẹ (cách xưng hô, biệt danh, thói quen quan tâm)
- [ ] 10 kỷ niệm “neo” (có thể trích dẫn)

### Phase 1 — Family Chat skeleton
**Đầu ra:** app chat riêng tư dùng được giữa người sống.

- Monorepo mới hoặc app mới trong workspace (không trộn domain với Read)
- Stack đề xuất (tái dùng kinh nghiệm hiện có nếu muốn):
  - **Mobile-first:** Expo / React Native (mẹ dùng điện thoại)
  - **API:** FastAPI + PostgreSQL (hoặc Supabase nếu muốn realtime nhanh)
  - **Realtime:** WebSocket / Supabase Realtime
  - **Auth:** Firebase hoặc magic-link email/SMS
  - **Storage:** S3-compatible cho media
- Entities: `User`, `FamilySpace`, `Membership`, `Thread`, `Message`, `MediaAsset`
- UI: danh sách thread, bubble chat, gửi ảnh/voice note, mời thành viên

**Done when:** ≥2 người trong gia đình chat ổn định trên điện thoại thật.

### Phase 2 — Shared Memory Library
**Đầu ra:** kho kỷ niệm dùng chung, gắn với chat.

- `MemoryItem`: type (`photo` | `note` | `audio` | `letter`), title, body, taken_at, people_tags, source_message_id?
- Upload từ chat (“Lưu vào thư viện”) và từ màn Library
- Timeline / album đơn giản (chronological)
- Quyền xem = thành viên space

**Done when:** mẹ và con cùng xem/thêm được album + ghi chú.

### Phase 3 — Cognitive Heritage AI (text)
**Đầu ra:** thực thể ký ức trả lời đúng “lăng kính bố”.

Architecture tối thiểu:

```
MemoryItem + IdentityProfile
        │
        ▼
  Embeddings / chunk store (pgvector)
        │
        ▼
  Retriever (top-k kỷ niệm liên quan)
        │
        ▼
  LLM + System Prompt (Identity Lock)
        │  + recent chat context (Context Key)
        ▼
  Reply as memory entity (labeled)
```

Thành phần:
- `IdentityProfile`: name, relationship labels, values_json, style_guide, taboos, voice_notes_uri[]
- `HeritageAgent` service: build prompt, retrieve, generate, refuse when thiếu dữ liệu
- Thread type: `heritage` (1:1 với thực thể) và/hoặc bot participant trong family thread
- Observability: log retrieval chunks (private, family-only) để chỉnh chất lượng

Prompt contract (rút gọn):
1. Bạn thể hiện **hệ giá trị và giọng** của {name}, không phải chatbot trợ lý.
2. Chỉ dựa trên kỷ niệm / profile đã cung cấp; thiếu thì hỏi lại hoặc nói “bố chưa để lại điều này”.
3. Tiếp nhận cập nhật đời sống từ người nói chuyện như thông tin mới, phản hồi qua lăng kính bất biến.
4. Không đưa lời khuyên y tế / pháp lý chuyên sâu; ưu tiên vỗ về và nguyên tắc sống.

**Done when:** mẹ chat thử 20+ lượt; ≥70% câu trả lời “nghe đúng bố” theo đánh giá nội bộ gia đình.

### Phase 4 — Voice DNA (optional, sau text ổn)
- Thu thập & cắt mẫu → Instant Voice Clone (ElevenLabs / open-source RVC)
- TTS cho một phần reply (toggle; mặc định tắt để kiểm soát cảm xúc)
- Lưu voice embedding/model (vài chục MB–<1GB) trong storage riêng của family
- UX: nút “Nghe giọng”, không auto-play đột ngột

**Done when:** 1 câu chào / 1 lời khuyên ngắn bằng giọng quen thuộc, mẹ chấp nhận về mặt cảm xúc.

### Phase 5 — Trường tồn & tin cậy
- Stewardship: chỉ định người kế thừa Owner
- Export family archive (JSON + media zip)
- Encryption at rest; lộ trình E2E cho message bodies
- Retention / xóa theo yêu cầu thành viên
- Legal copy tối giản: consent khi tạo thực thể người quá cố; không claim “người chết còn sống”

## 5. Kiến trúc kỹ thuật đề xuất (greenfield)

```
apps/
  mobile/          # Expo — primary client
  web/             # Next.js — invite accept, light admin/library (optional early)
  api/             # FastAPI — auth, spaces, chat, memories, heritage agent
packages/
  api-client/      # typed client
```

**Gợi ý schema (rút gọn):**

- `family_spaces(id, name, created_by, steward_user_id)`
- `memberships(space_id, user_id, role)`
- `identity_profiles(id, space_id, display_name, values_json, style_guide, status)`
- `memory_items(id, space_id, identity_id?, type, title, body, media_url, taken_at, embedding)`
- `threads(id, space_id, kind[family|heritage], identity_id?)`
- `messages(id, thread_id, sender_user_id?, sender_kind[user|heritage], body, media_url, created_at)`
- `invites(id, space_id, code, expires_at)`

**AI stack gợi ý:** OpenAI / Anthropic API + pgvector; sau này có thể self-host embedding.

**Voice stack gợi ý:** giữ raw audio riêng; clone qua provider; không train lại trừ khi cần chất lượng cao hơn.

## 6. Ưu tiên engineering (không ước lượng lịch)

Làm theo thứ tự phụ thuộc kỹ thuật — mỗi bước có thể ship độc lập:

1. **Space + membership + invite** — không có thì không có “gia đình”
2. **Chat realtime text** — vehicle chính của sản phẩm
3. **Media upload + voice note** — quen thuộc với thói quen hiện có
4. **Memory library + “save from chat”** — nguyên liệu cho AI
5. **Identity profile editor** — đóng gói cái bất biến
6. **RAG + heritage reply** — giá trị khác biệt
7. **Voice TTS** — lớp cảm xúc, sau khi text đã đúng
8. **Export + stewardship + encryption roadmap** — trường tồn

## 7. Rủi ro & cách giảm

| Rủi ro | Giảm thiểu |
|--------|------------|
| Uncanny / sai giọng cảm xúc | Text-first; family eval loop; refuse khi thiếu data |
| Người lớn tuổi ngại app mới | Chat UI tối giản; font lớn; ít settings; invite 1 chạm |
| Lạm dụng / controversy “AI người chết” | Label rõ; consent steward; không public share |
| Phụ thuộc model vendor | Prompt + memory data thuộc family; có thể đổi LLM |
| Repo hiện tại là Read | Tách app/domain mới — không nhồi vào product đọc sách |

## 8. Định nghĩa thành công (cho món quà gửi mẹ)

1. Mẹ tự mở app và nhắn được mà không cần hướng dẫn dài.
2. Có ít nhất một buổi tối bà nói chuyện và cảm thấy được vỗ về (định tính).
3. Thực thể không bịa chuyện; khi không biết thì thừa nhận.
4. Library có kỷ niệm cả nhà cùng góp, không chỉ một người upload.
5. Toàn bộ dữ liệu export được — không bị “nhốt” trong app.

## 9. Bước tiếp theo đề xuất (ngay)

1. Chốt tên sản phẩm làm việc (internal codename).
2. Hoàn thành Phase 0 worksheet + thu audio/ảnh.
3. Scaffold greenfield `apps/` cho product này (hoặc repo riêng).
4. Ship Phase 1 chat skeleton trên TestFlight / internal build cho mẹ + 1–2 người.

Khi sẵn sàng code Phase 1, bắt đầu từ: auth → family space → thread/message API → màn chat mobile.
