/**
 * Cấu hình âm thanh
 *
 * Thư mục:
 *   assets/sounds/correct/   — trả lời đúng (practice)
 *   assets/sounds/incorrect/ — trả lời sai (practice)
 *   assets/sounds/result/    — hoàn thành bài quiz
 *
 * Quy ước đặt tên file: {folder}-01.mp3, {folder}-02.mp3, ...
 * Mỗi lần phát chọn ngẫu nhiên 1 file trong danh sách.
 * Khi thêm file mới, tăng số lượng (count) tương ứng bên dưới.
 */
function soundPaths(folder, count) {
    return Array.from({ length: count }, (_, i) => {
        const num = String(i + 1).padStart(2, '0');
        return `assets/sounds/${folder}/${folder}-${num}.mp3`;
    });
}

export const SOUND_CONFIG = {
    correct: soundPaths('correct', 11),
    incorrect: soundPaths('incorrect', 12),
    result: soundPaths('result', 3),
    volume: 0.7
};
