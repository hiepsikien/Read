# Illustrated Audio Series — Nghiên cứu tiền khả thi & kế hoạch

> Trạng thái: **nghiên cứu / kế hoạch** — chưa implement code sản phẩm.  
> Cập nhật: 2026-07-31  
> Liên quan: [PROJECT.md](./PROJECT.md) (§4b TTS, publisher, Gemini)

---

## 1. Mục tiêu sản phẩm

Biến sách (đã có trên Read) + audio narration thành **series video minh họa**:

- Audio kể chuyện (TTS cloud có sẵn, hoặc mở rộng sau)
- Chuỗi ảnh minh họa khớp từng cảnh
- (Tuỳ chọn) âm thanh ngoại cảnh / Foley gen bằng AI
- Xuất MP4 đăng Shorts / Reels / TikTok / YouTube

Không phải clip promo ngắn; là **series tập có hình**, kiểu illustrated audiobook.

---

## 2. Quyết định đã chốt

| # | Hạng mục | Quyết định |
|---|----------|------------|
| 1 | Nguồn sách | Chỉ sách **đã có trên Read**, publisher chọn. Pilot **một cuốn trước**. |
| 2 | Image gen | **Flux** (API chính thức). **Không** Midjourney trong product. |
| 3 | UI trước | **Web** (`/publisher/[id]` — tab Audio Series). |
| 4 | Mức tự động | **Auto pipeline** + **man-in-the-loop review** (ảnh + video) trước export cuối. |
| 5 | Chi phí | Chưa tối ưu ở phase đầu. |
| 6 | Pilot nội dung | ***Đại Lộ Đại Dương* — Phần 1 / S1E1**. |
| 7 | SFX / ngoại cảnh | Có — gen AI được; lớp riêng dưới narration. |
| 8 | Social auto-post | **Không** trong MVP / pilot. |

### Midjourney — ghi chú

- Midjourney **không có API public chính thức** (chỉ web/Discord; enterprise nếu có thì invitation-only).
- Wrapper bên thứ ba dễ vi phạm ToS / ban account → **không nhúng vào Read**.
- Thay bằng Flux qua fal.ai / Replicate / BFL.

---

## 3. Pilot: *Đại Lộ Đại Dương* S1E1

### Vì sao phù hợp

Trong repo đã có dấu vết rõ:

- `apps/api/scripts/load_book.py` — load `S1E1C1 - Đại Lộ Đại Dương.docx` + glossary `NHÂN VẬT.docx`
- Glossary theo episode (`S1E1: GIÔNG BÃO KINH THÀNH`) — Vasco da Gama, Mạc Đăng Dung, Lê Thánh Tông, Afonso de Albuquerque…
- TTS đã xử lý **kịch bản hội thoại** (SSML, ALL CAPS tên nhân vật, stage direction `*(…)*`)
- `infer_episode_key("S1E1C1 — …")` → lọc đúng S1E1

### Phạm vi pilot đề xuất (chặt)

Không làm cả S1E1 dài ngay lần đầu.

1. PoC / tập đầu: **1 reading segment / 1 cảnh mở (~3–8 phút audio)**  
2. Chứng minh pipeline end-to-end  
3. Sau đó mới chạy hết chapters thuộc S1E1  

Cảnh mẫu trong fixture/test: *Bờ biển Calicut*, *Bước chân trên cát Calicut*, boong caravel, cận cảnh đại bác, kinh thành / giông bão.

---

## 4. Luồng sản phẩm (auto + review)

```
Chọn book trên Read (pilot: Đại Lộ Đại Dương)
        ↓
Lọc chapters thuộc S1E1 (hoặc 1 segment pilot)
        ↓
[Auto] Concat TTS segments → audio từng tập
[Auto] Gemini → storyboard (shots + image prompts + timestamp)
[Auto] Flux → character sheets + ảnh minh họa
[Auto] (Tuỳ phase) AI SFX → ambience bed + Foley cues
        ↓
[Review] Publisher duyệt từng tập / từng ảnh / từng cue SFX
         · Approve | Regenerate | Sửa prompt | Upload thay
        ↓
[Auto] Render MP4 (ffmpeg) chỉ cho tập đã approve
[Review] Preview video → Approve export / Re-render
        ↓
Download MP4 (9:16; tuỳ chọn 16:9)
```

**Không** auto đăng TikTok / YouTube / Reels ở pilot.

---

## 5. Kiến trúc kỹ thuật (đề xuất)

### Tận dụng sẵn có

