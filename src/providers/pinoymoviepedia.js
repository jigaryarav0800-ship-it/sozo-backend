const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const { SwrCache } = require('../utils/swrCache');
const { extract: extractEmbed, findExtractor } = require('../utils/extractors');

const PROVIDER = 'pinoymoviepedia';
const BASE     = 'https://pinoymoviepedia.ru';

const CATEGORIES = {
    'movies':   { path: 'movies',                   label: 'Movies' },
    'trending': { path: 'trending',                 label: 'Trending' },
    'comedy':   { path: 'genre/comedy',             label: 'Comedy' },
    'romance':  { path: 'genre/romance',            label: 'Romance' },
    'action':   { path: 'genre/action',             label: 'Action' },
    'drama':    { path: 'genre/drama',              label: 'Drama' },
    'horror':   { path: 'genre/horror',             label: 'Horror' },
    'restored': { path: 'genre/digitally-restored', label: 'Digitally Restored' },
};

const VIDEO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Referer':    `${BASE}/`,
    'Origin':     BASE,
};

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
    timeout: 15000,
    httpsAgent,
    headers: {
        'User-Agent':      VIDEO_HEADERS['User-Agent'],
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer':         `${BASE}/`,
    },
});

const MAX_CONCURRENCY = 12;
let _running = 0;
const _queue = [];
function gate(fn) {
    return new Promise((resolve, reject) => {
        const run = () => {
            _running++;
            Promise.resolve().then(fn).then(
                v => { _running--; const n = _queue.shift(); if (n) n(); resolve(v); },
                e => { _running--; const n = _queue.shift(); if (n) n(); reject(e); }
            );
        };
        if (_running < MAX_CONCURRENCY) run();
        else _queue.push(run);
    });
}

const swr = new SwrCache({ maxEntries: 600 });
swr.startSweepTimer();

async function fetchHtml(path) {
    return gate(async () => {
        try {
            const response = await http.get(path);
            return response.data;
        } catch (err) {
            const status = err.response?.status;
            const msg = status ? `pinoymoviepedia.ru ${status} for "${path}"` : `Network error: ${err.message}`;
            throw Object.assign(new Error(msg), { status: status || 502 });
        }
    });
}

async function fetchListingHtml(path) {
    try {
        return await fetchHtml(path);
    } catch (err) {
        if (err.status === 404) return null;
        throw err;
    }
}

function emptyListing(extras) {
    return { provider: PROVIDER, items: [], totalPages: extras.page || 1, ...extras };
}

function fetchDetailHtml(url) {
    const path = url.replace(BASE, '');
    return swr.fetch(`html:${path}`, 5 * 60 * 1000, 25 * 60 * 1000, () => fetchHtml(path));
}

function ensure$(input) {
    return typeof input === 'string' ? cheerio.load(input) : input;
}

function absUrl(src) {
    if (!src) return null;
    if (src.startsWith('http')) return src;
    if (src.startsWith('//'))   return `https:${src}`;
    return `${BASE}${src.startsWith('/') ? '' : '/'}${src}`;
}

function imgFromCard($el) {
    const img = $el.find('div.poster img').first().length
        ? $el.find('div.poster img').first()
        : $el.find('img').first();
    let src = img.attr('data-src')
           || img.attr('data-lazy-src')
           || (img.attr('srcset') || '').split(' ')[0]
           || img.attr('src')
           || null;

    if (src && /\.gif/i.test(src)) {
        src = img.attr('data-wpfc-original-src') || src;
    }
    return src;
}

function externalIdFromHref(href) {
    if (!href) return null;
    const m = href.match(/\/movies\/([^/]+)\/?$/);
    return m ? m[1] : null;
}

function getProperLink(uri) {
    if (!uri) return uri;
    const epM = uri.match(new RegExp(`${BASE}/episodes/(.+?)-season`));
    if (epM) return `${BASE}/tvshows/${epM[1]}`;
    const seM = uri.match(new RegExp(`${BASE}/seasons/(.+?)-season`));
    if (seM) return `${BASE}/tvshows/${seM[1]}`;
    return uri;
}

