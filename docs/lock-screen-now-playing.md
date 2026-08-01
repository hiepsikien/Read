# Lock-screen Now Playing (mức B)

> **Trạng thái:** đã implement trong code — verify trên **iPhone thật**.  
> **Phụ thuộc:** mức A (nghe nền khi khóa màn trên iOS).  
> **Liên quan:** [`docs/PROJECT.md`](PROJECT.md) § Hoàn thiện audio.

## Mục tiêu

Khi đang nghe narration (cloud TTS), iOS hiện **Now Playing / Control Center** với:

- Tên chương + tên sách (+ bìa nếu có)
- Remote **Play / Pause**
- Audio tiếp tục khi khóa màn; nếu iOS tạm dừng session thì **tự resume** khi mở lại / vào background

## Quyết định đã chốt

| Hạng mục | Quyết định |
|----------|------------|
| Thư viện | Giữ **`expo-audio` ~1.1.1** — `setActiveForLockScreen` / `updateLockScreenMetadata` / `clearLockScreenControls` |
| Không dùng | `react-native-track-player` |
| Platform | **iOS** + cloud narration path |
| Seek ±10s | **Tắt** (duration per-segment) |
| Offline `expo-speech` | Không bắt buộc Now Playing |
| Test | **Máy thật** + rebuild Read Dev |

## Fix quan trọng (audio dừng khi lock)

Triệu chứng: khóa màn → hết tiếng; mở lại vẫn thấy nút Pause; phải Stop rồi Play.

Nguyên nhân thường gặp: không có Now Playing ổn định → iOS suspend AVPlayer khi lock, trong khi UI vẫn `speaking`.

Cách xử lý trong `use-ios-narration`:

1. Activate Now Playing **sau** `play()` mỗi segment
2. `AppState` `background` / `active` → nếu vẫn `speaking` mà player không chạy thì `play()` lại (hoặc sang segment kế nếu gần hết)
3. Chỉ đánh dấu `paused` khi user / remote pause có chủ đích (`intentionalPauseRef`)

## Checklist test (device thật)

1. Play cloud narration → khóa màn: vẫn nghe được; thấy title/bìa trên lock-screen.
2. Pause / Play từ Control Center → UI in-app đồng bộ.
3. Nếu từng bị im tiếng khi lock: mở máy lại phải **tự có tiếng** (không cần Stop → Play).
4. Stop / Back khỏi reader → Now Playing biến mất.
5. Offline voice fallback → không crash.
