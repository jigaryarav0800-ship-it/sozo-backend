const axios   = require('axios');
const https   = require('https');
const cheerio = require('cheerio');
const { SwrCache } = require('../utils/swrCache');

const PROVIDER = 'kinogo';
const BASE     = process.env.KINOGO_BASE_URL || 'https://kinogo-film.my';

const CATEGORIES = {
  'filmy':               'Фильмы',
  'serialy':             'Сериалы',
  'multfilmy':           'Мультфильмы',
  'russkye_serialy':     'Русские сериалы',
  'zarubezhnye_serialy': 'Зарубежные сериалы',
  'boeviki':             'Боевики',
  'komedii':             'Комедии',
  'drama':               'Драмы',
  'trillery':            'Триллеры',
  'uzhasy':              'Ужасы',
  'melodramy':           'Мелодрамы',
  'fantastika':          'Фантастика',
  'detektivy':           'Детективы',
  'anime':               'Аниме',
};

const GENRES = [
  'боевик', 'вестерн', 'военный', 'детектив', 'детский', 'документальный',
  'драма', 'исторический', 'комедия', 'криминал', 'мелодрама', 'мультфильм',
  'мюзикл', 'приключения', 'семейный', 'триллер', 'ужасы', 'фантастика', 'фэнтези',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const VIDEO_HEADERS = {
  'User-Agent': UA,
  'Referer':    `${BASE}/`,
  'Origin':     BASE,
};

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 8 });
httpsAgent.setMaxListeners(0);

const http = axios.create({
  baseURL: BASE,
  timeout: 20_000,
  httpsAgent,
  headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ru,en;q=0.8',
    'Referer': `${BASE}/`,
    'DNT': '1',
  },
});

// Cookie support (KINOGO_COOKIE env, e.g. cf_clearance=...)
http.interceptors.request.use(cfg => {
  const c = (process.env.KINOGO_COOKIE || '').trim();
  if (c) cfg.headers.Cookie = c;
  return cfg;
});

const swr = new SwrCache({ maxEntries: 600 });
swr.startSweepTimer();

// ─── helpers ──────────────────────────────────────────────────────────────────

function absUrl(src) {
  if (!src) return null;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('http')) return src;
  return `${BASE}${src.startsWith('/') ? '' : '/'}${src}`;
}

function externalIdFromHref(href) {
  const m = (href || '').match(/\/(\d+)-/);
  return m ? m[1] : null;
}

function slugFromHref(href) {
  const m = (href || '').match(/\/\d+-([^./]+)\.html/);
  return m ? m[1] : '';
}

