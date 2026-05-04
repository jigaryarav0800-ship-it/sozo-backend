const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const vm = require('vm');
const { SwrCache } = require('../utils/swrCache');

const PROVIDER = 'animeav1';
const BASE = 'https://animeav1.com';
const CDN = 'https://cdn.animeav1.com';
const ZILLA = 'https://player.zilla-networks.com';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const VIDEO_HEADERS = {
    'User-Agent': UA,
    'Referer':    `${BASE}/`,
    'Origin':     BASE,
};

const ZILLA_HEADERS = {
    'User-Agent': UA,
    'Referer':    `${ZILLA}/`,
    'Origin':     ZILLA,
};

const PIXELDRAIN_HEADERS = {
    'User-Agent': UA,
    'Accept':     'video/*,*/*;q=0.8',
    'Referer':    'https://pixeldrain.com/',
};

function mp4Headers(referer) {
    return {
        'User-Agent': UA,
        'Accept':     'video/*,*/*;q=0.8',
        'Referer':    referer,
    };
}

const CATEGORY_LIST = [
    { slug: 'tv-anime', label: 'TV Anime' },
    { slug: 'pelicula', label: 'Pelicula' },
    { slug: 'ova', label: 'OVA' },
    { slug: 'ona', label: 'ONA' },
    { slug: 'especial', label: 'Especial' },
];

const GENRE_LIST = [
    ['accion', 'Accion'],
    ['aventura', 'Aventura'],
    ['ciencia-ficcion', 'Ciencia Ficcion'],
    ['comedia', 'Comedia'],
    ['drama', 'Drama'],
    ['ecchi', 'Ecchi'],
    ['fantasia', 'Fantasia'],
    ['horror', 'Horror'],
    ['misterio', 'Misterio'],
    ['psicologico', 'Psicologico'],
    ['romance', 'Romance'],
    ['slice-of-life', 'Slice of Life'],
    ['sobrenatural', 'Sobrenatural'],
    ['deportes', 'Deportes'],
    ['suspenso', 'Suspenso'],
    ['shounen', 'Shounen'],
    ['shoujo', 'Shoujo'],
    ['seinen', 'Seinen'],
    ['josei', 'Josei'],
    ['artes-marciales', 'Artes Marciales'],
    ['superpoderes', 'Superpoderes'],
];

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

const http = axios.create({
    baseURL: BASE,
    timeout: 15_000,
    httpsAgent,
    headers: {
        'User-Agent':      UA,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'es,en;q=0.9,uz;q=0.8',
        'Referer':         `${BASE}/`,
    },
});

const swr = new SwrCache({ maxEntries: 600 });
swr.startSweepTimer();

function err(message, status) {
    return Object.assign(new Error(message), { status });
}

async function fetchHtml(pathOrUrl) {
    try {
        const url = pathOrUrl.startsWith('http') ? pathOrUrl : pathOrUrl || '/';
        const res = await http.get(url, { validateStatus: () => true });
        if (res.status < 200 || res.status >= 300 || typeof res.data !== 'string') {
            throw err(`animeav1 ${res.status} for "${pathOrUrl}"`, res.status || 502);
        }
        return res.data;
    } catch (e) {
        if (e.status) throw e;
        throw err(`animeav1 network: ${e.message}`, 502);
    }
}

function absUrl(url) {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    return `${BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

function cleanText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
}

function slugFromUrl(url) {
    const path = String(url || '').replace(/^https?:\/\/[^/]+/, '');
    const m = path.match(/^\/media\/([^/?#]+)(?:\/\d+)?/);
    return m ? m[1] : null;
}

function episodeNumberFromUrl(url) {
    const m = String(url || '').match(/\/media\/[^/?#]+\/(\d+)/);
    return m ? Number(m[1]) : null;
}

function contentUrl(slug) {
    return `${BASE}/media/${slug}`;
}

function episodeUrl(slug, number) {
    return `${BASE}/media/${slug}/${number}`;
}

function cdnImage(kind, id) {
    return id ? `${CDN}/${kind}/${id}.jpg` : null;
}

function readBalanced(src, start) {
    let depth = 0;
    let quote = null;
    let escape = false;

    for (let i = start; i < src.length; i++) {
        const ch = src[i];

        if (quote) {
            if (escape) {
                escape = false;
            } else if (ch === '\\') {
                escape = true;
            } else if (ch === quote) {
                quote = null;
            }
            continue;
        }

        if (ch === '"' || ch === '\'' || ch === '`') {
            quote = ch;
            continue;
        }
        if (ch === '{') depth++;
        if (ch === '}') {
            depth--;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    return null;
}

