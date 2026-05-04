const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const { encKai, decKai, decMega } = require('../utils/anikai/cipher');
const mediaRef = require('../utils/anikai/mediaRef');
const jikan = require('../utils/anikai/jikan');

const PROVIDER = 'anikai';
const BASE     = 'https://anikai.to';
const HOST_REF = `${BASE}/`;

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0';

const VIDEO_HEADERS = {
  'User-Agent': BROWSER_UA,
  'Referer':    HOST_REF,
  'Origin':     BASE,
};

const ANIKAI_COOKIE = (process.env.ANIKAI_COOKIE || 'usertype=guest').trim();

const TYPES = {
  'tv':            { path: '/tv',            label: 'TV Series' },
  'movie':         { path: '/movie',         label: 'Movies' },
  'ova':           { path: '/ova',           label: 'OVAs' },
  'ona':           { path: '/ona',           label: 'ONAs' },
  'special':       { path: '/special',       label: 'Specials' },
  'new-releases':  { path: '/new-releases',  label: 'New Releases' },
  'updates':       { path: '/updates',       label: 'Updates' },
  'ongoing':       { path: '/ongoing',       label: 'Ongoing' },
  'recent':        { path: '/recent',        label: 'Recent' },
};

const GENRES = [
  'action','adventure','avant-garde','boys-love','comedy','demons','drama','ecchi',
  'fantasy','girls-love','gourmet','harem','horror','isekai','iyashikei','josei',
  'kids','magic','mahou-shoujo','martial-arts','mecha','military','music','mystery',
  'parody','psychological','reverse-harem','romance','school','sci-fi','seinen',
  'shoujo','shounen','slice-of-life','space','sports','super-power','supernatural',
  'suspense','thriller','vampire',
];

const COUNTRY_IDS = { japan: 11, china: 2 };

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 8 });
httpsAgent.setMaxListeners(0);
{
  const origCreate = httpsAgent.createConnection.bind(httpsAgent);
  httpsAgent.createConnection = (opts, cb) => {
    const socket = origCreate(opts, cb);
    socket.setMaxListeners(0);
    return socket;
  };
}

const baseHeaders = {
  'User-Agent': BROWSER_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': HOST_REF,
  'Connection': 'keep-alive',
};
if (ANIKAI_COOKIE) baseHeaders['Cookie'] = ANIKAI_COOKIE;

const http = axios.create({
  baseURL: BASE,
  timeout: 9_000,
  httpsAgent,
  headers: baseHeaders,
});

const MAX_CONCURRENCY = 12;
let _running = 0;
const _queue  = [];

function gate(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      _running++;
      Promise.resolve()
        .then(fn)
        .then(v => { _running--; const n = _queue.shift(); if (n) n(); resolve(v); })
        .catch(e => { _running--; const n = _queue.shift(); if (n) n(); reject(e); });
    };
    if (_running < MAX_CONCURRENCY) run();
    else _queue.push(run);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const _inflight = new Map();
const DEDUP_WATCHDOG_MS = 25_000;

function dedup(key, fn) {
  const existing = _inflight.get(key);
  if (existing) return existing.promise;
  const p = Promise.resolve().then(fn);
  const watchdog = setTimeout(() => {
    if (_inflight.get(key)?.promise === p) _inflight.delete(key);
  }, DEDUP_WATCHDOG_MS).unref?.();
  const wrapped = p.finally(() => {
    clearTimeout(watchdog);
    if (_inflight.get(key)?.promise === p) _inflight.delete(key);
  });
  _inflight.set(key, { promise: wrapped });
  return wrapped;
}

function httpGet(path, opts = {}) {
  const headerKey = opts.headers ? JSON.stringify(opts.headers) : '';
  const key = `GET:${path}:${headerKey}`;
  return dedup(key, () => gate(async () => {
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await http.get(path, opts);
        return res;
      } catch (err) {
        const status = err.response?.status;
        lastErr = err;
        if (status === 429 || (status >= 500 && status < 600) || !status) {
          if (attempt < 2) await sleep(500);
          continue;
        }
        throw Object.assign(new Error(`anikai.to ${path}: ${status} ${err.message}`), { status: status || 502 });
      }
    }
    throw Object.assign(new Error(`anikai.to ${path}: ${lastErr?.message || 'failed'}`), { status: 502 });
  }));
}

