const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const { SwrCache } = require('../utils/swrCache');

function createUzmoviProvider({ name, base, embedHost, videoExtraction: defaultVideoExtraction, sessionCookieEnv = null }) {
    const PROVIDER = name;
    const BASE = base;

    function sessionCookie() {
        if (!sessionCookieEnv) return null;
        const v = (process.env[sessionCookieEnv] || '').trim();
        return v || null;
    }

    function authedVideoExtraction() {
        return sessionCookieEnv ? Boolean(sessionCookie()) : Boolean(defaultVideoExtraction);
    }

    const CATEGORIES = {
        'tarjima-kinolar': { path: 'tarjima-kinolarri', label: 'Tarjima kinolar' },
        'hind-kinolar':    { path: 'hind-kinolar',      label: 'Hind kinolar' },
        'seriallar':       { path: 'serialar',          label: 'Seriallar' },
        'multfilmlar':     { path: 'multfilmlari',      label: 'Multfilmlar' },
        'anime':           { path: 'anime',             label: 'Anime' },
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
            'Accept-Language': 'uz,ru;q=0.9,en;q=0.8',
            'Referer':         `${BASE}/`,
        },
    });

    http.interceptors.request.use(cfg => {
        const c = sessionCookie();
        if (!c) return cfg;
        cfg.headers.Cookie = c.includes('=') ? c : `u_session=${c}`;
        return cfg;
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
                const msg = status ? `${BASE} ${status} for "${path}"` : `Network error: ${err.message}`;
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

    function parseCard($, el) {
        const $el = $(el);
        const $linkImg = $el.find('a.short-images-link').first();
        const $linkTitle = $el.find('h4.short-link a').first();
        const href = $linkImg.attr('href') || $linkTitle.attr('href');
        if (!href) return null;
        const externalId = externalIdFromHref(href);
        if (!externalId) return null;

        const title = ($linkTitle.attr('title') || $linkTitle.text() || $linkImg.attr('title') || '').trim();
        const img = $el.find('img').first();
        const thumbnail = img.attr('src') || img.attr('data-src') || null;

        return {
            provider:   PROVIDER,
            externalId,
            title,
            slug:       slugFromHref(href),
            contentUrl: href.startsWith('http') ? href : `${BASE}${href}`,
            thumbnail:  absUrl(thumbnail),
            year:       null,
            rating:     0,
            qualities:  [],
            category:   null,
        };
    }

    function parseCards(input) {
        const $ = ensure$(input);
        const out = [];

        $('div.shortstory').each((_, el) => {
            const $el = $(el);
            if ($el.closest('#sidebar, #owl-random, .owl-random, .footer, #footer, #related-news, .home-carousel').length) return;
            const card = parseCard($, el);
            if (card) out.push(card);
        });
        return out;
    }

    function categoryPathFromUrl(url) {
        const m = String(url || '').match(/^https?:\/\/[^/]+\/([^/]+)\//);
        return m ? m[1] : null;
    }

    async function fetchRelated(url, currentId) {
        const seg = categoryPathFromUrl(url);
        if (!seg) return [];
        return swr.fetch(`related-cat:${seg}`, 10 * 60 * 1000, 30 * 60 * 1000, async () => {
            const html = await fetchListingHtml(`/${seg}`);
            if (!html) return [];
            return parseCards(html);
        }).then(items => items.filter(it => it.externalId !== currentId).slice(0, 12))
          .catch(() => []);
    }

    function parseBanner(input) {
        const $ = ensure$(input);
        const out = [];
        $('#big-slider a.cs-item').each((_, el) => {
            const $el = $(el);
            const href = $el.attr('href') || '';
            const externalId = externalIdFromHref(href);
            if (!href || !externalId) return;
            const title = ($el.attr('title') || $el.find('h1').first().text() || '').trim();
            const img = $el.find('img').first();
            const thumbnail = img.attr('src') || img.attr('data-src') || null;
            out.push({
                provider:   PROVIDER,
                externalId,
                title,
                slug:       slugFromHref(href),
                contentUrl: href.startsWith('http') ? href : `${BASE}${href}`,
                thumbnail:  absUrl(thumbnail),
                year:       null,
                rating:     0,
                qualities:  [],
                category:   'premiere',
            });
        });
        return out;
    }

    function parseHomeSections(input) {
        const $ = ensure$(input);
        const sections = [];

        $('#mainbar .owl-cat').each((_, sec) => {
            const $sec = $(sec);
            const $link = $sec.find('.h-owl a').first();
            const label = ($link.text() || $link.attr('title') || '').trim();
            const href  = $link.attr('href') || '';
            if (!label) return;

            const items = [];
            $sec.find('.home-carousel div.shortstory').each((_, el) => {
                const card = parseCard($, el);
                if (card) items.push(card);
            });
            if (items.length === 0) return;

            sections.push({
                key:     label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
                label,
                viewAll: viewAllFromHref(href),
                items,
            });
        });

        return sections;
    }

    function viewAllFromHref(href) {
        if (!href) return null;
        const path = href.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+|\/+$/g, '');

        for (const [slug, meta] of Object.entries(CATEGORIES)) {
            if (meta.path === path) return { type: 'category', slug };
        }
        const y = path.match(/^xfsearch\/year\/(\d+)$/);
        if (y) return { type: 'year', slug: y[1] };
        const c = path.match(/^xfsearch\/country\/(.+)$/);
        if (c) return { type: 'country', slug: decodeURIComponent(c[1]) };
        const t = path.match(/^tag\/(\d+)$/);
        if (t) return { type: 'genre', slug: t[1] };
        return { type: 'path', slug: path };
    }

    function parseTotalPages(input) {
        const $ = ensure$(input);
        let max = 1;
        $('div.pages a[href]').each((_, el) => {
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
        const clean = basePath.replace(/\/+$/, '');
        return p > 1 ? `${clean}/page/${p}` : `${clean}`;
    }

    async function getLatest(page = 1) {
        return swr.fetch(`latest:${page}`, 3 * 60 * 1000, 15 * 60 * 1000, async () => {
            const html = await fetchListingHtml(page > 1 ? `/page/${page}` : '/');
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
            const html = await fetchListingHtml(listingPath(`/${meta.path}`, page));
            if (!html) return emptyListing({ category, page: Number(page) });
            return buildListing(html, { category, page: Number(page) });
        });
    }

    async function getGenre(genre, page = 1) {
        const id = String(genre).trim();
        if (!/^\d+$/.test(id)) {
            throw Object.assign(new Error(`${PROVIDER}: genre must be a numeric tag id (e.g. 11403)`), { status: 400 });
        }
        return swr.fetch(`genre:${id}:${page}`, 10 * 60 * 1000, 30 * 60 * 1000, async () => {
            const html = await fetchListingHtml(listingPath(`/tag/${id}`, page));
            if (!html) return emptyListing({ genre: id, page: Number(page) });
            return buildListing(html, { genre: id, page: Number(page) });
        });
    }

    async function getYear(year, page = 1) {
        return swr.fetch(`year:${year}:${page}`, 30 * 60 * 1000, 60 * 60 * 1000, async () => {
            const html = await fetchListingHtml(listingPath(`/xfsearch/year/${year}`, page));
            if (!html) return emptyListing({ year: Number(year), page: Number(page) });
            return buildListing(html, { year: Number(year), page: Number(page) });
        });
    }

    async function getCountry(country, page = 1) {
        return swr.fetch(`country:${country}:${page}`, 30 * 60 * 1000, 60 * 60 * 1000, async () => {
            const html = await fetchListingHtml(listingPath(`/xfsearch/country/${encodeURIComponent(country)}`, page));
            if (!html) return emptyListing({ country, page: Number(page) });
            return buildListing(html, { country, page: Number(page) });
        });
    }

    async function getActor() {
        throw Object.assign(new Error(`${PROVIDER} provider does not support actor browse`), { status: 501 });
    }

    async function getDirector() {
        throw Object.assign(new Error(`${PROVIDER} provider does not support director browse`), { status: 501 });
    }

    async function search(query, page = 1) {
        if (!query || String(query).trim().length < 2) {
            throw Object.assign(new Error('search query must be at least 2 chars'), { status: 400 });
        }
        return swr.fetch(`search:${query}:${page}`, 60 * 1000, 5 * 60 * 1000, async () => {
            const params = new URLSearchParams({ do: 'search', subaction: 'search', story: String(query).trim() });
            const path = page > 1
                ? `/?do=search&subaction=search&story=${encodeURIComponent(query)}&search_start=${page}`
                : `/?${params.toString()}`;
            const html = await fetchListingHtml(path);
            if (!html) return emptyListing({ query, page: Number(page) });
            return buildListing(html, { query, page: Number(page) });
        });
    }

    async function getHome() {
        return swr.fetch('home', 5 * 60 * 1000, 30 * 60 * 1000, async () => {
            const html = await fetchHtml('/');
            const $ = cheerio.load(html);

            const banner = parseBanner($);

            const sections = parseHomeSections($);

            const HOME_LIMIT = 12;
            const presentSlugs = new Set(
                sections.map(s => s.viewAll?.type === 'category' ? s.viewAll.slug : null).filter(Boolean)
            );
            const supplementSlugs = ['multfilmlar', 'anime'].filter(s => !presentSlugs.has(s));
            const supplements = await Promise.all(
                supplementSlugs.map(slug =>
                    getCategory(slug, 1)
                        .then(r => ({ slug, items: r.items.slice(0, HOME_LIMIT) }))
                        .catch(() => ({ slug, items: [] }))
                )
            );
            for (const s of supplements) {
                if (!s.items.length) continue;
                const meta = CATEGORIES[s.slug];
                sections.push({
                    key:     s.slug.replace(/-/g, '_'),
                    label:   meta.label,
                    viewAll: { type: 'category', slug: s.slug },
                    items:   s.items,
                });
            }

            return {
                provider: PROVIDER,
                banner,
                bannerViewAll: { type: 'path', slug: 'lastnews' },
                sections,
            };
        });
    }

    function rowValueText($, label) {
        let val = null;
        $('.finfo').each((_, el) => {
            const $el = $(el);
            const t = $el.find('.finfo-title').text().trim().toLowerCase();
            if (t.startsWith(String(label).toLowerCase())) {
                val = $el.find('.finfo-text').text().trim() || null;
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
        const [html, _related] = await Promise.all([
            fetchDetailHtml(url),

            fetchRelated(url, (url.match(/\/(\d+)-/) || [])[1] || null),
        ]);
        const $ = cheerio.load(html);

        const title = ($('h1.fstory-h1 strong').first().text() || $('meta[property="og:title"]').attr('content') || '').trim();
        const description = $('blockquote.quote-card p').first().text().trim()
                         || $('meta[property="og:description"]').attr('content')
                         || null;

        const posterRaw = $('.fstory-poster img').first().attr('src') || $('meta[property="og:image"]').attr('content') || null;
        const thumbnail = posterRaw && !posterRaw.includes('ogimage') ? absUrl(posterRaw) : null;

        const year     = parseInt(rowValueText($, 'Yili')) || null;
        const country  = rowValueText($, 'Davlati');
        const duration = rowValueText($, 'Davomiyligi');
        const language = rowValueText($, 'Tili');

        const genres = [];
        $('.finfo').each((_, el) => {
            const $el = $(el);
            const t = $el.find('.finfo-title').text().trim().toLowerCase();
            if (t.startsWith('janr')) {
                $el.find('.finfo-text a strong').each((_, a) => {
                    const g = $(a).text().trim();
                    if (g && !genres.includes(g)) genres.push(g);
                });
            }
        });

        const likes    = parseInt(($('.ratingplus[data-rating-count]').first().text()  || '').replace('+', '')) || 0;
        const dislikes = parseInt(($('.ratingminus[data-rating-count]').first().text() || '').replace('-', '')) || 0;

        const contentId = (url.match(/\/(\d+)-/) || [])[1] || null;

        const isSerial = $('.batcoh-list a.batcoh-item').length > 0;

        let movieEmbed = null;
        if (!isSerial && authedVideoExtraction()) {
            $('iframe[src]').each((_, el) => {
                if (movieEmbed) return;
                const src = $(el).attr('src') || '';
                if (src.includes('/embed/')) movieEmbed = src;
            });
        }

        return {
            provider:    PROVIDER,
            contentId,
            contentUrl:  url,
            title,
            description,
            thumbnail,
            banner:      null,
            year,
            duration:    duration || null,
            country:     country || null,
            director:    null,
            genres,
            cast:        [],
            likes,
            dislikes,
            isSerial,
            screenshots: [],
            related:     _related,
            extra: {
                language: language || null,
                movieEmbed,
                videoAvailable: authedVideoExtraction(),
                ...(authedVideoExtraction() ? {} : {
                    unavailable: true,
                    unavailableReason: "Bu manba video oqimini qo'llab-quvvatlamaydi — saytda kirish (login) talab qilinadi",
                }),
            },
        };
    }

    async function getEpisodes(url, _opts = {}) {
        if (!url || !url.startsWith('http')) {
            throw Object.assign(new Error('Valid absolute URL required'), { status: 400 });
        }
        return swr.fetch(`episodes:${url}`, 10 * 60 * 1000, 60 * 60 * 1000, () => buildEpisodes(url));
    }

    async function buildEpisodes(url) {
        const html = await fetchDetailHtml(url);
        const $ = cheerio.load(html);
        const contentId = (url.match(/\/(\d+)-/) || [])[1];

        const anchors = $('.batcoh-list a.batcoh-item').toArray();
        const isSerial = anchors.length > 0;

        if (isSerial && contentId) {

            const canResolve = authedVideoExtraction();
            const byEpisode = new Map();
            for (const a of anchors) {
                const $a = $(a);
                const href = $a.attr('href') || '';
                const m = href.match(/\/episode\/(\d+)\/(\d+)\.html/);
                if (!m) continue;
                const num = parseInt(m[2]);
                if (isNaN(num)) continue;
                if (!byEpisode.has(num)) {
                    let mediaRef = null;
                    if (canResolve) {

                        mediaRef = embedHost
                            ? `${embedHost}/embed/${contentId}?episode=${num}`
                            : (href.startsWith('http') ? href : `${BASE}${href}`);
                    }
                    byEpisode.set(num, {
                        episode:  num,
                        label:    $a.attr('title') || $a.text().trim() || `${num}-qism`,
                        mediaRef,
                    });
                }
            }
            const episodes = [...byEpisode.values()].sort((a, b) => a.episode - b.episode);
            return { provider: PROVIDER, contentUrl: url, isSerial: true, episodes };
        }

        if (!authedVideoExtraction()) {
            return {
                provider: PROVIDER, contentUrl: url, isSerial: false,
                videoSources: [], playerSrc: null, headers: VIDEO_HEADERS,
                extra: {
                    unavailable: true,
                    unavailableReason: "Bu manba video oqimini qo'llab-quvvatlamaydi — saytda kirish (login) talab qilinadi",
                },
            };
        }

        let embed = null;
        $('iframe[src]').each((_, el) => {
            if (embed) return;
            const src = $(el).attr('src') || '';
            if (src.includes('/embed/')) embed = src;
        });

        if (!embed) {
            return {
                provider: PROVIDER, contentUrl: url, isSerial: false,
                videoSources: [], playerSrc: null, headers: VIDEO_HEADERS,
            };
        }

        const resolved = await extractFromEmbed(embed).catch(() => null);
        if (!resolved?.videoUrl) {
            return {
                provider: PROVIDER, contentUrl: url, isSerial: false,
                videoSources: [], playerSrc: null, headers: VIDEO_HEADERS,
                extra: { embed },
            };
        }

        return {
            provider:     PROVIDER,
            contentUrl:   url,
            isSerial:     false,
            videoSources: [{ quality: resolved.quality || 'auto', videoUrl: resolved.videoUrl, isDefault: true }],
            playerSrc:    resolved.videoUrl,
            type:         resolved.videoUrl.includes('.m3u8') ? 'hls' : 'mp4',
            headers:      VIDEO_HEADERS,
        };
    }

    async function extractFromEmbed(embedUrl) {
        return gate(async () => {
            const res = await axios.get(embedUrl, {
                headers: { 'User-Agent': VIDEO_HEADERS['User-Agent'], Referer: `${BASE}/` },
                timeout: 12_000,
                httpsAgent,
                validateStatus: () => true,
            });
            if (res.status !== 200 || typeof res.data !== 'string') return null;

            const fileMatch    = res.data.match(/file:\s*['"]([^'"]+)['"]/);
            const posterMatch  = res.data.match(/poster:\s*['"]([^'"]+)['"]/);
            const qualityMatch = res.data.match(/default_quality:\s*['"]([^'"]+)['"]/);

            if (!fileMatch) return null;
            return {
                videoUrl: fileMatch[1],
                poster:   posterMatch ? posterMatch[1] : null,
                quality:  qualityMatch ? qualityMatch[1] : 'auto',
            };
        });
    }

    async function findEmbedOnSitePage(siteUrl) {
        const path = siteUrl.replace(/^https?:\/\/[^/]+/, '');
        const html = await fetchHtml(path);
        const $ = cheerio.load(html);
        let embed = null;
        $('iframe[src]').each((_, el) => {
            if (embed) return;
            const src = $(el).attr('src') || '';
            if (src.includes('/embed/')) embed = src;
        });
        return embed;
    }

    async function resolveMedia(mediaRef) {
        if (!authedVideoExtraction()) {
            throw Object.assign(
                new Error(`${PROVIDER}: bu manba video oqimini qo'llab-quvvatlamaydi (faqat metadata mavjud)`),
                { status: 501 }
            );
        }
        if (!mediaRef) {
            throw Object.assign(new Error(`${PROVIDER}: mediaRef bo'sh`), { status: 400 });
        }
        return swr.fetch(`media:${mediaRef}`, 30 * 60 * 1000, 30 * 60 * 1000, async () => {

            let embedUrl = mediaRef;
            if (!/\/embed\//.test(mediaRef) && mediaRef.startsWith(BASE)) {
                embedUrl = await findEmbedOnSitePage(mediaRef);
                if (!embedUrl) {
                    throw Object.assign(
                        new Error(`${PROVIDER}: episode sahifasida iframe topilmadi — session cookie eskirgan bo'lishi mumkin`),
                        { status: 502 }
                    );
                }
            }

            const resolved = await extractFromEmbed(embedUrl);
            if (!resolved?.videoUrl) {
                throw Object.assign(new Error(`${PROVIDER}: video manbasi topilmadi (premium yoki o'chirilgan)`), { status: 502 });
            }
            return {
                videoUrl: resolved.videoUrl,
                type:     resolved.videoUrl.includes('.m3u8') ? 'hls' : 'mp4',
                headers:  VIDEO_HEADERS,
                videoSources: [{ quality: resolved.quality, videoUrl: resolved.videoUrl, isDefault: true }],
                poster:   resolved.poster,
                embed:    embedUrl,
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
            url:      `${BASE}/${CATEGORIES[slug].path}`,
        }));
    }

    function getGenreList() {

        return [];
    }

    return {
        name:    PROVIDER,
        domains: [BASE.replace(/^https?:\/\//, '')],
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
}

module.exports = createUzmoviProvider({
    name:            'uzmovi',
    base:            'https://uzmovi.tv',
    embedHost:       'https://uzdown.live',
    videoExtraction: true,
});