| Thành phần | Nơi trong repo |
|------------|----------------|
| Chapter / smart-split | `apps/api/app/chapters.py`, model `Chapter` |
| TTS + cache MP3 | `apps/api/app/tts.py`, `routers/tts.py` |
| Gemini text | `apps/api/app/gemini.py` |
| Glossary nhân vật theo episode | `apps/api/app/glossary.py` |
| Normalize ảnh (Pillow) | `covers.py`, `media.py` |
| Publisher web | `apps/web/src/app/publisher/[id]/page.tsx` |

### Còn thiếu

| Thành phần | Ghi chú |
|------------|---------|
| Models `AudioSeries` / `Episode` / `Shot` / `ExportArtifact` | Migration mới |
| Job async (không render sync trong HTTP) | DB status + worker |
| Concat audio episode | ffmpeg từ TTS cache |
| Storyboard JSON pipeline | Gemini `responseMimeType: application/json` |
| Flux client | fal.ai khuyến nghị; abstraction `ImageProvider` |
| Character bible + reference images | Từ glossary S1E1 |
| SFX provider + mix | ElevenLabs SFX / Stable Audio / fal audio; mix ffmpeg |
| Video render | ffmpeg Ken Burns + burn-in captions |
| UI Web Series + review gallery | Tab mới trên publisher book detail |

### Storage gợi ý

```
uploads/series/{book_id}/{series_id}/
  episodes/{episode_id}/
    audio.mp3
    storyboard.json
    characters/{slug}.jpg
    shots/{n}.jpg
    sfx/{cue_id}.wav
    exports/episode_9x16.mp4
    exports/episode_16x9.mp4
```

### Model dữ liệu (phác thảo)

```
AudioSeries
  book_id, title, aspect_ratio (9:16|16:9),
  art_style, character_bible,
  voice_config, status (draft|generating|ready|failed)

AudioSeriesEpisode
  series_id, position, source_chapter_ids[],
  title, audio_path, duration_ms,
  status (pending|storyboard|images|sfx|rendering|ready|failed)

EpisodeShot
  episode_id, position, start_ms, end_ms,
  narration_excerpt, image_prompt, image_path,
  status (pending|ready|approved|rejected)

EpisodeSfxCue  (phase SFX)
  episode_id, at_ms, end_ms, layer (ambience|foley|event),
  prompt, gain_db, loop, file_path, status

ExportArtifact
  episode_id, format, path, width, height
```

---

## 6. Image stack — Flux

| Việc | Model gợi ý | Ghi chú |
|------|-------------|---------|
| Draft / preview nhanh | FLUX.1 Schnell | ~$0.003/ảnh |
| Final minh họa | FLUX.1 Pro / 1.1 Pro | ~$0.04–0.06/ảnh |
| Giữ mặt nhân vật khi đổi cảnh | **FLUX Kontext Pro** | image + text reference |

### Chiến lược nhất quán nhân vật (bắt buộc)

1. Từ glossary S1E1 → chọn 3–5 nhân vật thường gặp trong đoạn pilot  
2. Gen **character sheet** 1 lần / người (Pro) → khóa reference  
3. Shot có nhân vật → **Kontext** (ref + “cùng người, cảnh mới…”)  
4. Shot không người / panorama → Pro/Schnell + cùng style prompt  

Provider đề xuất pilot: **fal.ai** (cùng chỗ có thể có audio gen sau).

---

## 7. Audio narration + SFX

### Narration

- Mặc định: **Google Cloud TTS** đã có (`prepare_segments`, cache theo paragraph)  
- Concat thành 1 file / tập  
- Timeline bám ranh giới TTS segment (MVP không cần forced aligner)

### SFX / ngoại cảnh (AI)

Narration **không** thay bằng SFX. Ba lớp:

1. Narration (TTS)  
2. Ambience bed (nền)  
3. Foley / event ngắn  

| Lớp | Gain gợi ý |
|-----|------------|
| Ambience bed | −20 → −24 dB dưới narration |
| Foley ngắn | −12 → −16 dB |
| Sự kiện mạnh (đại bác, sét) | −8 → −12 dB rồi duck |
| Không gen | Tiếng nói nhân vật; đám đông nói rõ lời |

Tool/API ứng viên: ElevenLabs Sound Effects, Stable Audio, endpoint audio trên fal/Replicate.

### Rule gắn cue từ manuscript

1. Heading địa điểm / thời gian (`BỜ BIỂN…`, `TRÊN BOONG…`) → **bed**  
2. `*(…)*` stage direction có môi trường → **foley nhẹ** hoặc chỉnh bed  
3. `CẬN CẢNH:` / hành động vật lý mạnh → **event**  
4. Sắc thái thoại (`Thì thầm`, `Hét`) → chỉ TTS/prosody + duck — **không** SFX giọng  

