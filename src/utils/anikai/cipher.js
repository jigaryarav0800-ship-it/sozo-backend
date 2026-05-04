const axios = require('axios');
const https = require('https');

const ENC_DEC_BASE = 'https://enc-dec.app';
const TIMEOUT_MS   = 12_000;
const MAX_ATTEMPTS = 3;
const MAX_CACHE    = 5_000;

const _cache = new Map();
const _inflight = new Map();

function cacheGet(k) { return _cache.get(k); }
function cacheSet(k, v) {
  if (_cache.size >= MAX_CACHE) _cache.delete(_cache.keys().next().value);
  _cache.set(k, v);
}
function dedup(key, fn) {
  const existing = _inflight.get(key);
  if (existing) return existing;
  const p = Promise.resolve().then(fn).finally(() => _inflight.delete(key));
  _inflight.set(key, p);
  return p;
}

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4 });
httpsAgent.setMaxListeners(0);
{
  const origCreate = httpsAgent.createConnection.bind(httpsAgent);
  httpsAgent.createConnection = (opts, cb) => {
    const socket = origCreate(opts, cb);
    socket.setMaxListeners(0);
    return socket;
  };
}

const http = axios.create({
  baseURL: ENC_DEC_BASE,
  timeout: TIMEOUT_MS,
  httpsAgent,
  headers: { 'User-Agent': 'soplay-backend/1.0', 'Accept': 'application/json' },
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function call(method, path, opts = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await http.request({ method, url: path, ...opts });
      if (res.data?.status === 200 || res.data?.status === 'ok') return res.data.result;
      throw new Error(`enc-dec.app ${path}: ${res.data?.error || 'bad response'}`);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) await sleep(500 * Math.pow(2, attempt - 1));
    }
  }
  throw Object.assign(new Error(`enc-dec.app failed: ${lastErr?.message || 'unknown'}`), { status: 502 });
}

async function encKai(text) {
  if (!text) throw Object.assign(new Error('encKai: text required'), { status: 400 });
  const key = `enc:${text}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  return dedup(key, async () => {
    const cached = cacheGet(key);
    if (cached) return cached;
    const result = await call('GET', `/api/enc-kai`, { params: { text } });
    cacheSet(key, result);
    return result;
  });
}

async function decKai(text) {
  if (!text) throw Object.assign(new Error('decKai: text required'), { status: 400 });
  const key = `dec-kai:${text}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  return dedup(key, async () => {
    const cached = cacheGet(key);
    if (cached) return cached;
    const result = await call('POST', `/api/dec-kai`, { data: { text } });
    cacheSet(key, result);
    return result;
  });
}

async function decMega(text, agent) {
  if (!text) throw Object.assign(new Error('decMega: text required'), { status: 400 });
  const key = `dec-mega:${text}:${agent}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  return dedup(key, async () => {
    const cached = cacheGet(key);
    if (cached) return cached;
    const result = await call('POST', `/api/dec-mega`, { data: { text, agent } });
    cacheSet(key, result);
    return result;
  });
}

module.exports = { encKai, decKai, decMega };
