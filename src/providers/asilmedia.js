const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const { SwrCache } = require('../utils/swrCache');

const PROVIDER = 'asilmedia';
const BASE = 'https://asilmedia.org';

const CATEGORIES = {
    'tarjima-kinolar': 'films/tarjima_kinolar',
    'rus-kinolar': 'films/rusfilm',
    'seriallar': 'films/serial',
    'multfilmlar': 'films/multfilmlar_multiklar',
};

const GENRES = ['boevik', 'komediya', 'drama', 'melodrama', 'triller', 'fantastika', 'kriminal', 'detektiv', 'anime', 'multfilm', 'sarguzasht', 'ужасы', 'biografik', 'tarixiy', 'musiqiy'];

const GENRE_IMAGES = {
    boevik: 'https://image.tmdb.org/t/p/w276_and_h350_face/zfbjgQE1uSd9wiPTX4VzsLi0rGG.jpg',
    komediya: 'https://image.tmdb.org/t/p/w276_and_h350_face/9FeYBZDvNTh4ZmweekJvwyIxIiL.jpg',
    drama: 'https://image.tmdb.org/t/p/w276_and_h350_face/2u7zbn8EudG6kLlBzUYqP8RyFU4.jpg',
    melodrama: 'https://image.tmdb.org/t/p/w276_and_h350_face/foGkPxpw9h8zln81j63mix5B7m8.jpg',
    triller: 'https://image.tmdb.org/t/p/w276_and_h350_face/fptnZJbLzKUHeNlYrAynbyoL5YJ.jpg',
    fantastika: 'https://image.tmdb.org/t/p/w276_and_h350_face/9BBTo63ANSmhC4e6r62OJFuK2GL.jpg',
    kriminal: 'https://image.tmdb.org/t/p/w276_and_h350_face/jJJQ1PPXUEchqyZ9YyWzgSNU39Z.jpg',
    detektiv: 'https://image.tmdb.org/t/p/w276_and_h350_face/8rvLEmdI4gLrMO1rLqbNdnNcPFE.jpg',
    anime: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1535-kUgkcrfOrkUM.jpg',
    multfilm: 'https://image.tmdb.org/t/p/w276_and_h350_face/b3NhrYsr1X5r7zgjJDRMNOqXZS9.jpg',
    sarguzasht: 'https://image.tmdb.org/t/p/w276_and_h350_face/efC1n5QU7newjfgqyOPmsnwSky3.jpg',
    ужасы: 'https://image.tmdb.org/t/p/w276_and_h350_face/8VyTWJrNEyV2MTWvniDVp0MpOAe.jpg',
    biografik: 'https://image.tmdb.org/t/p/w276_and_h350_face/9mDlwBdCu501924dXnzz2Gtc8XI.jpg',
    tarixiy: 'https://i.guim.co.uk/img/media/cf05d3e7596f8cbac09b66810e73979544077cb3/0_37_2992_1796/master/2992.jpg?width=1900&dpr=1&s=none&crop=none',
    musiqiy: 'https://image.tmdb.org/t/p/w276_and_h350_face/jNG7pl0DkN1nzxnbZj4MCGf2VEG.jpg',
};

const VIDEO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
    'Referer': `${BASE}/`,
    'Accept': '*/*',
    'Accept-Language': 'uz,ru;q=0.9,en;q=0.8',
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
    timeout: 20000,
    httpsAgent,
    headers: {
        'User-Agent': VIDEO_HEADERS['User-Agent'],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': VIDEO_HEADERS['Accept-Language'],
        'DNT': '1',
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
            const finalPath = response.request?.path;
            if (path !== '/' && finalPath === '/') {
                throw Object.assign(new Error(`asilmedia.org redirected "${path}" to home page`), {status: 404});
            }
            return response.data;
        } catch (err) {
            const status = err.response?.status;
            const msg = status ? `asilmedia.org returned ${status} for "${path}"` : `Network error: ${err.message}`;
            throw Object.assign(new Error(msg), {status: status || 502});
        }
    });
}

async function fetchDetailHtml(url) {
    const path = url.replace(BASE, '');
    return swr.fetch(`html:${path}`, 5 * 60 * 1000, 25 * 60 * 1000, () => fetchHtml(path));
}

function absUrl(src) {
    if (!src) return null;
    return src.startsWith('http') ? src : `${BASE}${src}`;
}

function parseTitle(raw) {
    if (!raw) return '';
    if (raw.includes(' / ')) return raw.split(' / ')[0].trim();
    return raw.split(' ').slice(0, 4).join(' ').trim();
}

function unwrapPlayerUrl(src) {
    if (!src) return null;
    if (!src.includes('player.html')) return src;
    const m = src.match(/[?&]file=([^&]+)/);
    if (!m) return src;
    try {
        return decodeURIComponent(m[1]);
    } catch {
        return m[1];
    }
}

