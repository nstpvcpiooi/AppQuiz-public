function stripHtml(text) {
    return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseSuggestionItem(item) {
    const word = String(item?.select || '').trim();
    if (!word) return null;

    const html = String(item?.data || '');
    let phonetic = '';
    let hint = '';

    const phoneticMatch = html.match(/class=["']fr hl["'][^>]*>([^<]*)/i);
    if (phoneticMatch) phonetic = phoneticMatch[1].trim();

    const hintMatch = html.match(/<p>([\s\S]*?)<\/p>/i);
    if (hintMatch) hint = stripHtml(hintMatch[1]);

    return { word, phonetic, hint };
}

function parseLabanSuggest(payload, query) {
    const suggestions = (payload?.suggestions || [])
        .map(parseSuggestionItem)
        .filter(Boolean)
        .slice(0, 8);

    return {
        query: payload?.query || query,
        suggestions
    };
}

function dictKeyToLabanType(dictKey) {
    return dictKey === 'enEn' ? '2' : '1';
}

module.exports = { parseLabanSuggest, dictKeyToLabanType };