function cleanTitle(raw) {
  if (!raw) return '';
  return raw
    .replace(/\s*\(\d{4}(?:\s*-\s*\d{4})?\)\s*$/, '')
    .replace(/\s*смотреть онлайн.*$/i, '')
    .replace(/\s*бесплатно.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensure$(input) {
  return typeof input === 'string' ? cheerio.load(input) : input;
}

// ─── fetch ────────────────────────────────────────────────────────────────────

async function fetchHtml(path) {
  try {
    const res = await http.get(path);
    const finalPath = res.request?.path;
    if (path !== '/' && finalPath === '/') {
      throw Object.assign(new Error(`kinogo: "${path}" redirected to home`), { status: 404 });
    }
    return res.data;
  } catch (err) {
    if (err.status) throw err;
    const status = err.response?.status;
    throw Object.assign(
      new Error(status ? `kinogo: ${status} for "${path}"` : `kinogo: ${err.message}`),
      { status: status || 502 }
    );
  }
}

async function fetchDetailHtml(url) {
  const path = url.replace(BASE, '');
  return swr.fetch(`html:${path}`, 5 * 60 * 1000, 25 * 60 * 1000, () => fetchHtml(path));
}

// ─── card parsing ─────────────────────────────────────────────────────────────

function parseCards(input) {
  const $ = ensure$(input);
  const items = [];
  const seen = new Set();

  // DLE shortstory cards — look for links with /uploads/ images
  $('a[href*=".html"]').each((_, el) => {
    const $el = $(el);
    if ($el.closest('#sidebar, .sidebar, footer, #footer, .related-news, .owl').length) return;

    const href = $el.attr('href') || '';
    const externalId = externalIdFromHref(href);
    if (!externalId || seen.has(externalId)) return;

    const img = $el.find('img[src*="/uploads/"], img[data-src*="/uploads/"]').first();
    if (!img.length) return;

    seen.add(externalId);
    const rawText = $el.text().replace(/\s+/g, ' ').trim();
    const yearMatch = rawText.match(/\((\d{4})\)/);
    const ratingMatch = rawText.match(/(\d\.\d)/);

    items.push({
      provider:   PROVIDER,
      externalId,
      title:      cleanTitle(rawText),
      slug:       slugFromHref(href),
      contentUrl: href.startsWith('http') ? href : `${BASE}${href}`,
      thumbnail:  absUrl(img.attr('src') || img.attr('data-src')),
      year:       yearMatch ? parseInt(yearMatch[1]) : null,
      rating:     ratingMatch ? parseFloat(ratingMatch[1]) : 0,
      qualities:  [],
      genres:     [],
      category:   null,
    });
  });

  // Fallback: article/div based cards
  if (items.length === 0) {
    $('article, .shortstory, .short-item, .item').each((_, el) => {
      const $el = $(el);
      if ($el.closest('#sidebar, .sidebar, footer, #footer').length) return;

      const $link = $el.find('a[href*=".html"]').first();
      const href = $link.attr('href') || '';
      const externalId = externalIdFromHref(href);
      if (!externalId || seen.has(externalId)) return;
      seen.add(externalId);

      const img = $el.find('img').first();
      const rawTitle = $link.attr('title') || $link.text().trim() || $el.find('h2, h3, h4').first().text().trim();
      const yearMatch = ($el.text().match(/\((\d{4})\)/) || $el.find('a[href*="/xfsearch/year/"]').first().text().match(/(\d{4})/));

      items.push({
        provider:   PROVIDER,
        externalId,
        title:      cleanTitle(rawTitle),
        slug:       slugFromHref(href),
        contentUrl: href.startsWith('http') ? href : `${BASE}${href}`,
        thumbnail:  absUrl(img.attr('src') || img.attr('data-src')),
        year:       yearMatch ? parseInt(yearMatch[1] || yearMatch[0]) : null,
        rating:     0,
        qualities:  [],
        genres:     [],
        category:   null,
      });
    });
  }

  return items;
}

function parseTotalPages(input) {
  const $ = ensure$(input);
  let max = 1;
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/\/page\/(\d+)\//);
    if (m) { const n = parseInt(m[1]); if (n > max) max = n; }
  });
  return max;
}

function buildListing(html, extras) {
  const $ = cheerio.load(html);
  return { provider: PROVIDER, items: parseCards($), ...extras, totalPages: parseTotalPages($) };
}

// ─── catalog ──────────────────────────────────────────────────────────────────

async function getLatest(page = 1) {
  return swr.fetch(`latest:${page}`, 3 * 60 * 1000, 15 * 60 * 1000, async () => {
    const html = await fetchHtml(page > 1 ? `/page/${page}/` : '/');
    return buildListing(html, { page: Number(page) });
  });
}

async function getCategory(category, page = 1) {
  if (!CATEGORIES[category]) {
    throw Object.assign(new Error(`Unknown category "${category}"`), { status: 400 });
  }
  return swr.fetch(`cat:${category}:${page}`, 10 * 60 * 1000, 30 * 60 * 1000, async () => {
    const html = await fetchHtml(page > 1 ? `/${category}/page/${page}/` : `/${category}/`);
    return buildListing(html, { category, page: Number(page) });
  });
}

async function getGenre(genre, page = 1) {
  return swr.fetch(`genre:${genre}:${page}`, 10 * 60 * 1000, 30 * 60 * 1000, async () => {
    const html = await fetchHtml(page > 1 ? `/xfsearch/genre/${encodeURIComponent(genre)}/page/${page}/` : `/xfsearch/genre/${encodeURIComponent(genre)}/`);
    return buildListing(html, { genre, page: Number(page) });
  });
}

async function getYear(year, page = 1) {
  return swr.fetch(`year:${year}:${page}`, 30 * 60 * 1000, 60 * 60 * 1000, async () => {
    const html = await fetchHtml(page > 1 ? `/xfsearch/year/${year}/page/${page}/` : `/xfsearch/year/${year}/`);
    return buildListing(html, { year: Number(year), page: Number(page) });
  });
}

async function getCountry(country, page = 1) {
  return swr.fetch(`country:${country}:${page}`, 30 * 60 * 1000, 60 * 60 * 1000, async () => {
    const html = await fetchHtml(page > 1 ? `/xfsearch/country/${encodeURIComponent(country)}/page/${page}/` : `/xfsearch/country/${encodeURIComponent(country)}/`);
    return buildListing(html, { country, page: Number(page) });
  });
}