function extractLiteral(html, key) {
    const marker = `${key}:`;
    const markerIdx = html.indexOf(marker);
    if (markerIdx === -1) return null;

    const start = html.indexOf('{', markerIdx + marker.length);
    if (start === -1) return null;

    const literal = readBalanced(html, start);
    if (!literal) return null;

    try {
        return vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 100 });
    } catch {
        return null;
    }
}

function parseCard($, el) {
    const $el = $(el);
    const href = $el.find('a[href^="/media/"]').first().attr('href');
    if (!href || /\/media\/[^/]+\/\d+/.test(href)) return null;

    const slug = slugFromUrl(href);
    if (!slug) return null;

    const title =
        cleanText($el.find('h3').first().text())
        || cleanText($el.find('.sr-only').first().text()).replace(/^Ver\s+/i, '')
        || cleanText($el.find('a[href^="/media/"]').first().attr('aria-label'));

    const img = $el.find('img').first();
    const src = img.attr('src') || img.attr('data-src') || img.attr('srcset')?.split(/\s+/)[0] || null;
    const category = cleanText($el.find('.rounded.bg-line, .text-xs.font-bold.text-subs').first().text()) || null;
    const description = cleanText($el.find('p').first().text()) || null;

    return {
        provider:   PROVIDER,
        externalId: slug,
        title:      title || slug.replace(/-/g, ' '),
        description,
        slug,
        contentUrl: contentUrl(slug),
        thumbnail:  absUrl(src),
        year:       null,
        rating:     0,
        qualities:  [],
        category,
    };
}

function parseCards(html) {
    const $ = cheerio.load(html);
    const seen = new Set();
    const out = [];

    $('article').each((_, el) => {
        const card = parseCard($, el);
        if (!card || seen.has(card.slug)) return;
        seen.add(card.slug);
        out.push(card);
    });

    return out;
}

function parseEpisodeCards(html) {
    const $ = cheerio.load(html);
    const seen = new Set();
    const out = [];

    $('a[href^="/media/"]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const number = episodeNumberFromUrl(href);
        const slug = slugFromUrl(href);
        if (!slug || !number) return;

        const key = `${slug}:${number}`;
        if (seen.has(key)) return;
        seen.add(key);

        const title = cleanText($(a).text()).replace(/^Ver\s+/i, '') || slug.replace(/-/g, ' ');
        const baseTitle = title.replace(/\s+\d+$/, '');
        out.push({
            provider:   PROVIDER,
            externalId: slug,
            title:      baseTitle,
            slug,
            contentUrl: contentUrl(slug),
            thumbnail:  null,
            year:       null,
            rating:     0,
            qualities:  [`EP ${number}`],
            category:   'Episodio',
            extra:      { latestEpisode: number, episodeUrl: episodeUrl(slug, number) },
        });
    });

    return out;
}

function parseTotalPages(html) {
    const m = html.match(/totalPages:(\d+)/);
    if (m) return Math.max(1, Number(m[1]) || 1);

    const $ = cheerio.load(html);
    let max = 1;
    $('a[href*="page="]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const p = Number((href.match(/[?&]page=(\d+)/) || [])[1]);
        if (p > max) max = p;
    });
    return max;
}

function buildCatalogPath(params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && String(v).trim() !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    return s ? `/catalogo?${s}` : '/catalogo';
}

async function listing(params = {}, extras = {}) {
    const page = Math.max(parseInt(params.page) || 1, 1);
    const path = buildCatalogPath({ ...params, page: page > 1 ? page : undefined });
    return swr.fetch(`list:${path}`, 5 * 60 * 1000, 20 * 60 * 1000, async () => {
        const html = await fetchHtml(path);
        return {
            provider:   PROVIDER,
            items:      parseCards(html),
            page,
            totalPages: parseTotalPages(html),
            ...extras,
        };
    });
}

async function getLatest(page = 1) {
    return listing({ page }, { page: Number(page) });
}

async function getCategory(category, page = 1) {
    return listing({ category, page }, { category, page: Number(page) });
}

async function getGenre(genre, page = 1) {
    return listing({ genre, page }, { genre, page: Number(page) });
}

async function getYear(year, page = 1) {
    return listing({ minYear: year, maxYear: year, page }, { year: Number(year), page: Number(page) });
}

async function getCountry() {
    throw err('animeav1 provider does not support country browse', 501);
}

async function getActor() {
    throw err('animeav1 provider does not support actor browse', 501);
}

async function getDirector() {
    throw err('animeav1 provider does not support director browse', 501);
}

