# 📘 eLearn — Website luyện thi tiếng Anh trực tuyến

Ứng dụng web hỗ trợ học tiếng Anh dành cho học sinh THPT Việt Nam, xây dựng bằng vanilla JavaScript và Firebase. Giáo viên tạo và quản lý đề thi; học sinh làm bài, xem kết quả, tra từ điển và học flashcard.

## 🌐 Website demo

Truy cập bản demo tại: **https://nstpvcpiooi.github.io/AppQuiz**

| Vai trò | Tài khoản | Mật khẩu |
|---------|-----------|-----------|
| 🎓 Học sinh | `demo` | *(không có)* |
| 👨‍🏫 Giáo viên | `demo@gmail.com` | `demo123` |

> **Học sinh**: Nhập username `demo` rồi nhấn **Log in**.
>
> **Giáo viên**: Nhấn **I am a teacher**, nhập email và mật khẩu ở trên.

## ✨ Tính năng

### 🎓 Học sinh

- **Làm bài quiz** — Chế độ Luyện tập (có phản hồi ngay) hoặc Thi thử (có đếm giờ), kèm hiệu ứng âm thanh
- **Đa dạng dạng câu hỏi** — Trắc nghiệm, phát âm (âm & trọng âm), đọc hiểu (trắc nghiệm & điền khuyết)
- **Từ điển tích hợp** — Tra từ Anh–Việt ngay trong app (nguồn Laban)
- **Flashcard** — Tạo bộ thẻ, học và ôn tập
- **Xem lại bài** — Xem chi tiết kết quả các bài đã làm

### 👨‍🏫 Giáo viên (Admin)

- **Soạn đề** — Trình soạn thảo rich text (Quill.js), hỗ trợ đoạn văn đọc hiểu và chia nhóm câu hỏi (sub-quiz)
- **Quản lý học sinh** — Tạo tài khoản học sinh, theo dõi tiến độ
- **Bảng đánh giá** — Xem kết quả, thống kê và hiệu suất từng học sinh
- **Quản lý flashcard** — Tạo và sắp xếp bộ thẻ cho học sinh
- **Phân quyền đề thi** — Giao đề cho tất cả, chỉ học sinh cụ thể, hoặc ẩn đề
- **Xuất đề** — Export quiz dưới dạng JSON

## 🛠 Công nghệ sử dụng

| Thành phần | Công nghệ |
|-----------|-----------|
| Frontend | HTML / CSS / JavaScript |
| Backend | [Firebase](https://firebase.google.com/) (Firestore, Auth, Cloud Functions) |
| Từ điển | Laban.vn (proxy qua Cloud Functions / server local) |
| Phát âm | Azure Speech Services, Merriam-Webster Audio |
| AI | Google Gemini API |
