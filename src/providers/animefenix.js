'use strict';
const axios   = require('axios');
const cheerio = require('cheerio');
const { SwrCache } = require('../utils/swrCache');

const PROVIDER = 'animefenix';
const BASE     = 'https://animefenix2.tv';
const UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const swr = new SwrCache({ maxEntries: 600 });
swr.startSweepTimer();

const http = axios.create({
  baseURL: BASE,
  timeout: 15_000,
  headers: {
    'User-Agent':      UA,
    'Accept':          'text/html,application/xhtml+xml,*/*;q=0.9',
    'Accept-Language': 'es,en;q=0.9',
    'Referer':         `${BASE}/`,
  },
});

function err(msg, status) {
  return Object.assign(new Error(msg), { status });
}

async function fetchHtml(pathOrUrl) {
  try {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
    const res = await http.get(url, { validateStatus: () => true });
    if (res.status < 200 || res.status >= 300 || typeof res.data !== 'string') {
      throw err(`animefenix ${res.status} for "${pathOrUrl}"`, res.status || 502);
    }
    return res.data;
  } catch (e) {
    if (e.status) throw e;
    throw err(`animefenix network: ${e.message}`, 502);
  }
}

function absUrl(u) {
  if (!u) return null;
  if (u.startsWith('http')) return u;
  if (u.startsWith('//')) return `https:${u}`;
  return `${BASE}${u.startsWith('/') ? '' : '/'}${u}`;
}

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// /ver/one-piece-1160 → { slug: 'one-piece', episode: 1160 }
function parseEpisodeHref(href) {
  const path = String(href || '').replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '');
  const m = path.match(/^\/ver\/(.+?)-(\d+)$/);
  return m ? { slug: m[1], episode: Number(m[2]) } : null;
}

function slugFromUrl(url) {
  const path = String(url || '').replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '');
  const m = path.match(/^\/([a-z0-9][a-z0-9-]+[a-z0-9])\/?(?:\?.*)?$/);
  return m ? m[1] : path.replace(/^\//, '').split('/')[0] || null;
}

function contentUrl(slug) { return `${BASE}/${slug}`; }
function episodeUrl(slug, n) { return `${BASE}/ver/${slug}-${n}`; }

// ── Catalog helpers ───────────────────────────────────────────────────────────

function parseTotalPages(html) {
  const $ = cheerio.load(html);
  let max = 1;
  $('a[href*="?p="], .pagination a, nav a').each((_, a) => {
    const p = Number(($(a).attr('href') || '').match(/[?&]p=(\d+)/)?.[1]);
    if (p > max) max = p;
  });
  return max;
}

function parseCards(html) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const out  = [];

  $('li article, article').each((_, el) => {
    const $el = $(el);
    const $link = $el.find('a[href]').filter((_, a) => {
      const h = $(a).attr('href') || '';
      return h.startsWith('/') && !h.startsWith('/ver/') && !h.startsWith('/directorio') && !h.startsWith('/emision');
    }).first();

    const href = $link.attr('href') || '';
    const slug = slugFromUrl(href);
    if (!slug || seen.has(slug)) return;
    seen.add(slug);

    const title = cleanText(
      $link.attr('title')
      || $el.find('h3, h2, [class*="title"]').first().text()
      || slug.replace(/-/g, ' '),
    );
    const img = $el.find('img').first();
    const thumbnail = absUrl(img.attr('src') || img.attr('data-src') || null);
    const type = cleanText($el.find('.type, .badge, .estado, [class*="category"]').first().text()) || null;

    out.push({ provider: PROVIDER, externalId: slug, title, slug, contentUrl: contentUrl(slug), thumbnail, year: null, rating: 0, qualities: type ? [type] : [], category: type });
  });
  return out;
}

async function listing(params = {}) {
  const page = Math.max(parseInt(params.page) || 1, 1);
  const qs   = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') qs.set(k, String(v));
  }
  const path = `/directorio/anime?${qs}`;
  return swr.fetch(`list:${path}`, 5 * 60_000, 20 * 60_000, async () => {
    const html = await fetchHtml(path);
    return { provider: PROVIDER, items: parseCards(html), page, totalPages: parseTotalPages(html) };
  });
}

async function getLatest(page = 1) { return listing({ orden: 'fecha', page }); }
async function getCategory(category, page = 1) { return listing({ tipo: category, page }); }
async function getGenre(genre, page = 1) { return listing({ genero: genre, page }); }
async function getYear(year, page = 1) { return listing({ anio: year, page }); }
async function getCountry() { throw err('animefenix does not support country browse', 501); }
async function getActor()   { throw err('animefenix does not support actor browse', 501); }
async function getDirector(){ throw err('animefenix does not support director browse', 501); }

