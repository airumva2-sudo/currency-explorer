const http = require('http');
const fs = require('fs');
const path = require('path');
const {URL} = require('url');

try {
    const lines = fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n');
    for (const line of lines) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
} catch (e) {}

const PORT = parseInt(process.env.PORT || '3000', 10);
const SERVER_NAME = process.env.SERVER_NAME || require('os').hostname();
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_SECONDS || '3600', 10) *1000;
const API_KEY = process.env.EXCHANGE_API_KEY || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

function upstreamUrl(base) {
    return API_KEY
    ? `https://v6.exchangerate-api.com/v6/${encodeURIComponent(API_KEY)}/latest/${base}`
    : `https://open.er-api.com/v6/latest/${base}`;
}

const cache = new Map();
function cacheGet(key, allowStale = false) {
    const hit = cache.get(key);
    if (!hit) 
        return null;
    if (!allowStale && Date.now() - hit.time > CACHE_TTL_MS)
        return null;
    return hit.value;
}

function cacheSet(key, value) {
    cache.delete(key);
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(key, {time: Date.now(), value});
}

function sendJson(res, status, body, extra = {}) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type' : 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(data),
        'X-Served-By': SERVER_NAME,
        ...extra,
    });
    res.end(data);
}

async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const r = await fetch(url, {signal: controller.signal});
        let body = null;
        try { body = await r.json();
        } catch (e) {}
        return {
            status: r.status, body
        };
    } finally {
        clearTimeout(timer);
    }
}

function failWithStale(res, key, status, message) {
    const stale = cacheGet(key, true);
    if (stale)
        return sendJson(res, 200, {...stale, stale: true}, {'X-Cache': 'STALE'});
    return sendJson(res, status, {error: message});
}

async function handleRates(url, res) {
    const base = (url.searchParams.get('base') || 'USD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(base)) {
        return sendJson(res, 400, { error: 'Currency code must be 3 letters,e.g: USD'});
    }
    const key = 'rates:' + base;

    const cached = cacheGet(key);
    if (cached) 
        return sendJson(res, 200, cached, {'X-Cache': 'HIT'});
    try {
        const {status, body} = await fetchJson(upstreamUrl(base));

        if (body && body.result === 'error') {
            const type = body['error-type'] || 'unknown';
            console.error('Upstream error type:', type);
            if (type === 'unsupported-code') {
                return sendJson(res, 404, {error: `"${base}" is not a supported currency code.`});
            }
            if (type === 'quota-reached') {
                return failWithStale(res, key, 503, 'The daily limit of the rate service has been reached. Try again later.');   
            }
            return failWithStale(res, key, 502, 'The rate service rejected the request. Check the server configuration.');
        }

        if (status === 429) {
            console.error('Upstream rate limit (HTTP 429)');
            return failWithStale(res, key, 503, 'Too many requests were sent to the rate service. Please wait a few minutes and try again.');
        }

        if (!body) throw new Error(`Upstream returned status ${status} with no JSON`);

        const rates = body.rates || body.conversion_rates;
        if (!rates || typeof rates !== 'object') throw new Error('Malformed response');

        const out = {
            base,
            updated: body.time_last_update_utc || null,
            rates,
        };

        cacheSet(key, out);
        sendJson(res, 200, out, {'X-Cache': 'MISS'});
    } catch (err) {
        console.error('Rates fetch failed:', err.name === 'AbortError' ? 'timeout' : err.message);
        failWithStale(res, key, 502, err.name === 'AbortError'
            ? 'The rate service took too long to respond. Please try again.'
            : 'The rate service is unavailable right now. Please try again shortly.'
        );
    }
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

function serveStatic(url, res) {
    let rel;
    try {
        rel = decodeURIComponent(url.pathname);
    } catch (e) {
        return sendJson(res, 400, {error: 'Bad request'});
    }

    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR +path.sep))
        return sendJson(res, 403, {error: 'Forbidden'});
    fs.readFile(file, (err, content) => {
        if (err) 
            return sendJson(res, 404, {error: 'Not found'});
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
            'X-Served-By': SERVER_NAME,
        });
        res.end(content);
    });
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET')
        return sendJson(res, 405, {error: 'Method not allowed'});
    if (url.pathname === '/health')
        return sendJson(res, 200, {status: 'ok', server: SERVER_NAME});
    if (url.pathname === '/api/rates')
        return handleRates(url, res);
    if (url.pathname === '/api/server')
        return sendJson(res, 200, {server: SERVER_NAME});
    serveStatic(url, res);
});

server.listen(PORT, () => {
    console.log(`Currency explorer on port ${PORT} (served by ${SERVER_NAME}, ${API_KEY ? 'using API key' : 'keyless mode'})`);
});