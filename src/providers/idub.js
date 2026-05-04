const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const { SwrCache } = require('../utils/swrCache');

const PROVIDER = 'idub';
const BASE = 'https://idub.tv';

const CATEGORIES = {
    'filmy':     { path: 'filmy',     label: 'Filmlar' },
    'serialy':   { path: 'serialy',   label: 'Seriallar' },
    'special':   { path: 'special',   label: 'Tez kunda' },
    'onair':     { path: 'onair',     label: 'Chiqarilmoqda' },
    'anime':     { path: 'anime',     label: 'Anime' },
    'multfilmy': { path: 'multfilmy', label: 'Multfilmlar' },
    'stoped':    { path: 'stoped',    label: "To'xtatilgan" },
};

const GENRES = [
    'Komedia', 'Drama', 'Melodramma', 'Romantika', 'Fentezi',
    'Fantastika', 'Jangari', 'Kriminal', 'Detektiv', 'Triller',
    'Mistika', 'Sarguzasht', 'Tarixiy',
];

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
        'Accept-Language': 'uz,ru;q=0.9,en;q=0.8',
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
            const msg = status ? `idub.tv returned ${status} for "${path}"` : `Network error: ${err.message}`;
            throw Object.assign(new Error(msg), { status: status || 502 });
        }
    });
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
    return `${BASE}${src.startsWith('/') ? '' : '/'}${src}`;
}