function normalizeVideoUrl(raw) {
    if (!raw) return null;
    return raw.replace(/ /g, '%20');
}

function ensure$(input) {
    return typeof input === 'string' ? cheerio.load(input) : input;
}

function parseCards(input) {
    const $ = ensure$(input);
    const items = [];

    $('article.card').each((_, el) => {
        const $el = $(el);
        const $link = $el.find('a.card__link');
        const href = $link.attr('href') || '';
        if (!href) return;

        const idMatch = href.match(/\/(\d+)-/);
        if (!idMatch) return;

        const externalId = idMatch[1];
        const contentUrl = href.startsWith('http') ? href : `${BASE}${href}`;
        const slugMatch = href.match(/\/\d+-(.+?)\.html/);

        const imgEl = $el.find('img.img-cover');
        const imgSrc = imgEl.attr('src') || imgEl.attr('data-src') || '';

        const rawTitle = $el.find('.card__title').clone().children().remove().end().text().trim() || imgEl.attr('alt') || $link.attr('title') || '';
        const title = parseTitle(rawTitle);

        const ratingRaw = $el.find('.ratingtypeplusminus').text().trim();

        const qualities = [];
        $el.find('.badge--hd, .badge--quality').each((_, b) => {
            const q = $(b).text().trim();
            if (q) qualities.push(q);
        });

        const $meta = $el.find('.card__meta');
        const yearText = $meta.find('a[href*="/xfsearch/year/"]').text().trim();
        const categoryText = $meta.find('span').first().text().trim();

        items.push({
            provider: PROVIDER,
            externalId,
            title,
            description: rawTitle,
            slug: slugMatch ? slugMatch[1] : '',
            contentUrl,
            thumbnail: absUrl(imgSrc),
            year: yearText ? parseInt(yearText) || null : null,
            rating: parseInt(ratingRaw) || 0,
            qualities,
            category: categoryText || null,
        });
    });

    return items;
}

function parseBanner(input) {
    const $ = ensure$(input);
    const items = [];

    $('.hero-slider .swiper-slide .slider-card').each((_, el) => {
        const $el = $(el);
        const href = $el.find('a.slider-card__link').attr('href') || '';
        if (!href) return;

        const idMatch = href.match(/\/(\d+)-/);
        if (!idMatch) return;

        const externalId = idMatch[1];
        const contentUrl = href.startsWith('http') ? href : `${BASE}${href}`;
        const slugMatch = href.match(/\/\d+-(.+?)\.html/);

        const imgSrc = $el.find('img.slider-card__img').attr('src') || '';
        const rawTitle = $el.find('h3.slider-card__title').text().trim();
        const title = parseTitle(rawTitle);
        const yearText = $el.find('.slider-card__year a').text().trim();
        const ratingRaw = $el.find('.ratingtypeplusminus').text().trim();
        const genreText = $el.find('.slider-card__genre').text().trim();

        if (!title || !contentUrl) return;

        items.push({
            provider: PROVIDER,
            externalId,
            title,
            description: rawTitle,
            slug: slugMatch ? slugMatch[1] : '',
            contentUrl,
            thumbnail: absUrl(imgSrc),
            year: yearText ? parseInt(yearText) || null : null,
            rating: parseInt(ratingRaw) || 0,
            qualities: [],
            category: null,
            genres: genreText ? genreText.split(',').map(g => g.trim()).filter(Boolean) : [],
        });
    });

    return items;
}

function parseTotalPages(input) {
    const $ = ensure$(input);
    let max = 1;
    $('div.pagination a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const m = href.match(/\/page\/(\d+)\//);
        if (m) {
            const n = parseInt(m[1]);
            if (n > max) max = n;
        }
        const text = parseInt($(el).text().trim());
        if (!isNaN(text) && text > max) max = text;
    });
    return max;
}

function buildListing(html, extras) {
    const $ = cheerio.load(html);
    return { provider: PROVIDER, items: parseCards($), ...extras, totalPages: parseTotalPages($) };
}

async function getLatest(page = 1) {
    return swr.fetch(`latest:${page}`, 3 * 60 * 1000, 15 * 60 * 1000, async () => {
        const html = await fetchHtml(page > 1 ? `/page/${page}/` : '/');
        return buildListing(html, { page: Number(page) });
    });
}

async function getCategory(category, page = 1) {
    const catPath = CATEGORIES[category];
    if (!catPath) {
        throw Object.assign(new Error(`Unknown category "${category}". Valid: ${Object.keys(CATEGORIES).join(', ')}`), {status: 400});
    }
    return swr.fetch(`cat:${category}:${page}`, 10 * 60 * 1000, 30 * 60 * 1000, async () => {
        const html = await fetchHtml(page > 1 ? `/${catPath}/page/${page}/` : `/${catPath}/`);
        return buildListing(html, { category, page: Number(page) });
    });
}