async function search(query, page = 1) {
    if (!query || String(query).trim().length < 2) {
        throw err('search query must be at least 2 chars', 400);
    }
    return listing({ search: String(query).trim(), page }, { query, page: Number(page) });
}

async function getHome() {
    return swr.fetch('home', 5 * 60 * 1000, 20 * 60 * 1000, async () => {
        const html = await fetchHtml('/');
        const featured = parseCards(html).slice(0, 12);
        const latestEpisodes = parseEpisodeCards(html).slice(0, 20);
        const latest = await getLatest(1).catch(() => ({ items: [] }));

        return {
            provider: PROVIDER,
            banner:   featured.slice(0, 8),
            sections: [
                { key: 'latest-episodes', label: 'Episodios recientes', viewAll: { type: 'latest' }, items: latestEpisodes.slice(0, 12) },
                { key: 'recently-added',  label: 'Animes recientes',    viewAll: { type: 'latest' }, items: latest.items.slice(0, 12) },
                { key: 'tv-anime',        label: 'TV Anime',            viewAll: { type: 'category', slug: 'tv-anime' }, items: (await getCategory('tv-anime', 1).catch(() => ({ items: [] }))).items.slice(0, 12) },
                { key: 'movies',          label: 'Peliculas',           viewAll: { type: 'category', slug: 'pelicula' }, items: (await getCategory('pelicula', 1).catch(() => ({ items: [] }))).items.slice(0, 12) },
            ],
        };
    });
}

function parseDetailDom(html, media) {
    const $ = cheerio.load(html);
    const id = media?.id || null;
    const title = media?.title || cleanText($('h1').first().text());
    const poster = $('img[alt$="Poster"]').first().attr('src') || cdnImage('covers', id);
    const backdrop = $('img[alt$="Backdrop"]').first().attr('src') || cdnImage('backdrops', id);

    const related = [];
    for (const rel of media?.relations || []) {
        const d = rel?.destination;
        if (!d?.slug) continue;
        related.push({
            provider:   PROVIDER,
            externalId: d.slug,
            title:      d.title || d.slug.replace(/-/g, ' '),
            slug:       d.slug,
            contentUrl: contentUrl(d.slug),
            thumbnail:  cdnImage('covers', d.id),
            year:       d.startDate ? Number(String(d.startDate).slice(0, 4)) || null : null,
            rating:     0,
            qualities:  [],
            category:   null,
        });
        if (related.length >= 12) break;
    }

    return {
        provider:    PROVIDER,
        contentId:   id ? String(id) : null,
        contentUrl:  media?.slug ? contentUrl(media.slug) : null,
        title,
        description: media?.synopsis || $('meta[name="description"]').attr('content') || null,
        thumbnail:   absUrl(poster),
        banner:      absUrl(backdrop),
        year:        media?.startDate ? Number(String(media.startDate).slice(0, 4)) || null : null,
        duration:    media?.runtime ? `${media.runtime} min` : null,
        country:     'Japan',
        director:    null,
        genres:      (media?.genres || []).map(g => g.name).filter(Boolean),
        cast:        [],
        likes:       0,
        dislikes:    0,
        isSerial:    (media?.episodes || []).length > 1,
        screenshots: [],
        related,
        extra: {
            malId:         media?.malId || null,
            category:      media?.category?.name || null,
            status:        media?.status ?? null,
            score:         media?.score ?? null,
            votes:         media?.votes ?? null,
            episodesCount: media?.episodesCount ?? (media?.episodes || []).length,
            trailer:       media?.trailer || null,
        },
    };
}

async function getDetail(url) {
    const slug = slugFromUrl(url);
    if (!slug) throw err('animeav1 URL must be /media/<slug>', 400);

    return swr.fetch(`detail:${slug}`, 10 * 60 * 1000, 30 * 60 * 1000, async () => {
        const html = await fetchHtml(`/media/${slug}`);
        const media = extractLiteral(html, 'media');
        if (!media) throw err('animeav1: media data topilmadi', 502);
        return parseDetailDom(html, media);
    });
}

