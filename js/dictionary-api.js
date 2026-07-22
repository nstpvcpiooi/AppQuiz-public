import { getDictionaryApiBase } from './config/dictionary.js';

const LOOKUP_CACHE_KEY = 'elearn_dict_lookup_cache';
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 80;

function normalizeWord(word) {
    return String(word || '').trim().toLowerCase();
}

function readLookupCache() {
    try {
        const raw = sessionStorage.getItem(LOOKUP_CACHE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function writeLookupCache(cache) {
    try {
        sessionStorage.setItem(LOOKUP_CACHE_KEY, JSON.stringify(cache));
    } catch {
        /* ignore quota / private mode */
    }
}

function getCachedLookup(word) {
    const key = normalizeWord(word);
    if (!key) return null;

    const cache = readLookupCache();
    const entry = cache[key];
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        delete cache[key];
        writeLookupCache(cache);
        return null;
    }
    return entry.data;
}

function setCachedLookup(word, data) {
    const key = normalizeWord(word);
    if (!key || !data) return;

    const cache = readLookupCache();
    cache[key] = { data, expiresAt: Date.now() + CACHE_TTL_MS };

    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHE_ENTRIES) {
        keys
            .sort((a, b) => (cache[a].expiresAt || 0) - (cache[b].expiresAt || 0))
            .slice(0, keys.length - MAX_CACHE_ENTRIES)
            .forEach((k) => delete cache[k]);
    }

    writeLookupCache(cache);
}

async function dictionaryFetch(path, params = {}) {
    const base = getDictionaryApiBase();
    const url = new URL(`${base}/${path}`);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, value);
        }
    });

    const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' }
    });

    let data = null;
    try {
        data = await response.json();
    } catch (_) {
        data = null;
    }

    if (!response.ok) {
        const message = data?.error || `Dictionary request failed (${response.status})`;
        throw new Error(message);
    }

    return data;
}

export function lookupWord(word) {
    const trimmed = word.trim();
    const cached = getCachedLookup(trimmed);
    if (cached) return Promise.resolve(cached);

    return dictionaryFetch('dictionaryLookup', { word: trimmed }).then((data) => {
        setCachedLookup(trimmed, data);
        return data;
    });
}

export function getPronunciation(word, accent = 'uk') {
    return dictionaryFetch('dictionarySound', { word: word.trim(), accent });
}

export async function probePronunciations(word) {
    const trimmed = String(word || '').trim();
    if (!trimmed) return { uk: null, us: null };

    const fetchAccent = async (accent) => {
        try {
            const data = await dictionaryFetch('dictionarySound', { word: trimmed, accent });
            return data?.url || null;
        } catch {
            return null;
        }
    };

    const [uk, us] = await Promise.all([fetchAccent('uk'), fetchAccent('us')]);
    return { uk, us };
}

export function suggestWords(query, dictKey = 'enVi') {
    const trimmed = String(query || '').trim();
    if (trimmed.length < 2) {
        return Promise.resolve({ query: trimmed, suggestions: [] });
    }
    return dictionaryFetch('dictionarySuggest', {
        query: trimmed,
        dict: dictKey === 'enEn' ? 'enEn' : 'enVi'
    });
}
