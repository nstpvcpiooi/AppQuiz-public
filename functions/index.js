const { onRequest } = require('firebase-functions/v2/https');
const { parseLabanHtml } = require('./laban-parser');
const { parseLabanSuggest, dictKeyToLabanType } = require('./laban-suggest');

const LABAN_BASE = 'https://dict.laban.vn';
const CACHE_TTL_MS = 60 * 60 * 1000;
const lookupCache = new Map();
const soundCache = new Map();
const suggestCache = new Map();

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

function sendJson(res, status, body, { cacheSeconds = 3600 } = {}) {
    res.set(CORS_HEADERS);
    if (status === 200 && cacheSeconds > 0) {
        res.set('Cache-Control', `public, max-age=${cacheSeconds}`);
    }
    res.status(status).json(body);
}

function normalizeWord(word) {
    return String(word || '').trim().slice(0, 49);
}

function getCached(cache, key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}

function setCached(cache, key, value) {
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function fetchLabanHtml(word) {
    const url = `${LABAN_BASE}/find?query=${encodeURIComponent(word)}&type=1`;
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; eLearn-Dictionary/1.0)',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8'
        }
    });
    if (!response.ok) {
        throw new Error(`Laban responded with ${response.status}`);
    }
    return response.text();
}

exports.dictionaryLookup = onRequest({
    cors: true,
    region: 'asia-southeast1',
    memory: '256MiB',
    timeoutSeconds: 30
}, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.set(CORS_HEADERS);
        res.status(204).send('');
        return;
    }

    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const word = normalizeWord(req.query.word);
    if (!word) {
        sendJson(res, 400, { error: 'Missing word parameter' });
        return;
    }

    const cacheKey = word.toLowerCase();
    const cached = getCached(lookupCache, cacheKey);
    if (cached) {
        sendJson(res, 200, cached);
        return;
    }

    try {
        const html = await fetchLabanHtml(word);
        const result = parseLabanHtml(html, word);
        setCached(lookupCache, cacheKey, result);
        sendJson(res, 200, result);
    } catch (err) {
        console.error('dictionaryLookup error:', err);
        sendJson(res, 502, { error: 'Failed to fetch dictionary data' });
    }
});

exports.dictionarySuggest = onRequest({
    cors: true,
    region: 'asia-southeast1',
    memory: '256MiB',
    timeoutSeconds: 15
}, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.set(CORS_HEADERS);
        res.status(204).send('');
        return;
    }

    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const query = normalizeWord(req.query.query || req.query.word);
    if (!query || query.length < 2) {
        sendJson(res, 200, { query: query || '', suggestions: [] });
        return;
    }

    const dictKey = String(req.query.dict || 'enVi') === 'enEn' ? 'enEn' : 'enVi';
    const labanType = dictKeyToLabanType(dictKey);
    const cacheKey = `${query.toLowerCase()}:${labanType}`;
    const cached = getCached(suggestCache, cacheKey);
    if (cached) {
        sendJson(res, 200, cached, { cacheSeconds: 300 });
        return;
    }

    try {
        const url = `${LABAN_BASE}/ajax/autocomplete?query=${encodeURIComponent(query)}&type=${labanType}`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; eLearn-Dictionary/1.0)',
                Accept: 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error(`Laban suggest API responded with ${response.status}`);
        }
        const data = await response.json();
        const payload = parseLabanSuggest(data, query);
        setCached(suggestCache, cacheKey, payload);
        sendJson(res, 200, payload, { cacheSeconds: 300 });
    } catch (err) {
        console.error('dictionarySuggest error:', err);
        sendJson(res, 502, { error: 'Failed to fetch suggestions' });
    }
});

exports.dictionarySound = onRequest({
    cors: true,
    region: 'asia-southeast1',
    memory: '256MiB',
    timeoutSeconds: 30
}, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.set(CORS_HEADERS);
        res.status(204).send('');
        return;
    }

    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    const word = normalizeWord(req.query.word);
    const accent = String(req.query.accent || 'uk').toLowerCase();
    if (!word) {
        sendJson(res, 400, { error: 'Missing word parameter' });
        return;
    }
    if (accent !== 'uk' && accent !== 'us') {
        sendJson(res, 400, { error: 'accent must be uk or us' });
        return;
    }

    const cacheKey = `${word.toLowerCase()}:${accent}`;
    const cached = getCached(soundCache, cacheKey);
    if (cached) {
        sendJson(res, 200, cached);
        return;
    }

    try {
        const url = `${LABAN_BASE}/ajax/getsound?accent=${accent}&word=${encodeURIComponent(word)}`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; eLearn-Dictionary/1.0)' }
        });
        if (!response.ok) {
            throw new Error(`Laban sound API responded with ${response.status}`);
        }
        const data = await response.json();
        if (!data?.data || Number(data.error) !== 0) {
            sendJson(res, 404, { error: 'Pronunciation not available' });
            return;
        }
        const soundUrl = String(data.data).startsWith('http')
            ? data.data
            : `${LABAN_BASE}${data.data}`;
        const payload = { url: soundUrl };
        setCached(soundCache, cacheKey, payload);
        sendJson(res, 200, payload);
    } catch (err) {
        console.error('dictionarySound error:', err);
        sendJson(res, 502, { error: 'Failed to fetch pronunciation' });
    }
});