async function getGenre(genre, page = 1) {
    return swr.fetch(`genre:${genre}:${page}`, 10 * 60 * 1000, 30 * 60 * 1000, async () => {
        const html = await fetchHtml(page > 1 ? `/xfsearch/genre/${genre}/page/${page}/` : `/xfsearch/genre/${genre}/`);
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
        const html = await fetchHtml(page > 1 ? `/xfsearch/world/${encodeURIComponent(country)}/page/${page}/` : `/xfsearch/world/${encodeURIComponent(country)}/`);
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
    return swr.fetch(`search:${query}:${page}`, 60 * 1000, 5 * 60 * 1000, async () => {
        const start = (Number(page) - 1) * 10;
        const html = await fetchHtml(`/?do=search&subaction=search&search_start=${start}&full_search=0&story=${encodeURIComponent(query)}`);
        return buildListing(html, { query, page: Number(page) });
    });
}

async function getHome() {
    return swr.fetch('home', 5 * 60 * 1000, 30 * 60 * 1000, async () => {
        const [homeHtml, serialsResult, tarjimaResult, multfilmResult] = await Promise.all([
            fetchHtml('/'),
            getCategory('seriallar', 1).catch(() => ({items: []})),
            getCategory('tarjima-kinolar', 1).catch(() => ({items: []})),
            getCategory('multfilmlar', 1).catch(() => ({items: []})),
        ]);
        const $ = cheerio.load(homeHtml);
        return {
            provider: PROVIDER,
            banner: parseBanner($),
            sections: [
                {key: 'latest', label: 'Yangilar', viewAll: {type: 'latest'}, items: parseCards($).slice(0, 12)},
                {key: 'serials', label: 'Seriallar', viewAll: {type: 'category', slug: 'seriallar'}, items: serialsResult.items.slice(0, 12)},
                {key: 'tarjima', label: 'Tarjima kinolar', viewAll: {type: 'category', slug: 'tarjima-kinolar'}, items: tarjimaResult.items.slice(0, 12)},
                {key: 'multfilm', label: 'Multfilmlar', viewAll: {type: 'category', slug: 'multfilmlar'}, items: multfilmResult.items.slice(0, 12)},
            ],
        };
    });
}

async function getDetail(url) {
    if (!url || !url.startsWith('http')) {
        throw Object.assign(new Error('Valid absolute URL required'), {status: 400});
    }
    return swr.fetch(`detail:${url}`, 10 * 60 * 1000, 60 * 60 * 1000, () => buildDetail(url));
}

async function buildDetail(url) {
    const html = await fetchDetailHtml(url);
    const $ = cheerio.load(html);

    const rawTitle = $('h1[itemprop="name"]').first().clone().children().remove().end().text().trim() || $('.fs-title').first().clone().children().remove().end().text().trim() || $('h1').first().clone().children().remove().end().text().trim() || $('meta[property="og:title"]').attr('content')?.trim() || '';

    const thumbnail = $('meta[property="og:image"]').attr('content') || $('.fs-poster img, .card__poster img, .full-poster img, .poster img').first().attr('src') || null;

    const description = $('.fs-description p').first().text().trim() || $('.fs-description').first().text().trim() || $('[itemprop="description"]').first().text().trim() || $('meta[name="description"]').attr('content') || null;

    const genres = [];
    $('a[href*="/xfsearch/genre/"]').each((_, el) => {
        const g = $(el).text().trim();
        if (g) genres.push(g);
    });

    const cast = [];
    $('a[href*="/xfsearch/actors/"]').each((_, el) => {
        const name = $(el).text().trim();
        if (!name) return;
        const href = $(el).attr('href') || '';
        const m = href.match(/\/xfsearch\/actors\/([^/]+)/);
        const id = m
            ? decodeURIComponent(m[1]).toLowerCase().replace(/\s+/g, '_')
            : name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const imgSrc = $(el).find('img').attr('src') || $(el).closest('li, div').find('img').attr('src') || null;
        cast.push({id, name, image: imgSrc ? absUrl(imgSrc) : null});
    });

    const director = $('a[href*="/xfsearch/directed/"]').first().text().trim() || null;
    const duration = $('a[href*="/xfsearch/time/"]').first().text().trim() || $('[itemprop="duration"]').first().text().trim() || null;
    const yearText = $('a[href*="/xfsearch/year/"]').first().text().trim();
    const country = $('a[href*="/xfsearch/world/"]').first().text().trim() || null;
    const likes = parseInt($('[data-likes-id]').first().text().trim()) || 0;
    const dislikes = parseInt($('[data-dislikes-id]').first().text().trim()) || 0;

    const contentId = $('.fs-action-icons__rate[data-id]').first().attr('data-id') || (url.match(/\/(\d+)-/) || [])[1] || null;

    const isSerial = $('#episodes-raw-data a[href]').length > 0;

    const screenshots = [];
    $('.fs-screenshots__item').each((_, el) => {
        const full = $(el).attr('href');
        const thumb = $(el).find('img').attr('src');
        screenshots.push({full: full ? absUrl(full) : null, thumb: thumb ? absUrl(thumb) : null});
    });

    const related = parseCards(`<div>${$('.fs-related').html() || ''}</div>`).slice(0, 12);

    return {
        provider: PROVIDER,
        contentId,
        contentUrl: url,
        title: parseTitle(rawTitle),
        description,
        thumbnail: absUrl(thumbnail),
        year: yearText ? parseInt(yearText) || null : null,
        duration,
        country,
        director,
        genres: [...new Set(genres)],
        cast: [...new Set(cast)].slice(0, 20),
        likes,
        dislikes,
        isSerial,
        screenshots,
        related,
    };
}

async function getEpisodes(url) {
    if (!url || !url.startsWith('http')) {
        throw Object.assign(new Error('Valid absolute URL required'), {status: 400});
    }
    return swr.fetch(`episodes:${url}`, 10 * 60 * 1000, 60 * 60 * 1000, () => buildEpisodes(url));
}

async function buildEpisodes(url) {
    const html = await fetchDetailHtml(url);
    const $ = cheerio.load(html);

    const episodes = [];
    $('#episodes-raw-data a[href]').each((_, el) => {
        const raw = $(el).attr('href');
        const label = $(el).attr('data-label') || $(el).text().trim();
        const num = parseInt($(el).text().trim());
        if (raw) {
            episodes.push({episode: isNaN(num) ? episodes.length + 1 : num, label, mediaRef: raw});
        }
    });

    const isSerial = episodes.length > 0;

    if (isSerial) {
        return {provider: PROVIDER, contentUrl: url, isSerial: true, episodes};
    }

    const videoSources = [];
    $('.fs-player__tab[data-url]').each((_, el) => {
        const raw = $(el).attr('data-url');
        const quality = $(el).attr('data-name') || $(el).text().trim();
        const isDefault = $(el).hasClass('active');
        const videoUrl = normalizeVideoUrl(unwrapPlayerUrl(raw));
        if (videoUrl) videoSources.push({quality, videoUrl, isDefault});
    });

    let playerSrc = null;
    if (videoSources.length > 0) {
        const best = videoSources.find(s => s.isDefault) || videoSources[0];
        playerSrc = best.videoUrl;
    }

    if (!playerSrc) {
        const iframeSrc = $('iframe[data-player-src]').first().attr('data-player-src') || $('iframe[src]').first().attr('src') || $('iframe[data-src]').first().attr('data-src') || null;
        playerSrc = normalizeVideoUrl(unwrapPlayerUrl(iframeSrc));
    }

    return {provider: PROVIDER, contentUrl: url, isSerial: false, videoSources, playerSrc, headers: VIDEO_HEADERS};
}

async function checkVideoUrl(videoUrl) {
    const normalized = normalizeVideoUrl(videoUrl);
    try {
        const response = await axios.head(normalized, {
            timeout: 8000, headers: {...VIDEO_HEADERS, Range: 'bytes=0-0'}, maxRedirects: 5,
        });
        return {
            accessible: response.status < 400,
            status: response.status,
            contentType: response.headers['content-type'] || null,
            contentLength: response.headers['content-length'] ? parseInt(response.headers['content-length']) : null,
            acceptRanges: response.headers['accept-ranges'] || null,
        };
    } catch (err) {
        const status = err.response?.status || 0;
        return {accessible: status !== 404, status, error: err.message};
    }
}

async function resolveMedia(mediaRef) {
    return swr.fetch(`media:${mediaRef}`, 30 * 60 * 1000, 30 * 60 * 1000, async () => {
        const videoUrl = normalizeVideoUrl(unwrapPlayerUrl(mediaRef));
        if (!videoUrl) throw Object.assign(new Error('Media URL aniqlanmadi'), {status: 422});
        return {videoUrl, headers: VIDEO_HEADERS};
    });
}

function getCategoryList() {
    return Object.keys(CATEGORIES).map(slug => ({
        provider: PROVIDER, slug, path: CATEGORIES[slug], url: `${BASE}/${CATEGORIES[slug]}/`,
    }));
}

function getGenreList() {
    return GENRES.map(genre => ({
        provider: PROVIDER,
        slug: genre,
        url: `${BASE}/xfsearch/genre/${genre}/`,
        image: GENRE_IMAGES[genre] || null,
    }));
}

module.exports = {
    name: PROVIDER,
    domains: ['asilmedia.org'],
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