async function getActor(actor, page = 1) {
  return swr.fetch(`actor:${actor}:${page}`, 30 * 60 * 1000, 60 * 60 * 1000, async () => {
    const html = await fetchHtml(page > 1 ? `/xfsearch/actors/${encodeURIComponent(actor)}/page/${page}/` : `/xfsearch/actors/${encodeURIComponent(actor)}/`);
    return buildListing(html, { actor, page: Number(page) });
  });
}

async function getDirector(director, page = 1) {
  return swr.fetch(`director:${director}:${page}`, 30 * 60 * 1000, 60 * 60 * 1000, async () => {
    const html = await fetchHtml(page > 1 ? `/xfsearch/directed/${encodeURIComponent(director)}/page/${page}/` : `/xfsearch/directed/${encodeURIComponent(director)}/`);
    return buildListing(html, { director, page: Number(page) });
  });
}

async function search(query, page = 1) {
  const q = String(query).trim();
  if (q.length < 3) throw Object.assign(new Error('Query must be at least 3 characters'), { status: 400 });
  return swr.fetch(`search:${q}:${page}`, 60 * 1000, 5 * 60 * 1000, async () => {
    const start = (Number(page) - 1) * 10;
    const html = await fetchHtml(`/?do=search&subaction=search&full_search=0&story=${encodeURIComponent(q)}&search_start=${start}`);
    return buildListing(html, { query: q, page: Number(page) });
  });
}

async function getHome() {
  return swr.fetch('home', 5 * 60 * 1000, 30 * 60 * 1000, async () => {
    const [homeHtml, serialy, filmy, multfilmy] = await Promise.all([
      fetchHtml('/'),
      getCategory('serialy', 1).catch(() => ({ items: [] })),
      getCategory('filmy', 1).catch(() => ({ items: [] })),
      getCategory('multfilmy', 1).catch(() => ({ items: [] })),
    ]);
    const $ = cheerio.load(homeHtml);
    return {
      provider: PROVIDER,
      banner:   parseCards($).slice(0, 8),
      sections: [
        { key: 'latest',    label: 'Новинки',      viewAll: { type: 'latest' },                       items: parseCards($).slice(0, 12) },
        { key: 'serialy',   label: 'Сериалы',      viewAll: { type: 'category', slug: 'serialy' },    items: serialy.items.slice(0, 12) },
        { key: 'filmy',     label: 'Фильмы',       viewAll: { type: 'category', slug: 'filmy' },      items: filmy.items.slice(0, 12) },
        { key: 'multfilmy', label: 'Мультфильмы',  viewAll: { type: 'category', slug: 'multfilmy' },  items: multfilmy.items.slice(0, 12) },
      ],
    };
  });
}

// ─── detail ───────────────────────────────────────────────────────────────────

async function getDetail(url) {
  if (!url || !url.startsWith('http')) {
    throw Object.assign(new Error('Valid absolute URL required'), { status: 400 });
  }
  return swr.fetch(`detail:${url}`, 10 * 60 * 1000, 60 * 60 * 1000, () => buildDetail(url));
}

async function buildDetail(url) {
  const html = await fetchDetailHtml(url);
  const $ = cheerio.load(html);

  const rawTitle = $('h1').first().text().trim()
    || $('meta[property="og:title"]').attr('content')?.trim()
    || '';

  const thumbnail = $('meta[property="og:image"]').attr('content')
    || $('img[src*="/uploads/posts/"]').first().attr('src')
    || null;

  const description = $('meta[property="og:description"]').attr('content')?.trim()
    || $('[itemprop="description"]').first().text().trim()
    || null;

  const genres = [];
  $('a[href*="/xfsearch/genre/"], a[href*="genre"]').each((_, el) => {
    const g = $(el).text().trim();
    if (g && !genres.includes(g)) genres.push(g);
  });

  const cast = [];
  $('a[href*="/xfsearch/actors/"]').each((_, el) => {
    const name = $(el).text().trim();
    if (name && cast.length < 20) {
      cast.push({
        id:    name.toLowerCase().replace(/\s+/g, '_'),
        name,
        image: null,
      });
    }
  });

  const director = $('a[href*="/xfsearch/directed/"]').first().text().trim() || null;
  const yearText = $('a[href*="/xfsearch/year/"]').first().text().trim();
  const country  = $('a[href*="/xfsearch/country/"]').first().text().trim() || null;

  const contentId = externalIdFromHref(url);

  // Detect serial by text
  const bodyText = $('body').text();
  const isSerial = /\d+\s*(?:серия|сезон)/i.test(bodyText)
    || $('iframe[src*="seria"]').length > 0;

  const related = parseCards($).slice(0, 12);

  return {
    provider:    PROVIDER,
    contentId,
    contentUrl:  url,
    title:       cleanTitle(rawTitle),
    description,
    thumbnail:   absUrl(thumbnail),
    year:        yearText ? parseInt(yearText) || null : null,
    duration:    null,
    country,
    director,
    genres:      [...new Set(genres)],
    cast,
    likes:       0,
    dislikes:    0,
    isSerial,
    screenshots: [],
    related,
  };
}