function parseCard($, el) {
    const $el = $(el);
    const $link = $el.find('h3 > a').first();
    const rawHref = $link.attr('href');
    if (!rawHref) return null;
    const href = getProperLink(rawHref);
    const externalId = externalIdFromHref(href);
    if (!externalId) return null;

    const title = ($link.text() || $link.attr('title') || '').trim();
    const thumbnail = imgFromCard($el);
    const quality = $el.find('span.quality').first().text().trim() || null;
    const year = $el.find('span.year').first().text().trim() || null;

    return {
        provider:   PROVIDER,
        externalId,
        title,
        slug:       externalId,
        contentUrl: href,
        thumbnail:  absUrl(thumbnail),
        year:       year ? parseInt(year) || null : null,
        rating:     0,
        qualities:  quality ? [quality] : [],
        category:   null,
    };
}

function parseCards(input) {
    const $ = ensure$(input);
    const out = [];
    $('div#archive-content article, div.items.normal article, div.items.full article').each((_, el) => {
        const card = parseCard($, el);
        if (card) out.push(card);
    });
    return out;
}

function parseTotalPages(input) {
    const $ = ensure$(input);
    let max = 1;
    $('.pagination a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const m = href.match(/\/page\/(\d+)/);
        if (m) {
            const n = parseInt(m[1]);
            if (n > max) max = n;
        }
        const txt = parseInt($(el).text().trim());
        if (!isNaN(txt) && txt > max) max = txt;
    });
    return max;
}

function buildListing(html, extras) {
    const $ = cheerio.load(html);
    return {
        provider:   PROVIDER,
        items:      parseCards($),
        ...extras,
        totalPages: parseTotalPages($),
    };
}

function listingPath(basePath, page) {
    const p = Math.max(parseInt(page) || 1, 1);
    const clean = basePath.replace(/\/+$/, '').replace(/^\/+/, '');
    return p > 1 ? `/${clean}/page/${p}/` : `/${clean}/`;
}

async function getLatest(page = 1) {
    return swr.fetch(`latest:${page}`, 3 * 60 * 1000, 15 * 60 * 1000, async () => {
        const html = await fetchListingHtml(listingPath('movies', page));
        if (!html) return emptyListing({ page: Number(page) });
        return buildListing(html, { page: Number(page) });
    });
}

async function getCategory(category, page = 1) {
    const meta = CATEGORIES[category];
    if (!meta) {
        throw Object.assign(
            new Error(`Unknown category "${category}". Valid: ${Object.keys(CATEGORIES).join(', ')}`),
            { status: 400 }
        );
    }
    return swr.fetch(`cat:${category}:${page}`, 10 * 60 * 1000, 30 * 60 * 1000, async () => {
        const html = await fetchListingHtml(listingPath(meta.path, page));
        if (!html) return emptyListing({ category, page: Number(page) });
        return buildListing(html, { category, page: Number(page) });
    });
}

async function getGenre(genre, page = 1) {
    const slug = String(genre).trim().toLowerCase();
    if (!slug) throw Object.assign(new Error('genre kerak'), { status: 400 });
    return swr.fetch(`genre:${slug}:${page}`, 10 * 60 * 1000, 30 * 60 * 1000, async () => {
        const html = await fetchListingHtml(listingPath(`genre/${encodeURIComponent(slug)}`, page));
        if (!html) return emptyListing({ genre: slug, page: Number(page) });
        return buildListing(html, { genre: slug, page: Number(page) });
    });
}

async function getYear(year, page = 1) {
    return swr.fetch(`year:${year}:${page}`, 30 * 60 * 1000, 60 * 60 * 1000, async () => {
        const html = await fetchListingHtml(listingPath(`release/${year}`, page));
        if (!html) return emptyListing({ year: Number(year), page: Number(page) });
        return buildListing(html, { year: Number(year), page: Number(page) });
    });
}

async function getCountry() {
    throw Object.assign(new Error('pinoymoviepedia provider does not support country browse'), { status: 501 });
}

async function getActor() {
    throw Object.assign(new Error('pinoymoviepedia provider does not support actor browse'), { status: 501 });
}

async function getDirector() {
    throw Object.assign(new Error('pinoymoviepedia provider does not support director browse'), { status: 501 });
}