async function getEpisodes(url, opts = {}) {
    const slug = slugFromUrl(url);
    if (!slug) throw err('animeav1 URL must be /media/<slug>', 400);

    return swr.fetch(`episodes:${slug}:${opts.page || 1}:${opts.size || 100}:${opts.sort || 'asc'}`, 10 * 60 * 1000, 30 * 60 * 1000, async () => {
        const html = await fetchHtml(`/media/${slug}`);
        const media = extractLiteral(html, 'media');
        if (!media) throw err('animeav1: media data topilmadi', 502);

        const all = (media.episodes || [])
            .map(e => Number(e.number))
            .filter(n => Number.isFinite(n))
            .sort((a, b) => a - b);

        if (all.length <= 1) {
            const episode = all[0] || 1;
            const resolved = await resolveMedia(episodeUrl(slug, episode)).catch(() => null);
            return {
                provider:     PROVIDER,
                contentUrl:   contentUrl(slug),
                isSerial:     false,
                videoSources: resolved?.videoSources || [],
                playerSrc:    resolved?.videoUrl || null,
                type:         resolved?.type || null,
                headers:      resolved?.headers || VIDEO_HEADERS,
            };
        }

        const sort = String(opts.sort || '').toLowerCase() === 'desc' ? 'desc' : 'asc';
        const ordered = sort === 'desc' ? [...all].reverse() : all;
        const size = Math.max(1, Math.min(parseInt(opts.size) || 100, 500));
        const page = Math.max(1, parseInt(opts.page) || 1);
        const start = (page - 1) * size;

        return {
            provider:   PROVIDER,
            contentUrl: contentUrl(slug),
            isSerial:   true,
            episodes:   ordered.slice(start, start + size).map(n => ({
                episode:  n,
                label:    `Episodio ${n}`,
                mediaRef: episodeUrl(slug, n),
            })),
            page,
            size,
            total:      ordered.length,
            totalPages: Math.max(1, Math.ceil(ordered.length / size)),
            sort,
        };
    });
}

function zillaHlsFromEmbed(url) {
    const m = String(url || '').match(/player\.zilla-networks\.com\/play\/([a-f0-9]{32})/i);
    return m ? `${ZILLA}/m3u8/${m[1]}` : null;
}

function pixeldrainMp4FromEmbed(url) {
    const m = String(url || '').match(/pixeldrain\.com\/(?:u|api\/file)\/([a-z0-9]+)/i);
    return m ? `https://pixeldrain.com/api/file/${m[1]}` : null;
}

function resolveEmbedUrl(url) {
    const hls = zillaHlsFromEmbed(url);
    if (hls) {
        return {
            videoUrl: hls,
            type:     'hls',
            headers:  ZILLA_HEADERS,
            playable: true,
        };
    }

    const pixeldrain = pixeldrainMp4FromEmbed(url);
    if (pixeldrain) {
        return {
            videoUrl: pixeldrain,
            type:     'mp4',
            headers:  PIXELDRAIN_HEADERS,
            playable: true,
        };
    }

    return {
        videoUrl: url,
        type:     'iframe',
        headers:  VIDEO_HEADERS,
        playable: false,
    };
}

function hostFromUrl(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return null; }
}