// ─── episodes ─────────────────────────────────────────────────────────────────

async function getEpisodes(url) {
  if (!url || !url.startsWith('http')) {
    throw Object.assign(new Error('Valid absolute URL required'), { status: 400 });
  }
  return swr.fetch(`episodes:${url}`, 10 * 60 * 1000, 60 * 60 * 1000, () => buildEpisodes(url));
}

async function buildEpisodes(url) {
  const html = await fetchDetailHtml(url);
  const $ = cheerio.load(html);

  // Find Kodik embed URL — try page HTML first, then AJAX
  let embedSrc = findKodikEmbed($, html);
  if (!embedSrc) {
    const contentId = externalIdFromHref(url);
    const playerHtml = await fetchPlayerHtml(contentId);
    if (playerHtml) {
      const $p = cheerio.load(playerHtml);
      embedSrc = findKodikEmbed($p, playerHtml);
    }
  }

  const bodyText = $('body').text();
  const isSerial = /\d+\s*(?:серия|сезон)/i.test(bodyText)
    || (embedSrc && /seria/i.test(embedSrc));

  if (!isSerial) {
    // Movie — resolve directly
    return {
      provider:     PROVIDER,
      contentUrl:   url,
      isSerial:     false,
      videoSources: [],
      playerSrc:    embedSrc ? absUrl(embedSrc) : null,
      type:         embedSrc ? 'iframe' : null,
      headers:      VIDEO_HEADERS,
      mediaRef:     embedSrc || url,
    };
  }

  // Serial — extract season/episode info from Kodik
  if (!embedSrc) {
    return { provider: PROVIDER, contentUrl: url, isSerial: true, episodes: [] };
  }

  const episodes = await buildKodikEpisodeList(embedSrc, url);
  return { provider: PROVIDER, contentUrl: url, isSerial: true, episodes };
}

