export function htmlToPlainText(html) {
    const div = document.createElement('div');
    div.innerHTML = String(html ?? '');
    return (div.textContent || '').replace(/\u00A0/g, ' ').trim();
}

export function isEffectivelyEmptyHtml(html) {
    if (!html) return true;
    const div = document.createElement('div');
    div.innerHTML = html;
    return !(div.textContent || '').replace(/\u00A0/g, ' ').trim();
}

export function isSubQuizItem(q) {
    return !!(q?.isSubQuiz || (Array.isArray(q?.sourceQuizIds) && q.sourceQuizIds.length > 0));
}

export function debounce(fn, ms = 250) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}