function cleanTitle(raw) {
    if (!raw) return '';
    return raw
        .replace(/\s*Online tomosha qilish.*$/i, '')
        .replace(/\s*смотреть онлайн.*$/i, '')
        .replace(/^[«"'\s]+|[»"'\s]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function externalIdFromHref(href) {
    const m = (href || '').match(/\/(\d+)-/);
    return m ? m[1] : null;
}

function slugFromHref(href) {
    const m = (href || '').match(/\/\d+-([^./]+)\.html/);
    return m ? m[1] : '';
}

function parseEpisodeBadge($el) {
    const vals = $el.find('.new-short__episode .episode__value');
    const episodes = parseInt($(vals.get(0)).text().trim());
    const seasons  = parseInt($(vals.get(1)).text().trim());
    return {
        episodes: isNaN(episodes) ? null : episodes,
        seasons:  isNaN(seasons)  ? null : seasons,
    };
}

function parseCard($, el) {
    const $el = $(el);
    const linkEl = $el.find('a.new-short__title--link').first();
    const href = linkEl.attr('href');
    if (!href) return null;

    const externalId = externalIdFromHref(href);
    if (!externalId) return null;

    const title = cleanTitle(linkEl.find('.new-short__title').text().trim() || linkEl.attr('title') || '');
    const imgEl = $el.find('img.new-short__poster--img').first();
    const thumbnail = imgEl.attr('data-src') || imgEl.attr('src') || null;
    const quality = $el.find('b.new-short__q').text().trim() || $el.find('.new-short__quality').text().trim();
    const cats = $el.find('.new-short__cats').text().replace(/\s+/g, ' ').trim();
    const epVals = $el.find('.new-short__episode .episode__value');
    const epCount = parseInt($(epVals.get(0)).text().trim()) || null;
    const seasonCount = parseInt($(epVals.get(1)).text().trim()) || null;

    return {
        provider:   PROVIDER,
        externalId,
        title,
        description: cats || null,
        slug:       slugFromHref(href),
        contentUrl: href.startsWith('http') ? href : `${BASE}${href}`,
        thumbnail:  absUrl(thumbnail),
        year:       null,
        rating:     0,
        qualities:  quality ? [quality] : [],
        category:   cats || null,
        extra:      { episodes: epCount, seasons: seasonCount },
    };
}

function parseCards(input) {
    const $ = ensure$(input);
    const items = [];
    $('article.new-short').each((_, el) => {
        const card = parseCard($, el);
        if (card) items.push(card);
    });
    return items;
}

// idub uses ajax "load more" pagination; detect presence of next-page link.
function parseHasMore(input) {
    const $ = ensure$(input);
    return $('div.navigation-ajaxload a[href]').length > 0;
}

function buildListing(html, extras) {
    const $ = cheerio.load(html);
    const items = parseCards($);
    const page = Number(extras.page) || 1;
    return {
        provider: PROVIDER,
        items,
        ...extras,
        totalPages: parseHasMore($) ? page + 1 : page,
    };
}

function listingPath(basePath, page) {
    const p = Math.max(parseInt(page) || 1, 1);
    const clean = basePath.replace(/\/+$/, '');
    return p > 1 ? `${clean}/page/${p}/` : `${clean}/`;
}

async function getLatest(page = 1) {
    return swr.fetch(`latest:${page}`, 3 * 60 * 1000, 15 * 60 * 1000, async () => {
        const path = page > 1 ? `/page/${page}/` : '/';
        const html = await fetchHtml(path);
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
        const html = await fetchHtml(listingPath(`/${meta.path}`, page));
        return buildListing(html, { category, page: Number(page) });
    });
}

async function getGenre(genre, page = 1) {
    return swr.fetch(`genre:${genre}:${page}`, 10 * 60 * 1000, 30 * 60 * 1000, async () => {
        const html = await fetchHtml(listingPath(`/xfsearch/genre/${encodeURIComponent(genre)}`, page));
        return buildListing(html, { genre, page: Number(page) });
    });
}

async function getYear(year, page = 1) {
    return swr.fetch(`year:${year}:${page}`, 30 * 60 * 1000, 60 * 60 * 1000, async () => {
        const html = await fetchHtml(listingPath(`/xfsearch/year/${year}`, page));
        return buildListing(html, { year: Number(year), page: Number(page) });
    });
}

async function getCountry(country, page = 1) {
    return swr.fetch(`country:${country}:${page}`, 30 * 60 * 1000, 60 * 60 * 1000, async () => {
        const slug = encodeURIComponent(country).replace(/%20/g, '+');
        const html = await fetchHtml(listingPath(`/xfsearch/countries/${slug}`, page));
        return buildListing(html, { country, page: Number(page) });
    });
}

async function getActor() {
    throw Object.assign(new Error('idub provider does not support actor browse'), { status: 501 });
}

async function getDirector() {
    throw Object.assign(new Error('idub provider does not support director browse'), { status: 501 });
}

async function search(query, page = 1) {
    if (!query || String(query).trim().length < 2) {
        throw Object.assign(new Error('search query must be at least 2 chars'), { status: 400 });
    }
    return swr.fetch(`search:${query}:${page}`, 60 * 1000, 5 * 60 * 1000, async () => {
        const params = new URLSearchParams({ story: String(query).trim(), do: 'search', subaction: 'search' });
        if (Number(page) > 1) params.set('search_start', String((Number(page) - 1) * 10));
        const html = await fetchHtml(`/?${params.toString()}`);
        return buildListing(html, { query, page: Number(page) });
    });
}

async function getHome() {
    return swr.fetch('home', 5 * 60 * 1000, 30 * 60 * 1000, async () => {
        const html = await fetchHtml('/');
        const $ = cheerio.load(html);

        const HOME_LIMIT = 6;

        const banner = [];
        $('.main__block_big article.new-short').each((_, el) => {
            const card = parseCard($, el);
            if (card) banner.push(card);
        });

        const sections = [];
        $('section.main__block').each((_, sec) => {
            const $sec = $(sec);
            const label = $sec.find('.main__block-title--text').first().text().trim();
            const moreHref = $sec.find('a.main__block-title--more').attr('href') || '';
            if (!label) return;
            const items = [];
            $sec.find('article.new-short').each((_, el) => {
                const card = parseCard($, el);
                if (card) items.push(card);
            });
            if (items.length === 0) return;
            sections.push({
                key:     label.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, ''),
                label,
                viewAll: viewAllFromHref(moreHref),
                items:   items.slice(0, HOME_LIMIT),
            });
        });

        return { provider: PROVIDER, banner: banner.slice(0, HOME_LIMIT), sections };
    });
}

function viewAllFromHref(href) {
    if (!href) return null;
    const path = href.replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '').replace(/^\/+/, '');
    if (CATEGORIES[path]) return { type: 'category', slug: path };
    const g = path.match(/^xfsearch\/genre\/(.+)$/);
    if (g) return { type: 'genre', slug: decodeURIComponent(g[1]) };
    const y = path.match(/^xfsearch\/year\/(\d+)$/);
    if (y) return { type: 'year', slug: y[1] };
    const c = path.match(/^xfsearch\/countries\/(.+)$/);
    if (c) return { type: 'country', slug: decodeURIComponent(c[1]) };
    return { type: 'path', slug: path };
}