async function search(query, page = 1) {
  if (!query || String(query).trim().length < 2) throw err('Search query must be at least 2 chars', 400);
  return listing({ q: String(query).trim(), page });
}

async function getHome() {
  return swr.fetch('home', 5 * 60_000, 20 * 60_000, async () => {
    const html = await fetchHtml('/');
    const $    = cheerio.load(html);
    const epSeen = new Set();
    const latestEpisodes = [];

    $('a[href^="/ver/"]').each((_, a) => {
      const parsed = parseEpisodeHref($(a).attr('href'));
      if (!parsed || epSeen.has(parsed.slug)) return;
      epSeen.add(parsed.slug);
      const $a  = $(a);
      const img = $a.find('img').first();
      latestEpisodes.push({
        provider: PROVIDER, externalId: parsed.slug,
        title:       cleanText($a.attr('title') || $a.find('.ep-title, [class*="title"], span').first().text() || parsed.slug.replace(/-/g, ' ')).replace(/\s*\d+$/, '').trim() || parsed.slug.replace(/-/g, ' '),
        slug:        parsed.slug,
        contentUrl:  contentUrl(parsed.slug),
        thumbnail:   absUrl(img.attr('src') || img.attr('data-src') || null),
        year: null, rating: 0,
        qualities: [`EP ${parsed.episode}`], category: 'Episodio',
        extra: { latestEpisode: parsed.episode },
      });
    });

    const recent = await getLatest(1).catch(() => ({ items: [] }));
    return {
      provider: PROVIDER,
      banner:   recent.items.slice(0, 8),
      sections: [
        { key: 'latest-eps', label: 'Últimos episodios', viewAll: { type: 'latest' }, items: latestEpisodes.slice(0, 12) },
        { key: 'recent',     label: 'Series recientes',  viewAll: { type: 'latest' }, items: recent.items.slice(0, 12) },
      ],
    };
  });
}

// ── Detail ────────────────────────────────────────────────────────────────────

async function getDetail(url) {
  const slug = slugFromUrl(url);
  if (!slug) throw err('animefenix: invalid URL', 400);

  return swr.fetch(`detail:${slug}`, 10 * 60_000, 30 * 60_000, async () => {
    const html = await fetchHtml(`/${slug}`);
    const $    = cheerio.load(html);

    // Title: h1.text-4xl.text-orange-500
    const title = cleanText($('h1.text-4xl, h1.text-orange-500, h1').first().text());

    // Thumbnail: og:image or first episode card thumb
    const thumbnail = absUrl(
      $('meta[property="og:image"]').attr('content')
      || $('a.episode-card img').first().attr('src')
      || $('img[src*="animemovil"], img[src*="pandrama"]').first().attr('src'),
    );

    // Description: p after h2 "Sinopsis"
    const description = cleanText(
      $('h2').filter((_, el) => /sinopsis/i.test($(el).text())).first().next('p').text()
      || $('p.text-gray-300').first().text(),
    );

    // Genres: a.bg-orange-500 (genre badge links)
    const genres = [];
    $('a.bg-orange-500, a[href*="genero="]').each((_, a) => {
      const g = cleanText($(a).text());
      if (g && !genres.includes(g)) genres.push(g);
    });

    // Info: ul.text-gray-300 li  → "Tipo: TV Anime", "Estado: En emision", etc.
    let tipo = null, estado = null, episodesCount = 0, score = null;
    $('ul.text-gray-300 li').each((_, li) => {
      const text  = cleanText($(li).text());
      const parts = text.match(/^([^:]+):\s*(.+)/);
      if (!parts) return;
      const key = parts[1].toLowerCase().trim();
      const val = parts[2].trim();
      if (key === 'tipo')      tipo          = val;
      else if (key === 'estado') estado      = val;
      else if (key === 'episodios') episodesCount = parseInt(val) || 0;
    });

    // Score from rating
    const scoreM = html.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
    score = scoreM ? parseFloat(scoreM[1]) : null;

    // Year
    const yearM = html.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
    const year  = yearM ? parseInt(yearM[0]) : null;

    // Episodes from episode cards
    const epNums = new Set();
    $('a.episode-card[href]').each((_, a) => {
      const ep = parseEpisodeHref($(a).attr('href'));
      if (ep) epNums.add(ep.episode);
    });
    const actualCount = epNums.size || episodesCount;

    return {
      provider: PROVIDER, contentId: slug, contentUrl: contentUrl(slug),
      title: title || slug.replace(/-/g, ' '),
      description: description || null,
      thumbnail, banner: thumbnail, year,
      duration: null, country: 'Japan', director: null,
      genres, cast: [], likes: 0, dislikes: 0,
      isSerial: actualCount > 1,
      screenshots: [], related: [],
      extra: { episodesCount: actualCount, tipo, estado, score },
    };
  });
}