async function search(query, page = 1) {
    if (!query || String(query).trim().length < 2) {
        throw Object.assign(new Error('search query must be at least 2 chars'), { status: 400 });
    }
    return swr.fetch(`search:${query}:${page}`, 60 * 1000, 5 * 60 * 1000, async () => {
        const path = `/search/${encodeURIComponent(query.trim())}`;
        const html = await fetchListingHtml(path);
        if (!html) return emptyListing({ query, page: Number(page) });

        const $ = cheerio.load(html);
        const items = [];
        $('div.result-item').each((_, el) => {
            const $el = $(el);
            const $link = $el.find('div.title > a').first();
            const href = getProperLink($link.attr('href') || '');
            const externalId = externalIdFromHref(href);
            if (!href || !externalId) return;
            const title = $link.text().replace(/\s*\(\d{4}\)\s*$/, '').trim();
            const img = $el.find('img').first();
            const thumbnail = img.attr('src') || img.attr('data-src') || null;
            items.push({
                provider:   PROVIDER,
                externalId,
                title,
                slug:       externalId,
                contentUrl: href,
                thumbnail:  absUrl(thumbnail),
                year:       null,
                rating:     0,
                qualities:  [],
                category:   null,
            });
        });
        return { provider: PROVIDER, items, query, page: Number(page), totalPages: 1 };
    });
}

async function getHome() {
    return swr.fetch('home', 5 * 60 * 1000, 30 * 60 * 1000, async () => {
        const HOME_LIMIT = 12;
        const [trending, movies, comedy, romance, action] = await Promise.all([
            getCategory('trending', 1).catch(() => ({ items: [] })),
            getCategory('movies',   1).catch(() => ({ items: [] })),
            getCategory('comedy',   1).catch(() => ({ items: [] })),
            getCategory('romance',  1).catch(() => ({ items: [] })),
            getCategory('action',   1).catch(() => ({ items: [] })),
        ]);
        const banner = trending.items.slice(0, HOME_LIMIT);

        return {
            provider: PROVIDER,
            banner,
            sections: [
                { key: 'trending', label: 'Trending', viewAll: { type: 'category', slug: 'trending' }, items: trending.items.slice(0, HOME_LIMIT) },
                { key: 'movies',   label: 'Latest Movies', viewAll: { type: 'category', slug: 'movies' }, items: movies.items.slice(0, HOME_LIMIT) },
                { key: 'comedy',   label: 'Comedy',   viewAll: { type: 'category', slug: 'comedy' },  items: comedy.items.slice(0, HOME_LIMIT) },
                { key: 'romance',  label: 'Romance',  viewAll: { type: 'category', slug: 'romance' }, items: romance.items.slice(0, HOME_LIMIT) },
                { key: 'action',   label: 'Action',   viewAll: { type: 'category', slug: 'action' },  items: action.items.slice(0, HOME_LIMIT) },
            ],
        };
    });
}

async function getDetail(url) {
    if (!url || !url.startsWith('http')) {
        throw Object.assign(new Error('Valid absolute URL required'), { status: 400 });
    }
    return swr.fetch(`detail:${url}`, 10 * 60 * 1000, 60 * 60 * 1000, () => buildDetail(url));
}

function rowValueFromInfo($, label) {
    let val = null;
    $('div.custom_fields, div.sgeneros, div.year, div.starring').each((_, el) => {
        const $el = $(el);
        const t = $el.find('b.variante, b').first().text().trim().toLowerCase();
        if (t.startsWith(String(label).toLowerCase())) {
            val = $el.find('span.valor, .valor').first().text().trim() || null;
        }
    });
    return val;
}

