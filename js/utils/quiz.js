import { htmlToPlainText } from './validation.js';

export function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

export function resolveCorrectAnswer(q) {
    const raw = String(q.correctAnswer ?? '').trim();
    if (!raw) return '';
    if (!q.options?.length) return raw;
    if (/^[A-D]$/i.test(raw)) {
        const idx = raw.toUpperCase().charCodeAt(0) - 65;
        return q.options[idx] ?? raw;
    }
    const match = q.options.find(opt => String(opt).toLowerCase() === raw.toLowerCase());
    return match ?? raw;
}

export function getCorrectOptionIndex(q) {
    const raw = String(q.correctAnswer ?? '').trim();
    if (!q.options?.length) return -1;
    if (/^[A-D]$/i.test(raw)) {
        const idx = raw.toUpperCase().charCodeAt(0) - 65;
        return idx >= 0 && idx < q.options.length ? idx : -1;
    }
    const plainRaw = htmlToPlainText(raw).toLowerCase();
    return q.options.findIndex((opt) => htmlToPlainText(opt).toLowerCase() === plainRaw);
}

export function getQuizCreatedMillis(quiz) {
    if (quiz.createdAt?.toMillis) return quiz.createdAt.toMillis();
    if (quiz.createdAt?.seconds) return quiz.createdAt.seconds * 1000;
    return 0;
}