function findKodikEmbed($, html) {
  // 1. Look for kodik/aniqit iframe directly
  let src = null;
  $('iframe[src]').each((_, el) => {
    const s = $(el).attr('src') || '';
    if (/kodik|aniqit|kodikplayer/i.test(s)) { src = s; return false; }
  });
  if (src) return src;

  // 2. Look in script tags / inline JS for kodik URLs
  const patterns = [
    /(?:src|iframe\.src|iframesrc|file|url)\s*[:=]\s*["']((?:\/\/|https?:\/\/)(?:kodik\.cc|aniqit\.com|kodik\.biz|kodikplayer\.com|kodik\.info)[^"'\s]+)["']/i,
    /((?:\/\/|https?:\/\/)(?:kodik\.cc|aniqit\.com|kodik\.biz|kodikplayer\.com|kodik\.info)\/(?:video|seria|serial)\/[^"'\s<>]+)/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }

  // 3. data-src attributes on player tabs/divs
  $('[data-src], [data-url], [data-player]').each((_, el) => {
    const s = $(el).attr('data-src') || $(el).attr('data-url') || $(el).attr('data-player') || '';
    if (/kodik|aniqit|kodikplayer/i.test(s)) { src = s; return false; }
  });
  if (src) return src;

  // 4. Any iframe as fallback
  const any = $('iframe[src]').first().attr('src');
  return any || null;
}

// DLE AJAX player loading (player tabs often load via AJAX)
async function fetchPlayerHtml(contentId) {
  if (!contentId) return null;
  try {
    const { data } = await http.post('/engine/ajax/controller.php', `mod=get_player&news_id=${contentId}`, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `${BASE}/`,
      },
    });
    return typeof data === 'string' ? data : null;
  } catch { return null; }
}

async function buildKodikEpisodeList(embedSrc, contentUrl) {
  const embedUrl = absUrl(embedSrc);
  const episodes = [];

  try {
    const { data: embedHtml } = await axios.get(embedUrl, {
      headers: { 'User-Agent': UA, 'Referer': `${BASE}/` },
      timeout: 12_000,
      httpsAgent,
    });

    // Extract season/episode data from Kodik embed
    // Look for: var defined = {"1":{"1":"...","2":"..."}, "2":{...}}
    const dataMatch = embedHtml.match(/var\s+(?:defined|seasons_data|seasonData)\s*=\s*(\{[^;]+\})/);
    if (dataMatch) {
      try {
        const seasonsData = JSON.parse(dataMatch[1]);
        for (const [seasonNum, eps] of Object.entries(seasonsData)) {
          const s = parseInt(seasonNum);
          if (isNaN(s) || s <= 0) continue;
          const epKeys = Object.keys(eps).map(Number).sort((a, b) => a - b);
          for (const epNum of epKeys) {
            episodes.push({
              episode:  episodes.length + 1,
              label:    `S${s}E${epNum}`,
              mediaRef: `${PROVIDER}:${encodeURIComponent(embedSrc)}:${s}:${epNum}`,
            });
          }
        }
      } catch {}
    }

    // Fallback: look for seriesCount/seasonsCount
    if (episodes.length === 0) {
      const seasonsMatch = embedHtml.match(/(?:seasons|total_seasons)\s*[:=]\s*(\d+)/i);
      const epsMatch = embedHtml.match(/(?:episodes|total_episodes|last_episode)\s*[:=]\s*(\d+)/i);

      const totalSeasons = parseInt(seasonsMatch?.[1]) || 1;
      const totalEps = parseInt(epsMatch?.[1]) || 1;

      if (totalSeasons === 1) {
        for (let ep = 1; ep <= totalEps; ep++) {
          episodes.push({
            episode:  ep,
            label:    `Серия ${ep}`,
            mediaRef: `${PROVIDER}:${encodeURIComponent(embedSrc)}:1:${ep}`,
          });
        }
      } else {
        // Without per-season episode counts, assume episodes are per-season
        for (let s = 1; s <= totalSeasons; s++) {
          const epsInSeason = s === totalSeasons ? totalEps : 10;
          for (let ep = 1; ep <= epsInSeason; ep++) {
            episodes.push({
              episode:  episodes.length + 1,
              label:    `S${s}E${ep}`,
              mediaRef: `${PROVIDER}:${encodeURIComponent(embedSrc)}:${s}:${ep}`,
            });
          }
        }
      }
    }
  } catch {}

  return episodes;
}

// ─── Kodik extractor ──────────────────────────────────────────────────────────

async function extractKodik(embedSrc, season, episode) {
  const embedUrl = absUrl(embedSrc);
  let fullUrl = embedUrl;
  if (season && episode) {
    const sep = embedUrl.includes('?') ? '&' : '?';
    fullUrl = `${embedUrl}${sep}season=${season}&episode=${episode}`;
  }

  // Step 1: fetch embed page
  const { data: embedHtml } = await axios.get(fullUrl, {
    headers: { 'User-Agent': UA, 'Referer': `${BASE}/` },
    timeout: 12_000,
    httpsAgent,
  });

  // Step 2: extract params
  const type = (embedHtml.match(/type:\s*'([^']+)'/) || [])[1];
  const hash = (embedHtml.match(/hash:\s*'([^']+)'/) || [])[1];
  const id   = (embedHtml.match(/id:\s*'([^']+)'/)   || [])[1];
  if (!type || !hash || !id) {
    throw Object.assign(new Error('kinogo: kodik params not found'), { status: 502 });
  }

  // Step 3: find API endpoint (Kodik rotates it)
  let apiEndpoint = null;
  const scriptMatch = embedHtml.match(/src="([^"]*player[^"]*\.js[^"]*)"/);
  if (scriptMatch) {
    const jsUrl = absUrl(scriptMatch[1]);
    try {
      const { data: js } = await axios.get(jsUrl, {
        headers: { 'User-Agent': UA },
        timeout: 8_000, httpsAgent,
      });
      const epMatch = js.match(/["'](\/[a-zA-Z0-9_-]{3,30})["']\s*[,)]/);
      if (epMatch) {
        const kodikOrigin = new URL(fullUrl).origin;
        apiEndpoint = `${kodikOrigin}${epMatch[1]}`;
      }
    } catch {}
  }
  if (!apiEndpoint) {
    const kodikOrigin = new URL(fullUrl).origin;
    apiEndpoint = `${kodikOrigin}/get-video`;
  }

  // Step 4: POST for video links
  const form = new URLSearchParams({
    pd:   'kodik.info',
    d:    new URL(BASE).hostname,
    type, hash, id,
  });
  if (season)  form.set('season',  String(season));
  if (episode) form.set('episode', String(episode));

  const { data } = await axios.post(apiEndpoint, form.toString(), {
    headers: {
      'Origin':           new URL(fullUrl).origin,
      'Referer':          fullUrl,
      'User-Agent':       UA,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type':     'application/x-www-form-urlencoded',
    },
    timeout: 10_000,
    httpsAgent,
  });

  // Step 5: parse links
  const links = data.links || {};
  const sources = [];
  for (const [quality, arr] of Object.entries(links)) {
    const src = arr?.[0]?.src;
    if (!src) continue;
    sources.push({
      quality:   `${quality}p`,
      videoUrl:  absUrl(src),
      isDefault: false,
    });
  }

  // Sort by quality (highest first)
  sources.sort((a, b) => parseInt(b.quality) - parseInt(a.quality));
  if (sources.length > 0) sources[0].isDefault = true;

  return sources;
}

// ─── media resolution ─────────────────────────────────────────────────────────

async function resolveMedia(mediaRef) {
  if (!mediaRef) throw Object.assign(new Error('kinogo: mediaRef is empty'), { status: 400 });

  let embedSrc, season = null, episode = null;

  if (mediaRef.startsWith(`${PROVIDER}:`)) {
    const parts = mediaRef.slice(PROVIDER.length + 1);
    const lastColon2 = parts.lastIndexOf(':');
    const withoutEp = parts.slice(0, lastColon2);
    episode = parseInt(parts.slice(lastColon2 + 1));
    const lastColon1 = withoutEp.lastIndexOf(':');
    season = parseInt(withoutEp.slice(lastColon1 + 1));
    embedSrc = decodeURIComponent(withoutEp.slice(0, lastColon1));
  } else {
    // Direct embed URL or content URL
    embedSrc = mediaRef;
  }

  // If it's a content page URL, extract the embed from it
  if (embedSrc.includes(BASE) || embedSrc.includes('kinogo.my')) {
    const html = await fetchDetailHtml(embedSrc);
    const $ = cheerio.load(html);
    embedSrc = findKodikEmbed($, html);
    if (!embedSrc) {
      throw Object.assign(new Error('kinogo: no embed found'), { status: 502 });
    }
  }

  const sources = await extractKodik(embedSrc, season, episode);
  if (!sources || sources.length === 0) {
    // Fallback: return iframe
    return {
      videoUrl: absUrl(embedSrc),
      type:     'iframe',
      headers:  VIDEO_HEADERS,
      embed:    absUrl(embedSrc),
      host:     'kodik',
    };
  }

  return {
    videoUrl:     sources[0].videoUrl,
    type:         'hls',
    headers:      { 'User-Agent': UA, 'Referer': absUrl(embedSrc), 'Origin': 'https://kodik.cc' },
    videoSources: sources,
  };
}

// ─── utils ────────────────────────────────────────────────────────────────────

async function checkVideoUrl(videoUrl) {
  try {
    const res = await axios.head(videoUrl, {
      timeout: 8_000, headers: VIDEO_HEADERS, maxRedirects: 5, httpsAgent,
    });
    return {
      accessible:    res.status < 400,
      status:        res.status,
      contentType:   res.headers['content-type'] || null,
      contentLength: res.headers['content-length'] ? parseInt(res.headers['content-length']) : null,
    };
  } catch (err) {
    return { accessible: false, status: err.response?.status || 0, error: err.message };
  }
}

function getCategoryList() {
  return Object.keys(CATEGORIES).map(slug => ({
    provider: PROVIDER,
    slug,
    label:    CATEGORIES[slug],
    url:      `${BASE}/${slug}/`,
  }));
}

function getGenreList() {
  return GENRES.map(g => ({
    provider: PROVIDER,
    slug:     g,
    label:    g.charAt(0).toUpperCase() + g.slice(1),
    url:      `${BASE}/xfsearch/genre/${encodeURIComponent(g)}/`,
    image:    null,
  }));
}

module.exports = {
  name:    PROVIDER,
  domains: ['kinogo.my', 'kinogo-film.my', 'kinogo.art', 'kinogo.org'],
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
};