// ── Episodes ──────────────────────────────────────────────────────────────────

async function getEpisodes(url, opts = {}) {
  const slug = slugFromUrl(url);
  if (!slug) throw err('animefenix: invalid URL', 400);

  const sort = String(opts.sort || '').toLowerCase() === 'desc' ? 'desc' : 'asc';
  const size  = Math.max(1, Math.min(parseInt(opts.size) || 100, 500));
  const page  = Math.max(1, parseInt(opts.page) || 1);

  return swr.fetch(`episodes:${slug}:${page}:${size}:${sort}`, 10 * 60_000, 30 * 60_000, async () => {
    const html = await fetchHtml(`/${slug}`);
    const $    = cheerio.load(html);
    const seen = new Set();
    const all  = [];

    // a.episode-card links (real selector from live site)
    $('a.episode-card[href]').each((_, a) => {
      const ep = parseEpisodeHref($(a).attr('href'));
      if (!ep || seen.has(ep.episode)) return;
      seen.add(ep.episode);
      const label = cleanText($(a).find('.ep-title, .ep-number, span').first().text()) || `Capítulo ${ep.episode}`;
      const thumb = absUrl($(a).find('img').first().attr('src') || null);
      all.push({ episode: ep.episode, label, thumb });
    });

    // Fallback: any /ver/ links
    if (all.length === 0) {
      $('a[href^="/ver/"]').each((_, a) => {
        const ep = parseEpisodeHref($(a).attr('href'));
        if (!ep || ep.slug !== slug || seen.has(ep.episode)) return;
        seen.add(ep.episode);
        all.push({ episode: ep.episode, label: `Capítulo ${ep.episode}`, thumb: null });
      });
    }

    all.sort((a, b) => a.episode - b.episode);

    if (all.length <= 1) {
      const ep       = all[0]?.episode || 1;
      const resolved = await resolveMedia(episodeUrl(slug, ep)).catch(() => null);
      return {
        provider: PROVIDER, contentUrl: contentUrl(slug), isSerial: false,
        videoSources: resolved?.videoSources || [],
        playerSrc: resolved?.videoUrl || null,
        type: resolved?.type || null,
        headers: resolved?.headers || {},
      };
    }

    const ordered = sort === 'desc' ? [...all].reverse() : [...all];
    const start   = (page - 1) * size;

    return {
      provider: PROVIDER, contentUrl: contentUrl(slug), isSerial: true,
      episodes: ordered.slice(start, start + size).map(e => ({
        episode:  e.episode,
        label:    e.label,
        mediaRef: episodeUrl(slug, e.episode),
        ...(e.thumb ? { image: e.thumb } : {}),
      })),
      page, size,
      total:      ordered.length,
      totalPages: Math.max(1, Math.ceil(ordered.length / size)),
      sort,
    };
  });
}

// ── Video extractors ──────────────────────────────────────────────────────────
// Each extractor returns { videoUrl, type, referer } or null

async function fetchEmbedResponse(url, referer = `${BASE}/`, extraHeaders = {}) {
  try {
    const res = await axios.get(url, {
      timeout: 8_000,
      headers: {
        'User-Agent': UA,
        'Referer':    referer,
        'Accept':     'text/html,application/xhtml+xml,*/*;q=0.8',
        ...extraHeaders,
      },
      validateStatus: () => true,
      maxRedirects:   5,
    });
    return {
      status:   res.status,
      html:     typeof res.data === 'string' ? res.data : null,
      finalUrl: res.request?.res?.responseUrl || url,
      headers:  res.headers || {},
    };
  } catch { return null; }
}