async function fetchEmbedHtml(url) {
    const res = await axios.get(url, {
        timeout: 12_000,
        headers: {
            'User-Agent':      UA,
            'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
            'Accept-Language': 'es,en;q=0.9,uz;q=0.8',
            'Referer':         `${BASE}/`,
        },
        httpsAgent,
        validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300 || typeof res.data !== 'string') return null;
    return res.data;
}

function firstMatch(text, patterns) {
    for (const pattern of patterns) {
        const m = String(text || '').match(pattern);
        if (m) return m[1] || m[0];
    }
    return null;
}

async function enhanceKnownEmbed(item) {
    if (!item || item.type !== 'iframe' || !item.embed) return item;

    const host = hostFromUrl(item.embed);
    if (!host) return item;

    if (/mp4upload\.com$/i.test(host)) {
        const html = await fetchEmbedHtml(item.embed).catch(() => null);
        const videoUrl = firstMatch(html, [
            /player\.src\(\s*\{[\s\S]*?src:\s*["']([^"']+\.mp4[^"']*)["']/i,
            /["'](https?:\/\/[^"']+\/video\.mp4[^"']*)["']/i,
        ]);
        if (videoUrl) {
            return {
                ...item,
                videoUrl,
                type:     'mp4',
                headers:  mp4Headers(item.embed),
                playable: true,
            };
        }
    }

    if (/yourupload\.com$/i.test(host)) {
        const html = await fetchEmbedHtml(item.embed).catch(() => null);
        const videoUrl = firstMatch(html, [
            /file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
            /["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
        ]);
        if (videoUrl) {
            return {
                ...item,
                videoUrl,
                type:     'mp4',
                headers:  mp4Headers(item.embed),
                playable: true,
            };
        }
    }

    return item;
}

function parseEpisodeMedia(html) {
    const $ = cheerio.load(html);
    const embeds = extractLiteral(html, 'embeds') || {};
    const downloads = extractLiteral(html, 'downloads') || {};
    const items = [];

    for (const [variant, list] of Object.entries(embeds)) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            if (!item?.url) continue;
            const resolved = resolveEmbedUrl(item.url);
            items.push({
                variant,
                server: item.server || hostFromUrl(item.url) || 'embed',
                embed: item.url,
                videoUrl: resolved.videoUrl,
                type: resolved.type,
                headers: resolved.headers,
                playable: resolved.playable,
            });
        }
    }

    if (items.length === 0) {
        const iframe = $('iframe[src]').first().attr('src');
        if (iframe) {
            const resolved = resolveEmbedUrl(iframe);
            items.push({
                variant: 'SUB',
                server: resolved.type === 'hls' ? 'HLS' : (hostFromUrl(iframe) || 'iframe'),
                embed: iframe,
                videoUrl: resolved.videoUrl,
                type: resolved.type,
                headers: resolved.headers,
                playable: resolved.playable,
            });
        }
    }

    items.sort((a, b) => {
        const rank = (x) => {
            if (x.type === 'hls') return 0;
            if (x.type === 'mp4') return 1;
            return 2;
        };
        return rank(a) - rank(b);
    });

    return {
        items,
        downloads: Object.entries(downloads).flatMap(([variant, list]) =>
            Array.isArray(list) ? list.map(d => ({ variant, server: d.server, url: d.url })).filter(d => d.url) : []
        ),
    };
}

function matchesServer(item, wanted) {
    if (!wanted) return false;
    const s = String(wanted).toLowerCase();
    return [
        item.server,
        item.host,
        item.type,
        item.variant,
        `${item.variant || ''} ${item.server || ''}`,
    ].some(v => String(v || '').toLowerCase().includes(s));
}

async function resolveMedia(mediaRef, opts = {}) {
    if (!mediaRef) throw err('animeav1: mediaRef bo\'sh', 400);

    return swr.fetch(`media:${mediaRef}:${opts.server || ''}`, 20 * 60 * 1000, 30 * 60 * 1000, async () => {
        const ref = mediaRef.startsWith('http') ? mediaRef : absUrl(mediaRef);
        const html = await fetchHtml(ref);
        const parsed = parseEpisodeMedia(html);
        const items = await Promise.all(parsed.items.map(enhanceKnownEmbed));
        const downloads = parsed.downloads;
        const first = items.find(item => matchesServer(item, opts.server)) || items[0];
        if (!first) throw err('animeav1: embed topilmadi', 502);

        return {
            videoUrl:     first.videoUrl,
            type:         first.type,
            headers:      first.headers,
            videoSources: items.map((item, i) => ({
                quality:   `${item.variant || 'SUB'} ${item.server}`.trim(),
                videoUrl:  item.videoUrl,
                isDefault: item === first || (!first && i === 0),
                host:      item.server,
                type:      item.type,
                headers:   item.headers,
                embed:     item.embed,
            })),
            embed:      first.embed,
            host:       first.server,
            server:     { name: first.server, variant: first.variant },
            alternates: items.map(item => ({
                label:    `${item.variant || 'SUB'} ${item.server}`.trim(),
                host:     item.server,
                embed:    item.embed,
                videoUrl: item.videoUrl,
                type:     item.type,
                headers:  item.headers,
                playable: item.playable,
            })),
            downloads,
        };
    });
}

async function checkVideoUrl(videoUrl) {
    try {
        const headers = /player\.zilla-networks\.com/i.test(videoUrl) ? ZILLA_HEADERS : VIDEO_HEADERS;
        const res = await axios.head(videoUrl, {
            timeout: 8_000,
            headers: { ...headers, Range: 'bytes=0-0' },
            maxRedirects: 5,
            httpsAgent,
        });
        return {
            accessible:    res.status < 400,
            status:        res.status,
            contentType:   res.headers['content-type'] || null,
            contentLength: res.headers['content-length'] ? parseInt(res.headers['content-length']) : null,
            acceptRanges:  res.headers['accept-ranges'] || null,
        };
    } catch (e) {
        return { accessible: false, status: e.response?.status || 0, error: e.message };
    }
}

function getCategoryList() {
    return CATEGORY_LIST.map(c => ({
        provider: PROVIDER,
        slug:     c.slug,
        label:    c.label,
        url:      `${BASE}/catalogo?category=${encodeURIComponent(c.slug)}`,
    }));
}

function getGenreList() {
    return GENRE_LIST.map(([slug, label]) => ({
        provider: PROVIDER,
        slug,
        label,
        url:      `${BASE}/catalogo?genre=${encodeURIComponent(slug)}`,
        image:    null,
    }));
}

module.exports = {
    name:    PROVIDER,
    domains: ['animeav1.com', 'cdn.animeav1.com', 'player.zilla-networks.com'],
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