async function buildDetail(url) {
    const html = await fetchDetailHtml(url);
    const $ = cheerio.load(html);

    const title = ($('div.data > h1').first().text() || $('meta[property="og:title"]').attr('content') || '')
        .replace(/\s*-\s*Watch Full Pinoy Movies Online$/i, '')
        .trim();

    const description = ($('div.wp-content > p').first().text()
                     || $('meta[property="og:description"]').attr('content')
                     || '').trim() || null;

    const thumbnail = absUrl(
        $('div.poster img').first().attr('src')
        || $('meta[property="og:image"]').attr('content')
        || null
    );

    const yearRaw = $('span.date').first().text().trim() || $('div.year a').first().text().trim();
    const year = (yearRaw.match(/(\d{4})/) || [])[1];

    const genres = [];
    $('div.sgeneros a').each((_, el) => {
        const t = $(el).text().trim();
        if (t && !genres.includes(t)) genres.push(t);
    });

    const cast = [];
    $('div#cast .person, div.persons .person').each((_, el) => {
        const $el = $(el);
        const name = $el.find('.name').text().trim() || $el.find('a').first().text().trim();
        const image = $el.find('img').attr('src');
        if (name) cast.push({ name, image: image ? absUrl(image) : null });
    });

    const country = rowValueFromInfo($, 'Country');
    const duration = rowValueFromInfo($, 'Runtime') || rowValueFromInfo($, 'Duration');
    const director = ($('div#cast .person.director').first().find('.name').text().trim()
                  || rowValueFromInfo($, 'Director')
                  || null);

    const ratingText = ($('span.dt_rating_vgs').first().text() || $('div.starstruck-rating').first().text() || '').trim();
    const rating = parseFloat(ratingText) || 0;

    const sources = parseSources($);

    const contentId = (html.match(/postid-(\d+)/) || [])[1] || null;

    const isSerial = /\/tvshows\//.test(url);

    return {
        provider:    PROVIDER,
        contentId,
        contentUrl:  url,
        title,
        description,
        thumbnail,
        banner:      null,
        year:        year ? parseInt(year) : null,
        duration:    duration || null,
        country:     country || null,
        director:    director || null,
        genres,
        cast,
        likes:       0,
        dislikes:    0,
        isSerial,
        screenshots: [],
        related:     parseRelated($),
        extra:       { sources, rating },
    };
}

function parseSources($) {
    const labels = [];
    $('li.dooplay_player_option').each((_, el) => {
        labels.push($(el).find('span.title').text().trim() || `Source ${labels.length + 1}`);
    });

    const iframes = [];
    $('iframe.metaframe').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-litespeed-src');
        if (src) iframes.push(src);
    });

    return iframes.map((src, i) => ({
        nume:  i + 1,
        label: labels[i] || `Source ${i + 1}`,
        host:  classifyHost(src),
        embed: src,
    }));
}

function classifyHost(url) {
    if (!url) return null;
    try {
        const h = new URL(url).hostname.toLowerCase();
        if (h.includes('streamhls'))  return 'streamhls';
        if (h.includes('voe.'))       return 'voe';
        if (h.includes('abstream'))   return 'abstream';
        if (h.includes('myvidplay'))  return 'myvidplay';
        if (h.includes('vidsp'))      return 'vidsp';
        if (h.includes('luluvdo'))    return 'luluvdo';
        if (h.includes('vidhide'))    return 'vidhide';
        if (h.includes('mixdrop'))    return 'mixdrop';
        if (h.includes('ds2play') || h.includes('dood')) return 'doodstream';
        if (h.includes('streamwish')) return 'streamwish';
        if (h.includes('savefiles'))  return 'savefiles';
        return h;
    } catch { return null; }
}

function parseRelated($) {
    const out = [];
    $('div#single_relacionados article, .relacionados article').each((_, el) => {
        if (out.length >= 12) return;
        const card = parseCard($, el);
        if (card) out.push(card);
    });
    return out;
}

async function getEpisodes(url) {
    if (!url || !url.startsWith('http')) {
        throw Object.assign(new Error('Valid absolute URL required'), { status: 400 });
    }
    return swr.fetch(`episodes:${url}`, 10 * 60 * 1000, 60 * 60 * 1000, async () => {
        const detail = await buildDetail(url);

        if (!detail.isSerial) {
            const sources = detail.extra?.sources ?? [];
            if (sources.length === 0) {
                return {
                    provider: PROVIDER, contentUrl: url, isSerial: false,
                    videoSources: [], playerSrc: null, headers: VIDEO_HEADERS,
                };
            }

            const { resolved, source } = await tryExtractFromSources(sources, url);
            if (resolved) {
                return {
                    provider:     PROVIDER,
                    contentUrl:   url,
                    isSerial:     false,
                    videoSources: [{
                        quality:   source.label,
                        videoUrl:  resolved.videoUrl,
                        isDefault: true,
                    }],
                    playerSrc:    resolved.videoUrl,
                    type:         resolved.type,
                    headers:      resolved.headers,
                };
            }

            const first = sources[0];
            return {
                provider:     PROVIDER,
                contentUrl:   url,
                isSerial:     false,
                videoSources: [{
                    quality:   first.label,
                    videoUrl:  first.embed,
                    isDefault: true,
                }],
                playerSrc:    first.embed,
                type:         'iframe',
                headers:      VIDEO_HEADERS,
            };
        }

        const html = await fetchDetailHtml(url);
        const $ = cheerio.load(html);
        const episodes = [];
        $('ul.episodios li').each((_, el) => {
            const $el = $(el);
            const $a = $el.find('a').first();
            const href = $a.attr('href');
            const num = parseInt($el.find('.numerando').text().split('-').pop().trim()) || (episodes.length + 1);
            const title = $el.find('.episodiotitle a').text().trim() || $a.text().trim() || `Episode ${num}`;
            const image = $el.find('.imagen img').attr('src') || null;
            const airdate = $el.find('.date').text().trim() || null;
            if (!href) return;
            episodes.push({
                episode:  num,
                label:    title,
                mediaRef: href,
                image:    image ? absUrl(image) : undefined,
                airdate:  airdate || undefined,
            });
        });
        return { provider: PROVIDER, contentUrl: url, isSerial: true, episodes };
    });
}