function rowValueByLabel($, label) {
    let val = null;
    $('ul.xfs__block li.xfs__item_op').each((_, el) => {
        const $el = $(el);
        const t = $el.find('.xfs__item_op--title').text().trim().toLowerCase();
        if (t.startsWith(label.toLowerCase())) {
            val = $el.find('.xfs__item_op--value').text().trim() || null;
        }
    });
    return val;
}

async function getDetail(url) {
    if (!url || !url.startsWith('http')) {
        throw Object.assign(new Error('Valid absolute URL required'), { status: 400 });
    }
    return swr.fetch(`detail:${url}`, 10 * 60 * 1000, 60 * 60 * 1000, () => buildDetail(url));
}

async function buildDetail(url) {
    const html = await fetchDetailHtml(url);
    const $ = cheerio.load(html);

    const rawTitle = $('h1.fs__title').first().text().trim() ||
                     $('meta[property="og:title"]').attr('content') || '';
    const title = cleanTitle(rawTitle);

    const thumbnail = $('img.fs__poster-img').first().attr('src') ||
                      $('meta[property="og:image"]').attr('content') || null;

    let description = $('.fs__descr--text').first().clone().children().remove().end().text().trim() || null;
    if (!description) {
        const og = $('meta[property="og:description"]').attr('content') || '';
        description = og && !og.includes('||') ? og : null;
    }

    const year     = parseInt(rowValueByLabel($, 'Yil')) || null;
    const country  = rowValueByLabel($, 'Davlat');
    const age      = rowValueByLabel($, 'Yosh');
    const duration = rowValueByLabel($, 'Davomiyligi');

    const genres = [];
    $('a[href*="/xfsearch/genre/"]').each((_, el) => {
        const t = $(el).text().trim();
        if (t && !genres.includes(t)) genres.push(t);
    });

    const countries = [];
    $('a[href*="/xfsearch/countries/"]').each((_, el) => {
        const t = $(el).text().trim();
        if (t && !countries.includes(t)) countries.push(t);
    });

    const kp   = parseFloat($('b.kp__value').first().text().replace(',', '.')) || null;
    const imdb = parseFloat($('b.imdb__value').first().text().replace(',', '.')) || null;

    const likes    = parseInt($('#frate-' + (url.match(/\/(\d+)-/) || [])[1] + ' .rate-plus .rate-value').text()) || 0;
    const dislikes = parseInt($('#frate-' + (url.match(/\/(\d+)-/) || [])[1] + ' .rate-minus .rate-value').text()) || 0;

    const contentId = (url.match(/\/(\d+)-/) || [])[1] || null;

    const episodeAnchors = $('section.buttttons div.kontaiher a.BatcoH');
    const isSerial = episodeAnchors.length > 1;

    const epVals = $('.fs__poster-block .episode__value');
    const epCount = parseInt($(epVals.get(0)).text().trim()) || null;
    const seasonCount = parseInt($(epVals.get(1)).text().trim()) || null;

    const related = [];
    $('.fs__relat-block li.new-relat').each((_, el) => {
        if (related.length >= 12) return;
        const $el = $(el);
        const href = $el.find('a.new-short__title--link, a.new-short__poster--link').first().attr('href');
        if (!href) return;
        const t = $el.find('.new-short__title').text().trim();
        const img = $el.find('img.new-short__poster--img').attr('data-src') || $el.find('img').attr('src');
        related.push({
            provider:   PROVIDER,
            externalId: externalIdFromHref(href),
            title:      cleanTitle(t),
            slug:       slugFromHref(href),
            contentUrl: href.startsWith('http') ? href : `${BASE}${href}`,
            thumbnail:  absUrl(img),
            year:       null,
            rating:     0,
            qualities:  [],
            category:   null,
        });
    });

    // For movies (single BatcoH or none), capture the player iframe as movie source.
    let playerEmbed = null;
    if (!isSerial) {
        playerEmbed = $('div.tabs__content_1 iframe').attr('src') ||
                      $('div.tabs__content.active iframe').attr('src') || null;
    }

    return {
        provider:    PROVIDER,
        contentId,
        contentUrl:  url,
        title,
        description,
        thumbnail:   absUrl(thumbnail),
        banner:      null,
        year,
        duration:    duration && duration !== '---' ? duration : null,
        country:     country || (countries[0] || null),
        director:    null,
        genres,
        cast:        [],
        likes,
        dislikes,
        isSerial,
        screenshots: [],
        related,
        extra: {
            age,
            countries,
            kpRating:    kp,
            imdbRating:  imdb,
            episodes:    epCount,
            seasons:     seasonCount,
            playerEmbed,
        },
    };
}

