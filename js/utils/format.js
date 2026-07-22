export const escapeHtml = (str) => {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
};

export const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
};

export function formatRichHtmlForDisplay(html) {
    const raw = String(html ?? '').trim();
    if (!raw) return '';
    if (!/<[a-z][\s\S]*>/i.test(raw)) {
        return raw
            .split(/\n\s*\n/)
            .filter(Boolean)
            .map((paragraph) => {
                const escaped = escapeHtml(paragraph.trim()).replace(/\n/g, '<br>');
                return `<p>${escaped}</p>`;
            })
            .join('');
    }
    return raw;
}