const MAX_CACHE = 800;
const _cache = new Map();
function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.expires) { _cache.delete(k); return null; }
  return e.data;
}
function cacheSet(k, data, ttlMs, staleMs = 0) {
  if (_cache.size >= MAX_CACHE) _cache.delete(_cache.keys().next().value);
  const now = Date.now();
  _cache.set(k, { data, freshUntil: now + ttlMs, expires: now + ttlMs + staleMs, refreshing: false });
}
function swrFetch(key, freshMs, staleMs, fetcher) {
  const now = Date.now();
  const entry = _cache.get(key);
  if (entry && now < entry.freshUntil) return Promise.resolve(entry.data);
  if (entry && now < entry.expires) {
    if (!entry.refreshing) {
      entry.refreshing = true;
      Promise.resolve().then(fetcher).then(
        data => cacheSet(key, data, freshMs, staleMs),
        () => { entry.refreshing = false; }
      );
    }
    return Promise.resolve(entry.data);
  }
  return dedup(`swr:${key}`, async () => {
    const data = await fetcher();
    cacheSet(key, data, freshMs, staleMs);
    return data;
  });
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of _cache) if (now > e.expires) _cache.delete(k);
}, 5 * 60 * 1000).unref();

function absUrl(u) {
  if (!u) return null;
  if (u.startsWith('http')) return u;
  if (u.startsWith('//')) return `https:${u}`;
  return `${BASE}${u.startsWith('/') ? '' : '/'}${u}`;
}

function imgFromCard($el) {
  const img = $el.find('img').first();
  return img.attr('data-src') || img.attr('src') || null;
}