---

## 8. Mapping SFX mẫu — S1E1

Prompt SFX viết **tiếng Anh** (API hiểu tốt hơn). Cột tín hiệu = thứ Gemini bắt từ sách.

### A. Ambience bed theo địa điểm

| Tín hiệu trong sách | Prompt SFX mẫu |
|---|---|
| `Bờ biển Calicut` · `Bước chân trên cát Calicut` | `tropical indian ocean shoreline, gentle waves on wet sand, distant seabirds, warm humid air, no music, no voices` |
| `Trên boong tàu caravel` · `mũi soái hạm` · đại dương | `wooden sailing ship deck ambience, creaking timbers, wind in canvas sails, ocean wash against hull, 16th century caravel, no music, no voices` |
| Giông bão trên biển | `violent monsoon storm at sea, heavy rain on deck, howling wind, crashing waves against wooden hull, distant thunder, no music` |
| `Giông bão kinh thành` / cung đình Đại Việt | `pre-modern asian capital city under storm, rain on tiled roofs, distant thunder, sparse wooden shutters, humid night, no music, no modern sounds` |
| `Ngoại vi Tây Đô` · di dân · vùng ven | `rural outskirts of historic capital, night insects, distant dogs, soft wind through bamboo, faint water, no traffic, no music` |
| Cung vua · ngự trên ngai | `quiet royal palace hall interior, soft echo, distant courtyard birds, silk robes rustle barely audible, incense calm, no music, no voices` |
| Cảng / cập bến | `busy 16th century harbor, creaking ships, water lapping piers, distant hammers, gulls, crowd murmur without intelligible speech` |

### B. Foley / sự kiện ngắn

| Tín hiệu trong sách | Prompt SFX mẫu |
|---|---|
| Bước chân trên cát / xuống nước | `bare feet stepping onto wet beach sand, soft squish, light splash, close mic` |
| `*(Ông nhìn ra đại dương…)*` | `ocean wind gust across open deck, canvas flap once` |
| `CẬN CẢNH: … đại bác được kích nổ` | `single naval cannon firing from wooden warship, sharp boom, brief ringing echo, gunpowder whoosh, no music` |
| Cửa cung / nội thị vào | `heavy wooden palace door opening slowly, soft latch, cloth footsteps on stone` |
| Sóng đập mạn cao trào | `large wave slamming wooden hull, spray, brief groan of timber` |
| Chuông tàu (nếu có trong MS) | `single bronze ship bell ring, nautical, short decay` |
| Mưa trên mái ngói kinh thành | `heavy rain hitting traditional clay roof tiles, runoff gutters, indoor shelter POV` |

### C. Chuỗi cảnh pilot gợi ý (Calicut → boong → cao trào)

| # | Beat | Bed | Foley/Event |
|---|------|-----|-------------|
| 1 | Title / bước chân trên cát | Shoreline Calicut | footsteps on wet sand |
| 2 | Vasco / mở lịch sử | Shoreline tiếp | — |
| 3 | Lên boong / soái hạm | Crossfade → ship deck (~1.5s) | sail wind gust |
| 4 | Thoại thư ký thì thầm | Ship deck | duck bed −3 dB (không gen tiếng thì thầm) |
| 5 | Cận cảnh đại bác | Ship deck | cannon fire |
| 6 | Cắt kinh thành / bão | Crossfade → storm capital | thunder distant |

### D. Không gen cho S1E1

- Xe cộ, điện thoại, synth hiện đại  
- Epic orchestral át lời (nhạc phase sau, nếu có ≤ −28 dB)  
- Đám đông nói rõ câu  
- Spam đại bác mỗi vài giây  

### E. JSON cue gợi ý

```json
{
  "at_ms": 0,
  "end_ms": 45000,
  "layer": "ambience",
  "prompt": "tropical indian ocean shoreline, gentle waves on wet sand, distant seabirds, warm humid air, no music, no voices",
  "gain_db": -22,
  "loop": true
}
```

---

## 9. Ước lượng khối lượng (tham khảo — chưa tối ưu cost)

Giả sử **1 tập pilot ≈ 5 phút**:

