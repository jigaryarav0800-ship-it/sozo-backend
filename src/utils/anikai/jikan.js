const axios = require('axios');
const https = require('https');
const http_ = require('http');

const JIKAN_BASE  = 'https://api.jikan.moe/v4';
const ANIZIP_BASE = 'https://api.ani.zip';
const TIMEOUT_MS  = 8_000;
const MAX_CACHE   = 2_000;

const MIN_INTERVAL = 500;
let _gateTail = Promise.resolve(0);

function jikanGate() {
  const next = _gateTail.then(async lastAt => {
    const wait = Math.max(0, lastAt + MIN_INTERVAL - Date.now());
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    return Date.now();
  });
  _gateTail = next;
  return next;
}

const _cache = new Map();
function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.expires) { _cache.delete(k); return null; }
  return e.data;
}
function cacheSet(k, data, ttl = 24 * 60 * 60 * 1000) {
  if (_cache.size >= MAX_CACHE) _cache.delete(_cache.keys().next().value);
  _cache.set(k, { data, expires: Date.now() + ttl });
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
function unboundSockets(agent) {
  agent.setMaxListeners(0);
  const origCreate = agent.createConnection.bind(agent);
  agent.createConnection = (opts, cb) => {
    const socket = origCreate(opts, cb);
    socket.setMaxListeners(0);
    return socket;
  };
  return agent;
}
const httpsAgent = unboundSockets(new https.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4 }));
const httpAgent  = unboundSockets(new http_.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4 }));
const http = axios.create({
  timeout: TIMEOUT_MS,
  headers: { 'User-Agent': UA, 'Accept': 'application/json' },
  httpAgent, httpsAgent,
});

const _inflight = new Map();
function dedup(key, fn) {
  const existing = _inflight.get(key);
  if (existing) return existing;
  const p = Promise.resolve().then(fn).finally(() => _inflight.delete(key));
  _inflight.set(key, p);
  return p;
}

async function getJikan(path) {
  const key = `jikan:${path}`;
  const hit = cacheGet(key);
  if (hit !== undefined && hit !== null) return hit;
  return dedup(key, async () => {
    const cached = cacheGet(key);
    if (cached !== undefined && cached !== null) return cached;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await jikanGate();
      try {
        const res = await http.get(`${JIKAN_BASE}${path}`);
        const value = res.data?.data ?? null;
        cacheSet(key, value);
        return value;
      } catch (err) {
        const status = err.response?.status;
        if (status === 404) {
          cacheSet(key, null, 60 * 60 * 1000);
          return null;
        }
        if ((status === 429 || status === 503 || status === 504 || !status) && attempt < 3) {
          await new Promise(r => setTimeout(r, 600 * attempt));
          continue;
        }
        cacheSet(key, null, 60 * 1000);
        return null;
      }
    }
    return null;
  });
}

async function getAniZip(anilistId) {
  if (!anilistId) return null;
  const key = `anizip:${anilistId}`;
  const hit = cacheGet(key);
  if (hit !== undefined && hit !== null) return hit;
  return dedup(key, async () => {
    const cached = cacheGet(key);
    if (cached !== undefined && cached !== null) return cached;
    try {
      const res = await http.get(`${ANIZIP_BASE}/mappings?anilist_id=${anilistId}`);
      cacheSet(key, res.data ?? null);
      return res.data ?? null;
    } catch {
      cacheSet(key, null, 60 * 1000);
      return null;
    }
  });
}

async function getPictures(malId) {
  if (!malId) return [];
  const data = await getJikan(`/anime/${malId}/pictures`);
  if (!Array.isArray(data)) return [];
  return data.map(p => ({
    full: p?.jpg?.large_image_url || p?.jpg?.image_url || null,
    thumb: p?.jpg?.small_image_url || p?.jpg?.image_url || null,
  })).filter(p => p.full || p.thumb);
}