async function getEpisodes(url) {
    if (!url || !url.startsWith('http')) {
        throw Object.assign(new Error('Valid absolute URL required'), { status: 400 });
    }
    return swr.fetch(`episodes:${url}`, 10 * 60 * 1000, 60 * 60 * 1000, () => buildEpisodes(url));
}

async function buildEpisodes(url) {
    const html = await fetchDetailHtml(url);
    const $ = cheerio.load(html);

    const anchors = $('section.buttttons div.kontaiher a.BatcoH').toArray();
    const episodes = anchors.map((a, i) => {
        const $a = $(a);
        const href = $a.attr('href') || '';
        const text = $a.text().trim();
        const num = parseInt(text) || (i + 1);
        return {
            episode:  num,
            label:    text || `Episode ${num}`,
            mediaRef: href.startsWith('http') ? href : `${BASE}${href}`,
        };
    });

    const isSerial = episodes.length > 1;

    if (isSerial) {
        return { provider: PROVIDER, contentUrl: url, isSerial: true, episodes };
    }

    // Movie path: iframe might be mover.uz (mp4) or VK / other (embed only).
    const iframe = $('div.tabs__content_1 iframe').attr('src') ||
                   $('div.tabs__content.active iframe').attr('src') || null;
    const host = classifyEmbedHost(iframe);

    if (host === 'mover') {
        const { sources } = await sourcesFromMoverEmbed(iframe);
        return {
            provider:   PROVIDER,
            contentUrl: url,
            isSerial:   false,
            videoSources: sources,
            playerSrc:  sources[0]?.videoUrl || null,
            type:       'mp4',
            host,
            headers:    {},
        };
    }

    return {
        provider:     PROVIDER,
        contentUrl:   url,
        isSerial:     false,
        videoSources: [],
        playerSrc:    iframe,
        type:         'iframe',
        host,
        headers:      {},
    };
}