function slugFromHref(href) {
  if (!href) return '';
  const m = href.match(/\/watch\/(.+?)(?:[?#]|$)/);
  return m ? m[1] : '';
}

function externalIdFromSlug(slug) {
  if (!slug) return '';
  const m = slug.match(/-([a-z0-9]+)$/);
  return m ? m[1] : slug;
}

function contentUrlFromHref(href) {
  if (!href) return null;
  if (href.startsWith('http')) return href.replace(/#.*$/, '');
  return `${BASE}${href.replace(/^\/+/, '/').replace(/#.*$/, '')}`;
}

function parseTypeBadge($el) {
  const types = [];
  $el.find('.info span b').each((_, b) => {
    const t = String($el ? $el.find(b).text() : '').trim();
    if (t) types.push(t);
  });

  return types;
}

function parseCard($, el) {
  const $el = $(el);
  const linkEl = $el.find('a.poster, a.title, > a').first();
  const href = $el.is('a.aitem')
    ? $el.attr('href')
    : $el.find('a.poster').attr('href') || $el.find('a.title').attr('href');
  if (!href) return null;
  const slug = slugFromHref(href);
  if (!slug) return null;

  const titleEl = $el.find('a.title, h6.title, .title').first();
  const title = titleEl.text().trim() || titleEl.attr('title') || '';
  const jpTitle = titleEl.attr('data-jp') || '';
  const thumbnail = imgFromCard($el);

  const sub = parseInt($el.find('.info span.sub').text().trim()) || 0;
  const dub = parseInt($el.find('.info span.dub').text().trim()) || 0;

  const badges = [];
  $el.find('.info > span').each((_, s) => {
    const t = $(s).find('b').text().trim();
    if (t) badges.push(t);
  });
  const category = badges.find(b => /^(TV|MOVIE|OVA|ONA|SPECIAL)$/i.test(b)) || null;
  const epCount  = badges.find(b => /^\d+$/.test(b)) || null;

  const qualities = [];
  if (sub > 0) qualities.push(`SUB ${sub}`);
  if (dub > 0) qualities.push(`DUB ${dub}`);

  return {
    provider:   PROVIDER,
    externalId: externalIdFromSlug(slug),
    title:      title || jpTitle,
    slug,
    contentUrl: `${BASE}/watch/${slug}`,
    thumbnail:  absUrl(thumbnail),
    year:       null,
    rating:     0,
    qualities,
    category,
    extra:      { jpTitle, sub, dub, episodes: epCount ? Number(epCount) : null },
  };
}

function parseCards(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.aitem-wrapper .aitem').each((_, el) => {
    const card = parseCard($, el);
    if (card) out.push(card);
  });
  return out;
}

function parseBannerCards(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('section#featured .swiper-slide').each((_, el) => {
    const $el = $(el);
    const href = $el.find('a.watch-btn').attr('href');
    if (!href) return;
    const slug = slugFromHref(href);
    if (!slug) return;
    const title = $el.find('.title').text().trim();
    const description = $el.find('.desc').text().trim();
    const yearText = $el.find('.mics div').filter((_, d) => /Release/i.test($(d).find('div').text())).find('span').text().trim();
    const year = parseInt(yearText) || null;
    const bg = ($el.attr('style') || '').match(/url\((['"]?)([^)'"]+)\1\)/);
    const thumbnail = bg ? bg[2] : null;
    const sub = parseInt($el.find('.info span.sub').text().trim()) || 0;
    const dub = parseInt($el.find('.info span.dub').text().trim()) || 0;
    const category = ($el.find('.info span b').first().text().trim()) || null;

    const qualities = [];
    if (sub > 0) qualities.push(`SUB ${sub}`);
    if (dub > 0) qualities.push(`DUB ${dub}`);

    out.push({
      provider:   PROVIDER,
      externalId: externalIdFromSlug(slug),
      title,
      slug,
      contentUrl: `${BASE}/watch/${slug}`,
      thumbnail:  absUrl(thumbnail),
      year,
      rating:     0,
      qualities,
      category:   category && category.length <= 12 ? category : null,
      genres:     [],
      description,
    });
  });
  return out;
}

function parseTotalPages(html) {
  const $ = cheerio.load(html);
  let max = 1;
  $('ul.pagination a.page-link[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/[?&]page=(\d+)/);
    if (m) {
      const n = parseInt(m[1]);
      if (n > max) max = n;
    }
    const txt = parseInt($(el).text().trim());
    if (!isNaN(txt) && txt > max) max = txt;
  });
  return max;
}

// ─────────────────────────────────── public listing ─────────────────────────────────

async function listingPage(path, page = 1, query = {}) {
  const p = Math.max(parseInt(page) || 1, 1);
  const params = { ...query };
  if (p > 1) params.page = p;
  const qs = Object.keys(params).length
    ? '?' + new URLSearchParams(params).toString()
    : '';
  return swrFetch(`list:${path}${qs}`, 10 * 60 * 1000, 30 * 60 * 1000, async () => {
    const res = await httpGet(`${path}${qs}`);
    const items = parseCards(res.data);
    const totalPages = parseTotalPages(res.data);
    return { provider: PROVIDER, items, page: p, totalPages };
  });
}

async function getLatest(page = 1) {
  return listingPage('/recent', page);
}

async function getCategory(category, page = 1) {
  const meta = TYPES[category];
  if (!meta) {
    throw Object.assign(new Error(`Unknown category "${category}". Valid: ${Object.keys(TYPES).join(', ')}`), { status: 400 });
  }
  const res = await listingPage(meta.path, page);
  return { ...res, category };
}

async function getGenre(genre, page = 1) {
  if (!GENRES.includes(genre)) {
    throw Object.assign(new Error(`Unknown genre "${genre}"`), { status: 400 });
  }
  const res = await listingPage(`/genres/${genre}`, page);
  return { ...res, genre };
}

async function getYear(year, page = 1) {
  const y = String(year);
  const res = await listingPage('/browser', page, { 'year[]': y });
  return { ...res, year: Number(year) };
}

async function getCountry(country, page = 1) {
  const id = COUNTRY_IDS[country?.toLowerCase()];
  if (!id) {
    throw Object.assign(new Error(`Unsupported country "${country}". Valid: ${Object.keys(COUNTRY_IDS).join(', ')}`), { status: 400 });
  }
  const res = await listingPage('/browser', page, { 'country[]': id });
  return { ...res, country };
}

async function getActor() {
  throw Object.assign(new Error('anikai provider does not support actor browse'), { status: 501 });
}

async function getDirector() {
  throw Object.assign(new Error('anikai provider does not support director browse'), { status: 501 });
}

async function search(query, page = 1) {
  if (!query || String(query).trim().length < 2) {
    throw Object.assign(new Error('search query must be at least 2 chars'), { status: 400 });
  }
  const res = await listingPage('/browser', page, { keyword: String(query).trim() });
  return { ...res, query };
}

// ─────────────────────────────────── home ───────────────────────────────────────────

async function getHome() {
  return swrFetch('home', 10 * 60 * 1000, 30 * 60 * 1000, async () => {
    const res = await httpGet('/home');
    const html = res.data;
    const $ = cheerio.load(html);

    const banner = parseBannerCards(html);

    const sections = [];
    $('.alist-group section.swiper-slide').each((_, sec) => {
      const $sec = $(sec);
      const label = $sec.find('.shead .stitle').text().trim();
      const moreHref = $sec.find('a.more-btn').attr('href') || '';
      if (!label) return;
      const items = [];
      $sec.find('.aitem-wrapper .aitem').each((_, el) => {
        const c = parseCard($, el);
        if (c) items.push(c);
      });
      if (items.length === 0) return;
      sections.push({
        key:     label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        label,
        viewAll: viewAllFromHref(moreHref),
        items:   items.slice(0, 12),
      });
    });

    $('section .aitem-wrapper.regular').each((_, wrap) => {
      const $wrap = $(wrap);
      const $section = $wrap.closest('section');
      const headLabel = $section.find('.tabs .tab.active, .shead .stitle').first().text().trim();
      if (!headLabel) return;
      if (sections.some(s => s.label.toLowerCase() === headLabel.toLowerCase())) return;
      const items = [];
      $wrap.find('.aitem').each((_, el) => {
        const c = parseCard($, el);
        if (c) items.push(c);
      });
      if (items.length === 0) return;
      sections.unshift({
        key:     headLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        label:   headLabel,
        viewAll: { type: 'category', slug: 'recent' },
        items:   items.slice(0, 12),
      });
    });

    return { provider: PROVIDER, banner, sections };
  });
}

function viewAllFromHref(href) {
  if (!href) return null;
  const clean = href.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '').replace(/\/$/, '');
  const slug = clean.split('?')[0];
  if (TYPES[slug]) return { type: 'category', slug };
  const g = slug.match(/^genres\/(.+)$/);
  if (g) return { type: 'genre', slug: g[1] };
  return { type: 'path', slug };
}

// ─────────────────────────────────── detail ─────────────────────────────────────────

async function getDetail(url) {
  if (!url || !/^https?:\/\//.test(url)) {
    throw Object.assign(new Error('Valid absolute URL required'), { status: 400 });
  }
  const path = url.replace(/^https?:\/\/[^/]+/, '');

  const cacheKey = `detail:${path}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await httpGet(path);
  const $ = cheerio.load(res.data);

  const title = $('h1.title, h1[itemprop="name"]').first().text().trim();
  const jpTitle = $('h1.title, h1[itemprop="name"]').first().attr('data-jp') || '';
  const description = $('div.desc').first().text().trim() || null;
  const poster = $('div.poster img').first().attr('src') || $('meta[property="og:image"]').attr('content') || null;
  const banner = (() => {
    const style = $('.player-bg').attr('style') || '';
    const m = style.match(/url\((['"]?)([^)'"]+)\1\)/);
    return m ? m[2] : null;
  })();

  const animeIdEnc = $('div.rate-box').attr('data-id') || $('div.user-bookmark').first().attr('data-id') || null;
  const anilistId = parseInt($('div.rate-box').attr('data-alid') || $('div.user-bookmark').first().attr('data-alid') || '0') || null;
  const malId = (() => {
    const a = $('a[href*="myanimelist.net/anime/"]').first().attr('href') || '';
    const m = a.match(/anime\/(\d+)/);
    return m ? parseInt(m[1]) : null;
  })();

  const detailRows = $('#main-entity .detail > div');
  function rowValue(label) {
    let val = null;
    detailRows.find('> div').each((_, el) => {
      const $el = $(el);
      const txt = $el.contents().filter(function () { return this.type === 'text'; }).text().trim();
      if (txt.toLowerCase().startsWith(label.toLowerCase())) {
        val = $el.find('span').first().text().trim() || null;
      }
    });
    return val;
  }

  const country  = rowValue('Country');
  const duration = rowValue('Duration');
  const studio   = rowValue('Studios');
  const status   = rowValue('Status');
  const malScore = (() => {
    const raw = rowValue('MAL') || '';
    const m = raw.match(/^([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  })();

  const yearText = $('a[href*="season="]').first().text().trim();
  const year = (yearText.match(/(\d{4})/) || [])[1];

  const genres = [];
  $('#main-entity .detail a[href*="/genres/"]').each((_, el) => {
    const t = $(el).text().trim();
    if (t && !genres.includes(t)) genres.push(t);
  });

  const studios = [];
  $('#main-entity .detail a[href*="/studios/"]').each((_, el) => {
    const t = $(el).text().trim();
    if (t && !studios.includes(t)) studios.push(t);
  });
  const director = studios[0] || studio;

  const sub = parseInt($('#main-entity div.info span.sub').text().trim()) || 0;
  const dub = parseInt($('#main-entity div.info span.dub').text().trim()) || 0;

  const related = [];
  $('#related-anime .tab-body[data-id="0"] .aitem-col a.aitem').each((_, el) => {
    if (related.length >= 12) return;
    const $el = $(el);
    const href = $el.attr('href') || '';
    const slug = slugFromHref(href);
    if (!slug) return;
    const t = $el.find('.title').text().trim();
    const style = $el.attr('style') || '';
    const m = style.match(/url\((['"]?)([^)'"]+)\1\)/);
    related.push({
      provider:   PROVIDER,
      externalId: externalIdFromSlug(slug),
      title:      t,
      slug,
      contentUrl: `${BASE}/watch/${slug}`,
      thumbnail:  absUrl(m ? m[2] : null),
      year:       null,
      rating:     0,
      qualities:  [],
      category:   $el.find('.info span b').first().text().trim() || null,
    });
  });

  const [cast, screenshots, art] = await Promise.all([
    malId     ? jikan.getCharacters(malId).catch(() => [])               : Promise.resolve([]),
    anilistId ? jikan.getScreenshotsByAnilist(anilistId).catch(() => []) : Promise.resolve([]),
    anilistId ? jikan.getSeriesArt(anilistId).catch(() => null)          : Promise.resolve(null),
  ]);

  const result = {
    provider:    PROVIDER,
    contentId:   animeIdEnc,
    contentUrl:  url,
    title:       title || jpTitle,
    description,
    thumbnail:   absUrl(poster) || art?.poster || null,
    banner:      absUrl(banner) || art?.fanart || art?.banner || null,
    year:        year ? parseInt(year) : null,
    duration,
    country:     country || null,
    director:    director || null,
    genres,
    cast,
    likes:       0,
    dislikes:    0,
    isSerial:    true,
    screenshots,
    related,
    extra: {
      jpTitle, status, malScore, malId, anilistId,
      studios, sub, dub, animeIdEnc,
      art,
    },
  };

  cacheSet(cacheKey, result, 10 * 60 * 1000);
  return result;
}

async function loadEpisodeList(url) {
  const cacheKey = `eplist:${url}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const detail = await getDetail(url);
  const animeIdEnc = detail.extra?.animeIdEnc;
  if (!animeIdEnc) {
    throw Object.assign(new Error('anikai: anime ID not found on detail page'), { status: 502 });
  }

  const sig = await encKai(animeIdEnc);
  const res = await httpGet(`/ajax/episodes/list?ani_id=${encodeURIComponent(animeIdEnc)}&_=${encodeURIComponent(sig)}`, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Referer':          url,
    },
  });

  const payload = res.data;
  if (!payload || (payload.status !== 'ok' && payload.status !== 200) || !payload.result) {
    throw Object.assign(new Error('anikai: episodes endpoint rejected'), { status: 502 });
  }

  const $ = cheerio.load(payload.result);
  const subTotal = detail.extra?.sub ?? 0;
  const dubTotal = detail.extra?.dub ?? 0;
  const anilistId = detail.extra?.anilistId ?? null;

  const episodes = [];
  $('div.eplist a').each((_, a) => {
    const $a = $(a);
    const token = $a.attr('token') || '';
    if (!token) return;

    const num = parseInt($a.attr('num')) || (episodes.length + 1);
    const slug = $a.attr('slug') || String(num);
    const langs = parseInt($a.attr('langs') || '0') || 0;
    const titleText = $a.find('span').first().text().trim() || $a.attr('title') || '';

    const availableLangs = [];
    if (langs & 1) availableLangs.push('sub');
    if (langs & 2) availableLangs.push('dub');
    if (availableLangs.length === 0) availableLangs.push('sub');

    episodes.push({
      episode:      num,
      label:        titleText || `Episode ${num}`,
      slug,
      mediaRef:     mediaRef.encode({ p: PROVIDER, ep: token }),
      availableLangs,
      hasSub:       num <= subTotal,
      hasDub:       num <= dubTotal,
      isUncensored: /uncen|UC/i.test(slug) || /uncensored|\(UC\)/i.test(titleText),
    });
  });

  const list = { episodes, anilistId };
  cacheSet(cacheKey, list, 10 * 60 * 1000);
  return list;
}

async function getEpisodes(url, opts = {}) {
  if (!url || !/^https?:\/\//.test(url)) {
    throw Object.assign(new Error('Valid absolute URL required'), { status: 400 });
  }

  const list = await loadEpisodeList(url);
  const total = list.episodes.length;
  const size  = Math.max(1, Math.min(parseInt(opts.size) || 100, 500));
  const page  = Math.max(1, parseInt(opts.page) || 1);
  const sort  = String(opts.sort || '').toLowerCase() === 'desc' ? 'desc' : 'asc';

  const ordered = sort === 'desc' ? [...list.episodes].reverse() : list.episodes;
  const start = (page - 1) * size;

  const slice = ordered.slice(start, start + size).map(ep => ({ ...ep }));

  if (list.anilistId && slice.length > 0) {
    const epMeta = await jikan.getEpisodeMetaByAnilist(list.anilistId).catch(() => ({}));
    for (const ep of slice) {
      const m = epMeta[String(ep.episode)];
      if (!m) continue;
      ep.label    = m.title || ep.label;
      ep.image    = m.image;
      ep.airdate  = m.airdate;
      ep.runtime  = m.runtime;
      ep.overview = m.overview;
    }
  }

  return {
    provider:   PROVIDER,
    contentUrl: url,
    isSerial:   true,
    episodes:   slice,
    page,
    size,
    total,
    totalPages: Math.max(1, Math.ceil(total / size)),
    sort,
  };
}

async function fetchServerList(epToken, referer) {
  const sig = await encKai(epToken);
  const res = await httpGet(`/ajax/links/list?token=${encodeURIComponent(epToken)}&_=${encodeURIComponent(sig)}`, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Referer':          referer || HOST_REF,
    },
  });
  if (!res.data?.result) {
    throw Object.assign(new Error('anikai: links/list returned empty result'), { status: 502 });
  }
  const $ = cheerio.load(res.data.result);
  const servers = [];
  $('.server-items[data-id]').each((_, group) => {
    const lang = $(group).attr('data-id');
    $(group).find('span.server[data-lid]').each((_, s) => {
      const $s = $(s);
      servers.push({
        lang,
        sid:  parseInt($s.attr('data-sid')) || 0,
        eid:  $s.attr('data-eid'),
        lid:  $s.attr('data-lid'),
        name: $s.text().trim(),
      });
    });
  });
  return servers;
}

