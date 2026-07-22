const DEFAULT_DICTIONARY_API_BASE = 'https://asia-southeast1-appquiz-6fe48.cloudfunctions.net';
const STORAGE_KEY = 'elearn_dictionary_api_base';

function isLocalDevHost() {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
}

function isStaleDictionaryApiOverride(base, onLocalDev) {
    try {
        const { hostname } = new URL(base);
        if (!onLocalDev && (hostname === 'localhost' || hostname === '127.0.0.1')) return true;
        if (hostname.includes('us-central1')) return true;
        return false;
    } catch {
        return true;
    }
}

export function getDictionaryApiBase() {
    const onLocalDev = isLocalDevHost();

    try {
        const override = localStorage.getItem(STORAGE_KEY);
        if (override && override.trim()) {
            const cleaned = override.trim().replace(/\/$/, '');
            if (!isStaleDictionaryApiOverride(cleaned, onLocalDev)) {
                return cleaned;
            }
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch (_) { /* ignore */ }

    if (onLocalDev) {
        return window.location.origin;
    }
    return DEFAULT_DICTIONARY_API_BASE;
}

export function setDictionaryApiBase(url) {
    const value = String(url || '').trim().replace(/\/$/, '');
    if (!value) {
        localStorage.removeItem(STORAGE_KEY);
        return;
    }
    localStorage.setItem(STORAGE_KEY, value);
}