| Hạng mục | Ước lượng |
|----------|-----------|
| Số shot (~20s/ảnh) | ~15 |
| Regen khi review (×1.5–2) | ~25–30 lần gen |
| Character sheets | ~4–5 ảnh |
| Ballpark ảnh (Pro + Kontext) | khoảng vài USD / tập |
| TTS | Cache sẵn hoặc synthesize đoạn ngắn (Neural2 ~$16/1M ký tự) |
| Storyboard Gemini | Không đáng kể |
| Render ffmpeg | $0 API (CPU) |

Pilot SFX: **3 bed** (bãi biển → boong → bão/kinh thành) + **2–3 Foley** là đủ chứng minh tai nghe.

---

## 10. Rủi ro & giảm nhẹ

| Rủi ro | Mức | Giảm nhẹ |
|--------|-----|----------|
| Nhân vật AI đổi mặt giữa shot | Cao | Character sheet + Flux Kontext + review |
| Trang phục / sử liệu lệch | Cao | Style bible lịch sử + man-in-the-loop |
| Nhiều người trong 1 khung | Cao | Ưu tiên 1–2 người; wide shot khi đám đông |
| Timestamp audio ↔ ảnh lệch | Trung | Bám TTS paragraph boundaries |
| ffmpeg trên deploy | Trung | Docker image + CI `ffmpeg -version` |
| SFX át lời / anachronism | Trung | Gain table + ducking + review |
| S1E1 quá dài nếu full ngay | Trung | Pilot = 1 cảnh/segment trước |

---

## 11. Phases triển khai (khi được phép code)

### Phase 0 — PoC ngoài app (tay, không merge product)

- 1 chapter/cảnh S1E1 + TTS MP3  
- Gemini viết 8–12 shot  
- Flux Pro + 1–2 Kontext với 1 nhân vật  
- 3 bed + 2–3 Foley mix thử  
- CapCut hoặc ffmpeg ghép 60–90s (hoặc full đoạn ngắn)  
→ **Go / No-go** chất lượng trước khi viết backend  

### Phase A — Foundation trong Read

- Models + migration + API CRUD series/episodes  
- Job concat TTS → MP3 tập  
- Storyboard Gemini → lưu shots (chưa Flux)  
- UI web: tạo series, xem script/storyboard, tải MP3  

### Phase B — Flux + review

- `ImageProvider` (fal Flux)  
- Character bible + gen sheets  
- Gallery approve / regen / sửa prompt / upload thay  

### Phase C — Video export

- Worker + ffmpeg (Ken Burns, captions)  
- Render 9:16 (+ optional 16:9) sau khi tập approved  
- Download ZIP / file  

### Phase D — SFX + polish

- SFX cues từ storyboard  
- Mix + ducking  
- Intro/outro brand Read  
- (Sau) caption social gợi ý; **chưa** auto-post  

### Definition of done — pilot

Một tập S1E1 (hoặc highlight 3–8 phút) có:

- MP4 9:16  
- Nhân vật nhận ra được qua review  
- Ambience/Foley không át lời  
- Tải về từ web publisher  

---

## 12. Việc chuẩn bị trước khi code

1. Book *Đại Lộ Đại Dương* đã load/publish trên môi trường dùng thử  
2. Chọn **đoạn pilot cụ thể** trong S1E1 (chapter ID / tiêu đề cảnh)  
3. Tài khoản **fal.ai** (Flux; sau có thể dùng thêm audio)  
4. Chốt **art style** hướng: cinematic realistic / tranh minh họa lịch sử / ink wash…  
5. (PoC) Đoạn DOCX + audio TTS của đúng cảnh  

---

## 13. Cố ý không làm trong MVP / pilot

- Auto đăng mạng xã hội  
- Editor timeline đầy đủ kiểu CapCut trong app  
- Midjourney / Discord automation  
- Web reader TTS (lệnh scope; API đã có, mobile đã phát)  
- Tối ưu chi phí sớm  

---

## 14. Kết luận nghiên cứu

| Hạng mục | Đánh giá |
|----------|----------|
| Khả thi với stack Read | **Có** — TTS, split, glossary, Gemini text là nền vững |
| Flux thay Midjourney | **Đúng** cho product có API |
| Pilot S1E1 | **Rất phù hợp** dữ liệu/repo hiện có |
| SFX AI ngoại cảnh | **Có** — bắt đầu bed theo địa điểm + ít Foley |
| Rủi ro lớn nhất | Nhất quán nhân vật → Kontext + review |
| Hướng đi | PoC tay Phase 0 → A → B → C → D |

---

*Tài liệu này tổng hợp thảo luận kế hoạch Illustrated Audio Series (2026-07-31). Khi implement, cập nhật lại trạng thái và link PR/commit tương ứng.*