async function viewLink(lid) {
  const sig = await encKai(lid);
  const res = await httpGet(`/ajax/links/view?id=${encodeURIComponent(lid)}&_=${encodeURIComponent(sig)}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': HOST_REF },
  });
  const cipher = res.data?.result;
  if (!cipher) {
    throw Object.assign(new Error('anikai: links/view returned empty'), { status: 502 });
  }
  const data = await decKai(cipher);
  if (!data?.url) {
    throw Object.assign(new Error('anikai: links/view decoded payload missing url'), { status: 502 });
  }
  return data;
}

const MEGA_HOSTS = (process.env.ANIKAI_MEGA_HOSTS || 'megaup.nl,megaup.live,megaup22.online,4spromax.site')
  .split(',').map(s => s.trim()).filter(Boolean);

const MEGA_REFERER = 'https://animekai.to/';

const megaHeaders = {
  'User-Agent':       BROWSER_UA,
  'Accept':           'text/html, */*; q=0.01',
  'Accept-Language':  'en-US,en;q=0.5',
  'Sec-GPC':          '1',
  'Sec-Fetch-Dest':   'empty',
  'Sec-Fetch-Mode':   'cors',
  'Sec-Fetch-Site':   'same-origin',
  'Priority':         'u=0',
  'Pragma':           'no-cache',
  'Cache-Control':    'no-cache',
  'Referer':          MEGA_REFERER,
};

const megaHttp = axios.create({
  timeout: 6_000,
  httpsAgent,
  headers: megaHeaders,
});

async function fetchMegaSources(megaUrl, deadline = Infinity) {
  const m = megaUrl.match(/\/e2?\/([^?#/]+)/);
  if (!m) throw Object.assign(new Error(`anikai: cannot parse mega ID from ${megaUrl}`), { status: 502 });
  const mediaId = m[1];
  const originalHost = (() => {
    try { return new URL(megaUrl).hostname; } catch { return null; }
  })();

  const hosts = [...new Set([originalHost, ...MEGA_HOSTS].filter(Boolean))];

  let lastErr;
  for (const host of hosts) {
    if (Date.now() >= deadline) break;
    const tryUrl = `https://${host}/media/${mediaId}`;
    try {
      const res = await megaHttp.get(tryUrl);
      const cipher = res.data?.result;
      if (!cipher) throw new Error('mega media response missing result');
      const decoded = await decMega(cipher, BROWSER_UA);
      const sources = decoded?.sources || [];
      const tracks  = decoded?.tracks  || [];
      if (!sources.length) throw new Error('mega media decoded with no sources');
      return { sources, tracks, host };
    } catch (err) {
      lastErr = err;
    }
  }
  throw Object.assign(new Error(`anikai: all mega hosts failed: ${lastErr?.message || 'unknown'}`), { status: 502 });
}