async function fetchEmbed(url, referer = `${BASE}/`, extraHeaders = {}) {
  const res = await fetchEmbedResponse(url, referer, extraHeaders);
  return res?.html || null;
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function toAbsoluteUrl(value, baseUrl) {
  if (!value) return null;
  const url = String(value).replace(/\\\//g, '/').trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  try { return new URL(url, baseUrl).toString(); } catch { return null; }
}

function unwrapAnimePelix(url) {
  try {
    const u = new URL(url);
    if (!/animepelix\.net$/i.test(u.hostname)) return url;
    const embedded = u.searchParams.get('id') || u.searchParams.get('url');
    return embedded ? safeDecode(embedded) : url;
  } catch { return url; }
}

function findHls(html) {
  if (!html) return null;
  // jwplayer / plyr / hls.js source patterns — only match CDN-like hosts, not embed pages
  const patterns = [
    /["'`](https?:\/\/(?!.*(?:ironhentai|animepelix|uqload|yourupload|mp4upload|voe\.sx|streamtape|streamhls))[^"'`\s<>]+\.m3u8(?:\?[^"'`\s<>]*)?)["'`]/i,
    /(?:file|src|hls)\s*[=:]\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /'hls'\s*:\s*'([^']+\.m3u8[^']*)'/i,
    /"hls"\s*:\s*"([^"]+\.m3u8[^"]*)"/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]?.startsWith('http')) return m[1];
  }
  return null;
}

function findMp4(html) {
  if (!html) return null;
  const matches = [
    ...html.matchAll(/(?:file|src)\s*[=:]\s*["']([^"']+\.mp4(?:\?[^"']*)?)["']/gi),
    ...html.matchAll(/["'`](https?:\/\/[^"'`\s<>]+\.mp4(?:\?[^"'`\s<>]*)?)["'`]/gi),
  ];
  for (const m of matches) {
    const candidate = m[1].replace(/\\\//g, '/');
    if (/\/player\/|\.js(?:\?|$)|\.css(?:\?|$)/i.test(candidate)) continue;
    if (/^https?:\/\//i.test(candidate)) return candidate;
  }
  return null;
}

async function probePlayable(videoUrl, type, headers = {}) {
  if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) return false;
  if (/\/(?:embed|e)\/|embed-|\.html(?:\?|$)|\.js(?:\?|$)|\.css(?:\?|$)/i.test(videoUrl) && !/\.(?:m3u8|mp4)(?:\?|$)/i.test(videoUrl)) {
    return false;
  }

  try {
    const res = await axios.get(videoUrl, {
      timeout:      8_000,
      responseType: type === 'hls' ? 'text' : 'arraybuffer',
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent':      UA,
        'Accept':          '*/*',
        'Accept-Language': 'es,en;q=0.9',
        ...headers,
        ...(type === 'mp4' ? { Range: 'bytes=0-511' } : {}),
      },
      transformResponse: [data => data],
    });

    if (res.status < 200 || res.status >= 400) return false;
    const contentType = String(res.headers['content-type'] || '').toLowerCase();

    if (type === 'hls') {
      const body = typeof res.data === 'string' ? res.data : Buffer.from(res.data || []).toString('utf8');
      return body.trimStart().startsWith('#EXTM3U') || /mpegurl|x-mpegurl/i.test(contentType);
    }

    const buf = Buffer.from(res.data || []);
    const head = buf.slice(0, 96).toString('latin1');
    return /video\/|application\/octet-stream/i.test(contentType) && head.includes('ftyp');
  } catch {
    return false;
  }
}

