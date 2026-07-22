import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseLabanHtml } = require('../functions/laban-parser.js');
const { parseLabanSuggest, dictKeyToLabanType } = require('../functions/laban-suggest.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const LABAN_BASE = 'https://dict.laban.vn';
const CACHE_TTL_MS = 60 * 60 * 1000;

const lookupCache = new Map();
const soundCache = new Map();
const suggestCache = new Map();

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.webp': 'image/webp'
};

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
}

function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() });
    res.end(JSON.stringify(body));
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
    if (!response.ok) throw new Error(`Laban responded with ${response.status}`);
    return response.text();
}

async function handleDictionaryLookup(word, res) {
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
}

async function handleDictionarySuggest(query, dictKey, res) {
    const q = normalizeWord(query);
    if (!q || q.length < 2) {
        sendJson(res, 200, { query: q || '', suggestions: [] });
        return;
    }

    const labanType = dictKeyToLabanType(dictKey === 'enEn' ? 'enEn' : 'enVi');
    const cacheKey = `${q.toLowerCase()}:${labanType}`;
    const cached = getCached(suggestCache, cacheKey);
    if (cached) {
        sendJson(res, 200, cached);
        return;
    }

    try {
        const url = `${LABAN_BASE}/ajax/autocomplete?query=${encodeURIComponent(q)}&type=${labanType}`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; eLearn-Dictionary/1.0)',
                Accept: 'application/json'
            }
        });
        if (!response.ok) throw new Error(`Laban suggest API responded with ${response.status}`);
        const data = await response.json();
        const payload = parseLabanSuggest(data, q);
        setCached(suggestCache, cacheKey, payload);
        sendJson(res, 200, payload);
    } catch (err) {
        console.error('dictionarySuggest error:', err);
        sendJson(res, 502, { error: 'Failed to fetch suggestions' });
    }
}

async function handleDictionarySound(word, accent, res) {
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
        if (!response.ok) throw new Error(`Laban sound API responded with ${response.status}`);
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
}

function serveStatic(filePath, res) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders());
        res.end();
        return;
    }

    if (req.method === 'GET' && url.pathname === '/dictionaryLookup') {
        await handleDictionaryLookup(normalizeWord(url.searchParams.get('word')), res);
        return;
    }

    if (req.method === 'GET' && url.pathname === '/dictionarySuggest') {
        await handleDictionarySuggest(
            url.searchParams.get('query') || url.searchParams.get('word'),
            url.searchParams.get('dict') || 'enVi',
            res
        );
        return;
    }

    if (req.method === 'GET' && url.pathname === '/dictionarySound') {
        await handleDictionarySound(
            normalizeWord(url.searchParams.get('word')),
            String(url.searchParams.get('accent') || 'uk').toLowerCase(),
            res
        );
        return;
    }

    let relative = decodeURIComponent(url.pathname);
    if (relative === '/') relative = '/index.html';
    const safePath = path.normalize(relative).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(ROOT, safePath);

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    serveStatic(filePath, res);
});

function listen(port) {
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < PORT + 9) {
            console.warn(`Port ${port} in use, trying ${port + 1}...`);
            listen(port + 1);
            return;
        }
        console.error(err.code === 'EADDRINUSE'
            ? `Ports ${PORT}-${PORT + 9} are in use. Stop other servers and retry.`
            : err.message);
        process.exit(1);
    });
    server.listen(port, () => {
        console.log(`eLearn local server: http://localhost:${port}`);
        console.log('Dictionary API: built-in (no Firebase required for local dev)');
        console.log('Press Ctrl+C to stop.');
    });
}

listen(PORT);
