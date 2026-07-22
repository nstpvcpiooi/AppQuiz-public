# Âm thanh

## Cấu trúc thư mục

| Thư mục | Dùng khi | Số file hiện tại |
|---------|----------|------------------|
| `correct/` | Trả lời đúng (practice) | 11 |
| `incorrect/` | Trả lời sai (practice) | 12 |
| `result/` | Hoàn thành bài quiz | 4 |

## Quy ước đặt tên

Đặt tên theo pattern: `{folder}-01.mp3`, `{folder}-02.mp3`, ...

Ví dụ trong `correct/`:
- `correct-01.mp3`
- `correct-02.mp3`
- `correct-03.mp3`

## Thêm file mới

1. Copy file vào đúng thư mục, đặt tên tiếp theo (vd. `correct-12.mp3`)
2. Mở `js/sounds.config.js`, tăng số count:
   ```javascript
   correct: soundPaths('correct', 12),  // was 11
   ```
3. Làm mới trang

## Ghi chú

- Hỗ trợ MP3, WAV, OGG
- `volume` trong config: 0.0 – 1.0
- File không tồn tại → dùng âm thanh mặc định (Web Audio)
- Nút tắt/bật loa áp dụng cho tất cả loại âm thanh

Thêm file mới sau này
Copy vào đúng thư mục, đặt tên tiếp theo (vd. correct-12.mp3)
Tăng count trong config: soundPaths('correct', 12)
Làm mới trang (Ctrl+F5) để nghe thử.