function moverCodeFromUrl(url) {
    if (!url) return null;
    const m = url.match(/mover\.uz\/(?:video\/embed|watch)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
}

// Playerjs `#N`-prefixed obfuscation. Algorithm verified empirically:
//  1. Strip `#N` prefix.
//  2. Find all literal `//` positions; treat each as a marker followed by
//     32 garbage chars. Some markers fall WITHIN a previous marker's 34-char

function decodePlayerjsText(s) {
    const stripped = s.replace(/^#\d+/, '');
    const all = [];
    for (let i = 0; i < stripped.length - 1; i++) {
        if (stripped[i] === '/' && stripped[i + 1] === '/') all.push(i);
    }
    const real = [];
    let last = -Infinity;
    for (const p of all) {
        if (p >= last + 34) { real.push(p); last = p; }
    }
    let cleaned = '';
    let prev = 0;
    for (const p of real) {
        cleaned += stripped.slice(prev, p);
        prev = p + 34;
    }
    cleaned += stripped.slice(prev);
    return Buffer.from(cleaned, 'base64').toString('utf8');
}

function extractStringField(text, key) {
    const m = text.match(new RegExp(`"${key}":"([^"]*)"`));
    return m ? m[1] : null;
}

function extractNumberField(text, key) {
    const m = text.match(new RegExp(`"${key}":(\\d+)`));
    return m ? parseInt(m[1], 10) : null;
}

function parseMoverFileField(file) {
    if (!file || typeof file !== 'string') return [];
    return file.split(',')
        .map(part => {
            const m = part.match(/^\s*\[([^\]]+)\](.+?)\s*$/);
            return m ? { quality: m[1].trim(), videoUrl: m[2].trim() } : null;
        })
        .filter(Boolean);
}

function isValidMoverSourceUrl(url, code) {
    if (!url || typeof url !== 'string') return false;
    if (!/^https:\/\/v\.mover\.uz\//.test(url)) return false;
    if (!/\.mp4$/.test(url)) return false;
    if (/[^\x20-\x7e]/.test(url)) return false;
    if (code && !url.includes(code)) return false;
    return true;
}

function isValidMoverImageUrl(url, code) {
    if (!url || typeof url !== 'string') return false;
    if (!/^https:\/\/i\.mover\.uz\//.test(url)) return false;
    if (/[^\x20-\x7e]/.test(url)) return false;
    if (code && !url.includes(code)) return false;
    return true;
}

async function fetchMoverConfig(code) {
    const res = await axios.get(`https://mover.uz/video/embed/${code}`, {
        headers: {
            'User-Agent': VIDEO_HEADERS['User-Agent'],
            'Referer':    `${BASE}/`,
        },
        timeout: 12_000,
        httpsAgent,
        validateStatus: () => true,
    });
    if (res.status !== 200) return null;

    const m = res.data.match(/new Playerjs\(['"]([^'"]+)['"]\)/);
    if (!m) return null;

    const decoded = decodePlayerjsText(m[1]);
    return {
        file:       extractStringField(decoded, 'file'),
        poster:     extractStringField(decoded, 'poster'),
        thumbnails: extractStringField(decoded, 'thumbnails'),
        duration:   extractNumberField(decoded, 'duration'),
    };
}

async function sourcesFromMoverEmbed(embedUrl) {
    const code = moverCodeFromUrl(embedUrl);
    if (!code) return { sources: [], poster: null, duration: null };

    return gate(async () => {

        let best = { sources: [], poster: null, duration: null, thumbnails: null };
        for (let attempt = 0; attempt < 3; attempt++) {
            let cfg;
            try { cfg = await fetchMoverConfig(code); }
            catch { cfg = null; }
            if (!cfg) continue;

            const parsed = parseMoverFileField(cfg.file)
                .filter(s => isValidMoverSourceUrl(s.videoUrl, code));
            const sources = parsed
                .sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality))
                .map((s, i) => ({ quality: s.quality, videoUrl: s.videoUrl, isDefault: i === 0 }));

            const result = {
                sources,
                poster:     isValidMoverImageUrl(cfg.poster,     code) ? cfg.poster     : null,
                duration:   cfg.duration || null,
                thumbnails: isValidMoverImageUrl(cfg.thumbnails, code) ? cfg.thumbnails : null,
            };

            if (sources.length > best.sources.length) best = result;
            if (sources.length >= 2) return best;
        }
        return best;
    });
}

function qualityRank(q) {
    const m = String(q).match(/(\d+)/);
    return m ? parseInt(m[1]) : 0;
}

function classifyEmbedHost(embedUrl) {
    if (!embedUrl) return null;
    if (/mover\.uz\//i.test(embedUrl)) return 'mover';
    if (/vk\.com\//i.test(embedUrl) || /vkvideo\./i.test(embedUrl)) return 'vk';
    if (/youtube\.com\/|youtu\.be\//i.test(embedUrl)) return 'youtube';
    if (/ok\.ru\//i.test(embedUrl)) return 'ok';
    return 'unknown';
}

async function resolveMedia(mediaRef) {
    return swr.fetch(`media:${mediaRef}`, 30 * 60 * 1000, 30 * 60 * 1000, async () => {

        let embed = mediaRef;
        if (mediaRef.includes('idub.tv')) {
            const html = await fetchDetailHtml(mediaRef);
            const $ = cheerio.load(html);
            embed = $('div.tabs__content_1 iframe').attr('src') ||
                    $('div.tabs__content.active iframe').attr('src') || null;
        }
        if (!embed) {
            throw Object.assign(new Error('idub: player iframe topilmadi'), { status: 502 });
        }

        const host = classifyEmbedHost(embed);

        if (host === 'mover') {
            const { sources, poster, duration, thumbnails } = await sourcesFromMoverEmbed(embed);
            if (sources.length === 0) {
                throw Object.assign(new Error('idub: mover.uz manbalari ochib bo\'lmadi'), { status: 502 });
            }
            return {
                videoUrl: sources[0].videoUrl,
                type:     'mp4',

                headers:  {},
                videoSources: sources,
                poster,
                duration,
                thumbnails,
                embed,
                host,
            };
        }

        return {
            videoUrl: embed,
            type:     'iframe',
            headers:  {},
            videoSources: [],
            poster:   null,
            duration: null,
            thumbnails: null,
            embed,
            host,
        };
    });
}

async function checkVideoUrl(videoUrl) {
    try {
        const res = await axios.head(videoUrl, {
            timeout: 8000,
            headers: { ...VIDEO_HEADERS, Range: 'bytes=0-0' },
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
        url:      `${BASE}/${CATEGORIES[slug].path}`,
    }));
}

const _genreImageCache = new Map();
const GENRE_IMAGE_TTL = 7 * 24 * 60 * 60 * 1000;

function getGenreImageCached(slug) {
    const e = _genreImageCache.get(slug);
    if (!e) return null;
    if (Date.now() > e.expires) { _genreImageCache.delete(slug); return null; }
    return e.image;
}

async function fetchGenreImage(slug) {
    try {
        const html = await fetchHtml(`/xfsearch/genre/${encodeURIComponent(slug)}/`);
        const $ = cheerio.load(html);
        const first = $('article.new-short img.new-short__poster--img').first();
        const src = first.attr('data-src') || first.attr('src');
        return absUrl(src);
    } catch {
        return null;
    }
}

let _warmStarted = false;
function warmGenreImages() {
    if (_warmStarted) return;
    _warmStarted = true;
    setImmediate(async () => {
        for (const slug of GENRES) {
            if (getGenreImageCached(slug)) continue;
            const image = await fetchGenreImage(slug);
            _genreImageCache.set(slug, { image, expires: Date.now() + GENRE_IMAGE_TTL });
        }
    });
}

function getGenreList() {
    warmGenreImages();
    return GENRES.map(g => ({
        provider: PROVIDER,
        slug:     g,
        label:    g,
        url:      `${BASE}/xfsearch/genre/${encodeURIComponent(g)}/`,
        image:    getGenreImageCached(g),
    }));
}

module.exports = {
    name:    PROVIDER,
    domains: ['idub.tv'],
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
