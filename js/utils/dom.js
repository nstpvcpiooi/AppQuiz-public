export const dom = {
    hide: (el) => el?.classList.add('hidden'),
    show: (el) => el?.classList.remove('hidden'),
    active: (el) => el?.classList.add('active'),
    inactive: (el) => el?.classList.remove('active'),
    setHTML: (el, html) => { if (el) el.innerHTML = html; },
    setText: (el, text) => { if (el) el.textContent = text; }
};