// StreamTape — based on streamflix pattern
async function extractStreamtape(url) {
  const html = await fetchEmbed(url, url);
  if (!html) return null;

  // Current obfuscation: getElementById('botlink').innerHTML = 'A' + ('B').substring(N)
  const m1 = html.match(/getElementById\(['"](?:botlink|robotlink)['"]\)\.innerHTML\s*=\s*["']([^"']+)["']\s*\+\s*\(["']([^"']+)["']\)\.substring\((\d+)\)/);
  if (m1) {
    const query = `${m1[1]}${m1[2].substring(Number(m1[3]))}`;
    const videoUrl = query.startsWith('http') ? query : `https://streamtape.com${query.startsWith('/') ? '' : '/'}${query}`;
    return { videoUrl, type: 'mp4', referer: 'https://streamtape.com/' };
  }

  // Older pattern: innerHTML = 'A' + 'B'
  const m2 = html.match(/innerHTML\s*=\s*["'](\/{0,2}[^"']+)["']\s*\+\s*["']([^"']+)["']/);
  if (m2) {
    const raw = `${m2[1]}${m2[2]}`;
    const videoUrl = raw.startsWith('//') ? `https:${raw}` : raw.startsWith('http') ? raw : `https:${raw}`;
    if (/streamtape|get_video/i.test(videoUrl)) return { videoUrl, type: 'mp4', referer: 'https://streamtape.com/' };
  }

  const direct = html.match(/(https:\/\/streamtape\.[a-z]+\/get_video\?[^\s"'<>]+)/);
  if (direct) return { videoUrl: direct[1], type: 'mp4', referer: 'https://streamtape.com/' };

  return null;
}

// YourUpload — jwplayer config extraction
async function extractYourUpload(url) {
  const html = await fetchEmbed(url, 'https://www.yourupload.com/');
  if (!html) return null;
  // jwplayerOptions.file or file: '...'
  const m = html.match(/file\s*:\s*['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/i)
         || html.match(/["'](https?:\/\/(?:www\.)?yucache\.net[^"']+\.(?:m3u8|mp4)[^"']*)['"]/i);
  if (!m?.[1]) return null;
  const videoUrl = m[1];
  return { videoUrl, type: /\.m3u8/i.test(videoUrl) ? 'hls' : 'mp4', referer: 'https://www.yourupload.com/' };
}

// Mp4Upload — player.src config extraction
async function extractMp4Upload(url) {
  const html = await fetchEmbed(url, 'https://www.mp4upload.com/');
  if (!html) return null;
  const videoUrl = html.match(/player\.src\(\s*\{[^}]*?src\s*:\s*["']([^"']+\.mp4[^"']*)["']/is)?.[1]
                || html.match(/player\.src\(\s*\[\s*\{[^}]*?src\s*:\s*["']([^"']+\.mp4[^"']*)["']/is)?.[1]
                || html.match(/sources\s*:\s*\[[\s\S]*?(?:file|src)\s*:\s*["']([^"']+\.mp4[^"']*)["']/i)?.[1]
                || findMp4(html);
  if (!videoUrl) return null;
  return { videoUrl: videoUrl.replace(/\\\//g, '/'), type: 'mp4', referer: url }; // CDN needs embed page as referer
}

// Uqload â€” same pattern as Streamflix: sources: ["direct.mp4"]
async function extractUqload(url) {
  const origin = new URL(url).origin;
  const html = await fetchEmbed(url, origin + '/');
  if (!html) return null;
  const videoUrl = html.match(/sources\s*:\s*\[\s*["']([^"']+\.mp4[^"']*)["']\s*\]/i)?.[1]
                || findMp4(html);
  if (!videoUrl) return null;
  return { videoUrl: videoUrl.replace(/\\\//g, '/'), type: 'mp4', referer: url, origin };
}

function rot13(input) {
  return String(input || '').replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function decryptVoePayload(encoded) {
  try {
    let value = rot13(encoded);
    for (const pattern of ['@$', '^^', '~@', '%?', '*~', '!!', '#&']) {
      value = value.split(pattern).join('_');
    }
    value = value.replace(/_/g, '');
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const shifted = Array.from(decoded, ch => String.fromCharCode(ch.charCodeAt(0) - 3)).join('');
    const reversed = Array.from(shifted).reverse().join('');
    return JSON.parse(Buffer.from(reversed, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// Voex/VOE — several patterns including their encoded JSON
async function extractVoe(url) {
  let page = await fetchEmbedResponse(url, url, { 'X-Requested-With': 'XMLHttpRequest' });
  if (!page?.html) return null;
  let html = page.html;
  let finalUrl = page.finalUrl || url;

  const redirect = html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  if (redirect) {
    page = await fetchEmbedResponse(redirect, url, { 'X-Requested-With': 'XMLHttpRequest' });
    if (!page?.html) return null;
    html = page.html;
    finalUrl = page.finalUrl || redirect;
  }

  // Pattern 1: 'hls': 'URL'
  const m1 = html.match(/'hls'\s*:\s*'([^']+\.m3u8[^']*)'/i)
          || html.match(/"hls"\s*:\s*"([^"]+\.m3u8[^"]*)"/i);
  if (m1) return { videoUrl: m1[1], type: 'hls', referer: finalUrl };

  // Pattern 2: sources array
  const m2 = html.match(/sources\s*[:=]\s*\[.*?"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/is);
  if (m2) return { videoUrl: m2[1], type: 'hls', referer: finalUrl };

  // Pattern 3: VOE's current encrypted JSON payload
  const encoded = html.match(/<script\s+type=["']application\/json["']>([\s\S]*?)<\/script>/i)?.[1]?.trim();
  if (encoded) {
    const decrypted = decryptVoePayload(encoded);
    const source = decrypted?.source || decrypted?.direct_access_url || null;
    if (source && /\.m3u8(?:\?|$)/i.test(source)) {
      return { videoUrl: source.replace(/\\\//g, '/'), type: 'hls', referer: finalUrl };
    }
  }

  // Pattern 4: base64 encoded JSON in script
  const b64 = html.match(/atob\(['"]([A-Za-z0-9+/=]{20,})['"]\)/);
  if (b64) {
    try {
      const decoded = Buffer.from(b64[1], 'base64').toString('utf8');
      const mHls = decoded.match(/"(?:hls|file|src)"\s*:\s*"([^"]+\.m3u8[^"]*)"/i);
      if (mHls) return { videoUrl: mHls[1], type: 'hls', referer: finalUrl };
    } catch { /* skip */ }
  }

  // Fallback: any m3u8 URL in the page (from known VOE CDNs)
  const m3 = html.match(/["'](https?:\/\/[^"']+\.m3u8(?:\?[^"']+)?)["']/i);
  if (m3) return { videoUrl: m3[1], type: 'hls', referer: finalUrl };

  return null;
}

// StreamHLS / SaveFiles â€” Streamflix uses /dl?op=embed&file_code=...
async function extractStreamHls(url) {
  const parsed = new URL(url);
  const fileCode = parsed.pathname.split('/').filter(Boolean).pop()?.split('?')[0];
  if (!fileCode) return null;
  const dlUrl = `${parsed.origin}/dl?op=embed&file_code=${encodeURIComponent(fileCode)}&auto=0&referer=`;
  const html = await fetchEmbed(dlUrl, url);
  if (!html) return null;
  const videoUrl = html.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i)?.[1]
                || findHls(html)
                || findMp4(html);
  if (!videoUrl) return null;
  return { videoUrl: videoUrl.replace(/\\\//g, '/'), type: /\.m3u8/i.test(videoUrl) ? 'hls' : 'mp4', referer: url };
}

// Parse tabsArray JS variable from episode page HTML
// tabsArray['1'] = "<iframe src='https://re.animepelix.net/redirect.php?id=REAL_URL'>..."
function extractTabsArray(html) {
  const result = {};
  const re = /tabsArray\['(\d+)'\]\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id        = m[1];
    const iframeRaw = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
    const srcM      = iframeRaw.match(/\bsrc=(['"])(.*?)\1/);
    if (!srcM) continue;
    result[id]  = unwrapAnimePelix(srcM[2]);
  }
  return result;
}

// Route server URL to the right extractor
// Returns { fn, referer } or null for unknown/unsupported hosts
function routeExtractor(name, url) {
  const n = name.toLowerCase();
  const u = url.toLowerCase();

  if (/streamtape/i.test(n) || /streamtape\./i.test(u))  return extractStreamtape;
  if (/yourupload/i.test(n) || /yourupload\./i.test(u))  return extractYourUpload;
  if (/mp4upload/i.test(n)  || /mp4upload\./i.test(u))   return extractMp4Upload;
  if (/uqload/i.test(n)     || /uqload\./i.test(u))      return extractUqload;
  if (/voe|voex/i.test(n)   || /voe\.sx/i.test(u))       return extractVoe;
  if (/streamhls|savefile/i.test(n) || /streamhls\./i.test(u)) return extractStreamHls;

  // ironhentai / animepelix re.php → unknown redirect chain, skip extraction
  return null;
}

// ── resolveMedia ──────────────────────────────────────────────────────────────

async function resolveMediaLegacy(mediaRef, opts = {}) {
  if (!mediaRef) throw err('animefenix: mediaRef boʻsh', 400);
  const ref = mediaRef.startsWith('http') ? mediaRef : absUrl(mediaRef);

  return swr.fetch(`media:${ref}:${opts.server || ''}`, 15 * 60_000, 30 * 60_000, async () => {
    const html = await fetchHtml(ref);
    const $    = cheerio.load(html);

    // Server names from tab buttons: <a title="StreamTape" href="#vid4">
    const serverNames = {};
    $('.episode-page__servers-list li a[href^="#vid"]').each((_, a) => {
      const idM = ($(a).attr('href') || '').match(/#vid(\d+)/);
      if (idM) serverNames[idM[1]] = $(a).attr('title') || cleanText($(a).find('span:last-child').text()) || `Server ${idM[1]}`;
    });

    const embedUrls = extractTabsArray(html);
    const servers   = Object.entries(embedUrls).map(([id, url]) => ({
      id, name: serverNames[id] || `Server ${id}`, url,
    }));

    if (servers.length === 0) throw err('animefenix: server topilmadi', 502);

    // Order: skip VIP first, then known extractable hosts first, unknowns last
    const wanted  = opts.server?.toLowerCase();
    const ordered = wanted
      ? [...servers.filter(s => s.name.toLowerCase().includes(wanted)), ...servers]
      : [
          ...servers.filter(s => !/premiun|premium|vip/i.test(s.name) && routeExtractor(s.name, s.url)),
          ...servers.filter(s => !/premiun|premium|vip/i.test(s.name) && !routeExtractor(s.name, s.url)),
          ...servers.filter(s => /premiun|premium|vip/i.test(s.name)),
        ];

    const settled = await Promise.allSettled(ordered.map(async s => {
      const baseHeaders = { 'User-Agent': UA, 'Referer': `${BASE}/` };
      const extractor   = routeExtractor(s.name, s.url);

      // No known extractor → return as iframe
      if (!extractor) {
        return { quality: s.name, videoUrl: s.url, type: 'iframe', isDefault: false, host: s.name, embed: s.url, headers: baseHeaders };
      }

      const result = await extractor(s.url).catch(() => null);

      if (!result) {
        // Extraction failed → fallback to iframe
        return { quality: s.name, videoUrl: s.url, type: 'iframe', isDefault: false, host: s.name, embed: s.url, headers: baseHeaders };
      }

      const headers = {
        'User-Agent': UA,
        'Referer':    result.referer || s.url,
        ...(result.origin ? { 'Origin': result.origin } : {}),
      };

      return {
        quality:   s.name,
        videoUrl:  result.videoUrl,
        type:      result.type,
        isDefault: false,
        host:      s.name,
        embed:     s.url,
        headers,
      };
    }));

    const resolved = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (resolved.length === 0) throw err('animefenix: video topilmadi', 502);

    // Prefer real playable sources (hls/mp4) over iframes
    const preferred = resolved.find(s => s.type === 'hls')
                   || resolved.find(s => s.type === 'mp4')
                   || resolved[0];
    preferred.isDefault = true;

    const seenUrls = new Set();
    const unique   = resolved.filter(s => {
      if (seenUrls.has(s.videoUrl)) return false;
      seenUrls.add(s.videoUrl);
      return true;
    });

    return {
      videoUrl:     preferred.videoUrl,
      type:         preferred.type,
      headers:      preferred.headers,
      videoSources: unique,
      embed:        preferred.embed,
      host:         preferred.host,
    };
  });
}

async function resolveMedia(mediaRef, opts = {}) {
  if (!mediaRef) throw err('animefenix: mediaRef boÊ»sh', 400);
  const ref = mediaRef.startsWith('http') ? mediaRef : absUrl(mediaRef);

  return swr.fetch(`media:v2:${ref}:${opts.server || ''}`, 15 * 60_000, 30 * 60_000, async () => {
    const html = await fetchHtml(ref);
    const $    = cheerio.load(html);

    const serverNames = {};
    $('.episode-page__servers-list li a[href^="#vid"]').each((_, a) => {
      const idM = ($(a).attr('href') || '').match(/#vid(\d+)/);
      if (idM) serverNames[idM[1]] = $(a).attr('title') || cleanText($(a).find('span:last-child').text()) || `Server ${idM[1]}`;
    });

    const embedUrls = extractTabsArray(html);
    const servers = Object.entries(embedUrls).map(([id, url]) => ({
      id,
      name: serverNames[id] || `Server ${id}`,
      url: toAbsoluteUrl(url, ref) || url,
    }));

    if (servers.length === 0) throw err('animefenix: server topilmadi', 502);

    const wanted = opts.server?.toLowerCase();
    const rankServer = (s) => {
      const text = `${s.name} ${s.url}`.toLowerCase();
      if (/premiun|premium|vip/.test(text)) return 90;
      if (/streamhls|savefile/.test(text)) return 0;
      if (/uqload/.test(text)) return 1;
      if (/mp4upload/.test(text)) return 2;
      if (/voe|voex/.test(text)) return 3;
      if (/yourupload/.test(text)) return 4;
      if (/streamtape/.test(text)) return 8;
      return routeExtractor(s.name, s.url) ? 20 : 50;
    };

    const matching = wanted
      ? servers.filter(s => `${s.name} ${s.url}`.toLowerCase().includes(wanted))
      : [];
    const baseOrder = matching.length ? matching : servers;
    const ordered = [...baseOrder].sort((a, b) => rankServer(a) - rankServer(b));
    const resolved = [];
    const alternates = [];
    const seenUrls = new Set();

    for (const s of ordered) {
      const extractor = routeExtractor(s.name, s.url);
      if (!extractor) {
        alternates.push({ host: s.name, embed: s.url, type: 'iframe', status: 'unsupported' });
        continue;
      }

      if (!wanted && resolved.length > 0 && /streamtape/i.test(`${s.name} ${s.url}`)) {
        alternates.push({ host: s.name, embed: s.url, type: 'iframe', status: 'skipped-slow-host' });
        continue;
      }

      const result = await extractor(s.url).catch(() => null);
      if (!result?.videoUrl) {
        alternates.push({ host: s.name, embed: s.url, type: 'iframe', status: 'extract-failed' });
        continue;
      }

      const type = result.type || (/\.m3u8(?:\?|$)/i.test(result.videoUrl) ? 'hls' : /\.mp4(?:\?|$)/i.test(result.videoUrl) ? 'mp4' : 'iframe');
      const headers = {
        'User-Agent':      UA,
        'Accept':          '*/*',
        'Accept-Language': 'es,en;q=0.9',
        'Referer':         result.referer || s.url,
        ...(result.origin ? { 'Origin': result.origin } : {}),
      };

      const playable = (type === 'hls' || type === 'mp4') && await probePlayable(result.videoUrl, type, headers);
      if (!playable) {
        alternates.push({ host: s.name, embed: s.url, videoUrl: result.videoUrl, type, status: 'probe-failed' });
        continue;
      }

      if (seenUrls.has(result.videoUrl)) continue;
      seenUrls.add(result.videoUrl);
      resolved.push({
        quality:   s.name,
        videoUrl:  result.videoUrl,
        type,
        isDefault: false,
        host:      s.name,
        embed:     s.url,
        headers,
      });

      if (!wanted && resolved.length >= 4) break;
    }

    if (resolved.length === 0) throw err('animefenix: playable video topilmadi', 502);

    const preferred = resolved.find(s => s.type === 'hls') || resolved[0];
    preferred.isDefault = true;

    return {
      videoUrl:     preferred.videoUrl,
      type:         preferred.type,
      headers:      preferred.headers,
      videoSources: resolved,
      embed:        preferred.embed,
      host:         preferred.host,
      alternates,
    };
  });
}

async function checkVideoUrl(videoUrl) {
  try {
    const res = await axios.head(videoUrl, { timeout: 8_000, headers: { 'User-Agent': UA, 'Referer': `${BASE}/` }, maxRedirects: 5 });
    return { accessible: res.status < 400, status: res.status, contentType: res.headers['content-type'] || null };
  } catch (e) {
    return { accessible: false, status: e.response?.status || 0, error: e.message };
  }
}

const CATEGORY_LIST = [
  { slug: 'anime',    label: 'Anime'    },
  { slug: 'pelicula', label: 'Película' },
  { slug: 'ova',      label: 'OVA'      },
  { slug: 'especial', label: 'Especial' },
  { slug: 'ona',      label: 'ONA'      },
];

const GENRE_LIST = [
  ['accion','Acción'],['aventura','Aventura'],['comedia','Comedia'],['drama','Drama'],
  ['ecchi','Ecchi'],['fantasia','Fantasía'],['harem','Harem'],['horror','Horror'],
  ['misterio','Misterio'],['psicologico','Psicológico'],['romance','Romance'],
  ['shounen','Shounen'],['shoujo','Shoujo'],['seinen','Seinen'],['josei','Josei'],
  ['slice-of-life','Slice of Life'],['sobrenatural','Sobrenatural'],
  ['superpoderes','Superpoderes'],['deportes','Deportes'],
  ['ciencia-ficcion','Ciencia Ficción'],['suspenso','Suspenso'],['artes-marciales','Artes Marciales'],
];

function getCategoryList() {
  return CATEGORY_LIST.map(c => ({ provider: PROVIDER, slug: c.slug, label: c.label, url: `${BASE}/directorio/anime?tipo=${encodeURIComponent(c.slug)}`, image: null }));
}
function getGenreList() {
  return GENRE_LIST.map(([slug, label]) => ({ provider: PROVIDER, slug, label, image: null, url: `${BASE}/directorio/anime?genero=${encodeURIComponent(slug)}` }));
}

module.exports = {
  name: PROVIDER, domains: ['animefenix2.tv'],
  getLatest, getCategory, getGenre, getYear, getCountry, getActor, getDirector,
  search, getHome, getDetail, getEpisodes, resolveMedia, checkVideoUrl,
  getCategoryList, getGenreList,
};