async function getScreenshotsByAnilist(anilistId, max = 24) {
  const az = await getAniZip(anilistId);
  if (!az) return [];
  const out = [];
  if (Array.isArray(az.episodes ? Object.values(az.episodes) : null)) {
    for (const ep of Object.values(az.episodes)) {
      if (out.length >= max) break;
      if (ep?.image) out.push({ full: ep.image, thumb: ep.image });
    }
  }
  if (out.length === 0 && Array.isArray(az.images)) {
    for (const img of az.images) {
      if (img?.url) out.push({ full: img.url, thumb: img.url });
    }
  }
  return out;
}

async function getSeriesArt(anilistId) {
  const az = await getAniZip(anilistId);
  if (!az || !Array.isArray(az.images)) return null;
  const pick = type => az.images.find(i => i.coverType === type)?.url || null;
  return {
    poster:  pick('Poster'),
    banner:  pick('Banner'),
    fanart:  pick('Fanart'),
    clear:   pick('Clearart') || pick('Clearlogo'),
  };
}

async function getCharacters(malId) {
  if (!malId) return [];
  const data = await getJikan(`/anime/${malId}/characters`);
  if (!Array.isArray(data)) return [];
  return data.slice(0, 20).map(c => {
    const name = c?.character?.name || '';
    const image = c?.character?.images?.jpg?.image_url || null;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unknown';
    return { id, name, image };
  }).filter(c => c.name);
}

const GENRE_ID = {
  action:        1,  adventure:     2,  'avant-garde': 5,  'boys-love': 28,
  comedy:        4,  demons:        6,  drama:         8,  ecchi:        9,
  fantasy:      10,  'girls-love': 26,  gourmet:      47,  harem:       35,
  horror:       14,  isekai:       62,  iyashikei:    63,  josei:       43,
  kids:         15,  magic:        10,  'mahou-shoujo': 66,
  'martial-arts': 17, mecha:       18,  military:     38,  music:       19,
  mystery:       7,  parody:       20,  psychological: 40,
  'reverse-harem': 73, romance:    22,  school:       23,  'sci-fi':    24,
  seinen:       42,  shoujo:       25,  shounen:      27,
  'slice-of-life': 36, space:      29,  sports:       30,  'super-power': 31,
  supernatural: 37,  suspense:     41,  thriller:     41,  vampire:     32,
};

function getGenreImageCached(slug) {
  const cached = cacheGet(`genreimg:${slug}`);
  return (cached === undefined) ? null : cached;
}

async function getGenreImage(slug) {
  const id = GENRE_ID[slug];
  if (!id) return null;
  const cacheKey = `genreimg:${slug}`;
  const hit = cacheGet(cacheKey);
  if (hit !== undefined && hit !== null) return hit;
  const list = await getJikan(`/anime?genres=${id}&order_by=favorites&sort=desc&limit=1&sfw`);
  const a = Array.isArray(list) ? list[0] : null;
  const img = a?.images?.webp?.large_image_url
           || a?.images?.jpg?.large_image_url
           || a?.images?.jpg?.image_url
           || null;
  cacheSet(cacheKey, img, 7 * 24 * 60 * 60 * 1000);
  return img;
}

function warmGenreImages(slugs) {
  setImmediate(async () => {
    for (const s of slugs) {
      try { await getGenreImage(s); } catch {  }
    }
  });
}

async function getEpisodeMetaByAnilist(anilistId) {
  const az = await getAniZip(anilistId);
  if (!az?.episodes) return {};
  const out = {};
  for (const [k, ep] of Object.entries(az.episodes)) {
    const titleMap = ep?.title || {};
    out[k] = {
      title: titleMap.en || titleMap['x-jat'] || titleMap.ja || null,
      image: ep?.image || null,
      airdate: ep?.airdate || null,
      runtime: ep?.runtime || null,
      overview: ep?.overview || null,
    };
  }
  return out;
}

module.exports = {
  getJikan, getAniZip,
  getPictures, getCharacters,
  getEpisodeMetaByAnilist,
  getScreenshotsByAnilist, getSeriesArt,
  getGenreImage, getGenreImageCached, warmGenreImages,
};