async function tryExtractFromSources(sources, referer) {
    const ranked = [...sources].sort((a, b) => {

        const ax = findExtractor(a.embed) ? 0 : 1;
        const bx = findExtractor(b.embed) ? 0 : 1;
        return ax - bx;
    });

    const attempts = [];
    for (const src of ranked) {
        if (!findExtractor(src.embed)) {
            attempts.push({ host: src.host, label: src.label, skipped: 'no extractor' });
            continue;
        }
        try {
            const r = await extractEmbed(src.embed, referer);
            return { resolved: r, source: src, attempts };
        } catch (err) {
            attempts.push({ host: src.host, label: src.label, error: err.message });
        }
    }
    return { resolved: null, source: null, attempts };
}

async function resolveMedia(mediaRef) {
    if (!mediaRef) {
        throw Object.assign(new Error("pinoymoviepedia: mediaRef bo'sh"), { status: 400 });
    }
    return swr.fetch(`media:${mediaRef}`, 30 * 60 * 1000, 30 * 60 * 1000, async () => {

        if (mediaRef.startsWith(BASE)) {
            const detail = await buildDetail(mediaRef);
            const sources = detail.extra?.sources ?? [];
            if (sources.length === 0) {
                throw Object.assign(new Error('pinoymoviepedia: no embeds on page'), { status: 502 });
            }

            const { resolved, source, attempts } = await tryExtractFromSources(sources, mediaRef);
            if (resolved) {
                return {
                    videoUrl: resolved.videoUrl,
                    type:     resolved.type,
                    headers:  resolved.headers,
                    poster:   resolved.poster ?? null,
                    host:     resolved.host,
                    embed:    source.embed,
                    server:   { label: source.label, nume: source.nume },

                    alternates: sources.map(s => ({ label: s.label, host: s.host, embed: s.embed })),
                };
            }

            const first = sources[0];
            return {
                videoUrl:    first.embed,
                type:        'iframe',
                headers:     VIDEO_HEADERS,
                host:        first.host,
                embed:       first.embed,
                server:      { label: first.label, nume: first.nume },
                alternates:  sources.map(s => ({ label: s.label, host: s.host, embed: s.embed })),
                attempts,
            };
        }

        const referer = `${BASE}/`;
        if (findExtractor(mediaRef)) {
            try {
                const r = await extractEmbed(mediaRef, referer);
                return {
                    videoUrl: r.videoUrl,
                    type:     r.type,
                    headers:  r.headers,
                    poster:   r.poster ?? null,
                    host:     r.host,
                    embed:    mediaRef,
                };
            } catch (err) {

            }
        }
        return {
            videoUrl: mediaRef,
            type:     'iframe',
            headers:  VIDEO_HEADERS,
            host:     classifyHost(mediaRef),
            embed:    mediaRef,
        };
    });
}

async function checkVideoUrl(videoUrl) {
    try {
        const res = await axios.head(videoUrl, {
            timeout:      8000,
            headers:      { ...VIDEO_HEADERS, Range: 'bytes=0-0' },
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
    } catch (err) {
        const status = err.response?.status || 0;
        return { accessible: status !== 404, status, error: err.message };
    }
}

function getCategoryList() {
    return Object.keys(CATEGORIES).map(slug => ({
        provider: PROVIDER,
        slug,
        label:    CATEGORIES[slug].label,
        path:     CATEGORIES[slug].path,
        url:      `${BASE}/${CATEGORIES[slug].path}/`,
    }));
}

function getGenreList() {
    return [];
}

module.exports = {
    name:    PROVIDER,
    domains: ['pinoymoviepedia.ru'],
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