function isMegaUrl(url) {
  return typeof url === 'string' && /\/e2?\/[^?#/]+/.test(url);
}

async function tryServer(srv, attempts, deadline) {
  let view;
  try {
    view = await viewLink(srv.lid);
  } catch (err) {
    attempts.push({ sid: srv.sid, name: srv.name, error: err.message });
    return null;
  }

  if (!isMegaUrl(view.url)) {

    attempts.push({ sid: srv.sid, name: srv.name, skipped: 'non-mega url', url: view.url });
    return null;
  }

  try {
    const { sources, tracks } = await fetchMegaSources(view.url, deadline);
    return { srv, view, sources, tracks };
  } catch (err) {
    attempts.push({ sid: srv.sid, name: srv.name, error: err.message });
    return null;
  }
}

async function resolveMedia(refToken, opts = {}) {
  const lang          = (opts.lang || 'sub').toLowerCase();
  const requestedSid  = parseInt(opts.server) || 1;
  if (!['sub', 'softsub', 'dub'].includes(lang)) {
    throw Object.assign(new Error(`Invalid lang "${lang}". Use sub|softsub|dub`), { status: 400 });
  }

  const ref = mediaRef.decode(refToken);
  if (ref.p !== PROVIDER || !ref.ep) {
    throw Object.assign(new Error('media ref does not belong to anikai provider'), { status: 400 });
  }

  const cacheKey = `media:${ref.ep}:${lang}:${requestedSid}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const servers = await fetchServerList(ref.ep);
  let pool = servers.filter(s => s.lang === lang);
  if (pool.length === 0 && lang === 'sub') {
    pool = servers.filter(s => s.lang === 'softsub');
  }
  if (pool.length === 0) {
    throw Object.assign(new Error(`anikai: no "${lang}" server available for this episode`), { status: 404 });
  }
  pool.sort((a, b) => a.sid - b.sid);

  const requested = pool.find(s => s.sid === requestedSid);
  const ordered = requested
    ? [requested, ...pool.filter(s => s !== requested)]
    : pool.slice();

  const BUDGET_MS = 14_000;
  const deadline = Date.now() + BUDGET_MS;

  const attempts = [];
  let resolved = null;
  for (const srv of ordered) {
    if (Date.now() >= deadline) {
      attempts.push({ sid: srv.sid, name: srv.name, skipped: 'budget exhausted' });
      break;
    }
    resolved = await tryServer(srv, attempts, deadline);
    if (resolved && resolved.sources?.length) break;
    resolved = null;
  }

  if (!resolved) {
    throw Object.assign(
      new Error(`anikai: no playable source across ${ordered.length} server(s)`),
      { status: 502, attempts }
    );
  }

  const { srv: chosen, view, sources, tracks } = resolved;
  const playable = sources[0]?.file || null;
  if (!playable) {
    throw Object.assign(new Error('anikai: extractor returned no playable source'), { status: 502 });
  }

  const subtitles = (tracks || []).map(t => ({
    label:   (t.label || t.kind || 'subtitle').trim(),
    file:    t.file,
    kind:    t.kind || 'captions',
    default: Boolean(t.default),
  })).filter(t => t.file);

  const result = {
    videoUrl: playable,
    type:     sources[0]?.type || 'hls',
    headers:  VIDEO_HEADERS,
    subtitles,
    skip:     view.skip || null,
    server:   { name: chosen.name, sid: chosen.sid, lang: chosen.lang },
    languagesAvailable: [...new Set(servers.map(s => s.lang))],
  };
  cacheSet(cacheKey, result, 25 * 60 * 1000);
  return result;
}

async function checkVideoUrl(videoUrl) {
  try {
    const res = await axios.head(videoUrl, {
      timeout: 8_000,
      headers: { ...VIDEO_HEADERS, Range: 'bytes=0-0' },
      maxRedirects: 5,
    });
    return {
      accessible:    res.status < 400,
      status:        res.status,
      contentType:   res.headers['content-type'] || null,
      contentLength: res.headers['content-length'] ? parseInt(res.headers['content-length']) : null,
      acceptRanges:  res.headers['accept-ranges'] || null,
    };
  } catch (err) {
    const status = err.response?.status || 0;
    return { accessible: status !== 404, status, error: err.message };
  }
}

async function diagnose(url) {
  const log = [];
  const step = (name, fn) => fn().then(
    v => { log.push({ step: name, ok: true, ...v }); return v; },
    e => { log.push({ step: name, ok: false, error: e.message, status: e.status }); throw e; }
  );

  try {
    const detail = await step('detail', async () => {
      const t = Date.now();
      const d = await getDetail(url);
      return { ms: Date.now() - t, animeIdEnc: d.extra?.animeIdEnc, malId: d.extra?.malId, anilistId: d.extra?.anilistId };
    });

    const epList = await step('episodes-ajax', async () => {
      const t = Date.now();
      const animeIdEnc = detail.animeIdEnc;
      const sig = await encKai(animeIdEnc);
      const r = await httpGet(`/ajax/episodes/list?ani_id=${encodeURIComponent(animeIdEnc)}&_=${encodeURIComponent(sig)}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': url },
      });
      const $ = cheerio.load(r.data?.result || '');
      const eps = $('div.eplist a[token]').toArray();
      return { ms: Date.now() - t, episodeCount: eps.length, firstToken: $(eps[0]).attr('token') || null };
    });

    if (!epList.firstToken) throw new Error('no episodes parsed');

    const servers = await step('links-list', async () => {
      const t = Date.now();
      const list = await fetchServerList(epList.firstToken, url);
      return { ms: Date.now() - t, count: list.length, servers: list.map(s => ({ lang: s.lang, name: s.name, sid: s.sid })) };
    });

    if (!servers.count) throw new Error('no servers found');

    const view = await step('links-view+dec-kai', async () => {
      const t = Date.now();
      const list = await fetchServerList(epList.firstToken, url);
      const first = list[0];
      const v = await viewLink(first.lid);
      return { ms: Date.now() - t, server: first.name, lang: first.lang, megaUrl: v.url };
    });

    const hostProbe = await step('mega-hosts-probe', async () => {
      const t = Date.now();
      const m = view.megaUrl.match(/\/e2?\/([^?#/]+)/);
      const id = m ? m[1] : null;
      const candidates = [...new Set([new URL(view.megaUrl).hostname, ...MEGA_HOSTS])];
      const results = [];
      for (const host of candidates) {
        try {
          const r = await axios.head(`https://${host}/media/${id}`, {
            timeout: 6000, headers: megaHeaders, validateStatus: () => true, maxRedirects: 0,
          });
          results.push({ host, status: r.status });
        } catch (e) {
          results.push({ host, status: 0, error: e.code || e.message });
        }
      }
      return { ms: Date.now() - t, results };
    });

    const sources = await step('mega-sources', async () => {
      const t = Date.now();
      const r = await fetchMegaSources(view.megaUrl);
      return { ms: Date.now() - t, sources: r.sources.length, tracks: r.tracks.length, host: r.host };
    });

    return { ok: true, log, summary: 'all steps passed' };
  } catch (err) {
    return {
      ok: false,
      log,
      failedAt: log[log.length - 1]?.step,
      error: err.message,
    };
  }
}

function getCategoryList() {
  return Object.keys(TYPES).map(slug => ({
    provider: PROVIDER,
    slug,
    label:    TYPES[slug].label,
    path:     TYPES[slug].path,
    url:      `${BASE}${TYPES[slug].path}`,
  }));
}

async function getGenreList() {
  const list = GENRES.map(g => ({
    provider: PROVIDER,
    slug:     g,
    label:    g.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
    url:      `${BASE}/genres/${g}`,
    image:    jikan.getGenreImageCached(g),
  }));
  if (list.some(g => g.image === null)) {
    jikan.warmGenreImages(GENRES.filter(g => jikan.getGenreImageCached(g) === null));
  }
  return list;
}

jikan.warmGenreImages(GENRES);

module.exports = {
  name:    PROVIDER,
  domains: ['anikai.to', 'animekai.to', 'animekai.bz'],
  getLatest,
  getCategory,
  getGenre,
  getYear,
  getCountry,
  getActor,
  getDirector,
  search,
  getHome,
  getDetail,
  getEpisodes,
  resolveMedia,
  checkVideoUrl,
  getCategoryList,
  getGenreList,
  diagnose,
};
