const axios = require('axios');
const cheerio = require('cheerio');

const PROVIDER = 'asilmedia';
const BASE = 'https://asilmedia.org';

const CATEGORIES = {
    'tarjima-kinolar': 'films/tarjima_kinolar',
    'xorij-kinolar': 'films/xorij_kinolar',
    'rus-kinolar': 'films/rus_kinolar',
    'seriallar': 'films/serial',
    'multfilmlar': 'films/multfilmlar_multiklar',
    'treylerlar': 'treylerlar',
};

const GENRES = ['boevik', 'komediya', 'drama', 'melodrama', 'triller', 'fantastika', 'kriminal', 'detektiv', 'anime', 'multfilm', 'sarguzasht', 'ujas', 'biografik', 'tarixiy', 'musiqiy',];

const http = axios.create({
    baseURL: BASE, timeout: 20000, headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'uz,ru;q=0.9,en;q=0.8',
        'DNT': '1',
    },
});

const MAX_CACHE_ENTRIES = 500;
const _cache = new Map();

function cacheGet(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
        _cache.delete(key);
        return null;
    }
    return entry.data;
}

function cacheSet(key, data, ttlMs = 5 * 60 * 1000) {
    if (_cache.size >= MAX_CACHE_ENTRIES) {
        _cache.delete(_cache.keys().next().value);
    }
    _cache.set(key, {data, expires: Date.now() + ttlMs});
}

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _cache) {
        if (now > entry.expires) _cache.delete(key);
    }
}, 2 * 60 * 1000).unref();

async function fetchHtml(path) {
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

async function probeUrl(videoUrl) {
    try {
        const res = await axios.head(videoUrl, {
            timeout: 4000, headers: {'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-0'}, maxRedirects: 5,
        });
        return {accessible: res.status < 400, status: res.status};
    } catch (err) {
        const status = err.response?.status || 0;
        return {accessible: status !== 404, status};
    }
}

async function verifyVideoSources(sources) {
    if (!sources.length) return sources;
    const probes = await Promise.all(sources.map(s => probeUrl(s.videoUrl)));
    return sources.map((s, i) => ({...s, accessible: probes[i].accessible}));
}

function parseCards(html) {
    const $ = cheerio.load(html);
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

function parseBanner(html) {
    const $ = cheerio.load(html);
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

function parseTotalPages(html) {
    const $ = cheerio.load(html);
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

async function getLatest(page = 1) {
    const key = `latest:${page}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const path = page > 1 ? `/page/${page}/` : '/';
    const html = await fetchHtml(path);
    const result = {provider: PROVIDER, items: parseCards(html), page: Number(page), totalPages: parseTotalPages(html)};
    cacheSet(key, result);
    return result;
}

async function getCategory(category, page = 1) {
    const catPath = CATEGORIES[category];
    if (!catPath) {
        throw Object.assign(new Error(`Unknown category "${category}". Valid: ${Object.keys(CATEGORIES).join(', ')}`), {status: 400});
    }
    const key = `cat:${category}:${page}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const path = page > 1 ? `/${catPath}/page/${page}/` : `/${catPath}/`;
    const html = await fetchHtml(path);
    const result = {
        provider: PROVIDER, items: parseCards(html), category, page: Number(page), totalPages: parseTotalPages(html)
    };
    cacheSet(key, result);
    return result;
}

async function getGenre(genre, page = 1) {
    const key = `genre:${genre}:${page}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const path = page > 1 ? `/xfsearch/genre/${genre}/page/${page}/` : `/xfsearch/genre/${genre}/`;
    const html = await fetchHtml(path);
    const result = {
        provider: PROVIDER, items: parseCards(html), genre, page: Number(page), totalPages: parseTotalPages(html)
    };
    cacheSet(key, result);
    return result;
}

async function getYear(year, page = 1) {
    const key = `year:${year}:${page}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const path = page > 1 ? `/xfsearch/year/${year}/page/${page}/` : `/xfsearch/year/${year}/`;
    const html = await fetchHtml(path);
    const result = {
        provider: PROVIDER,
        items: parseCards(html),
        year: Number(year),
        page: Number(page),
        totalPages: parseTotalPages(html)
    };
    cacheSet(key, result);
    return result;
}

async function getCountry(country, page = 1) {
    const key = `country:${country}:${page}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const path = page > 1 ? `/xfsearch/world/${encodeURIComponent(country)}/page/${page}/` : `/xfsearch/world/${encodeURIComponent(country)}/`;
    const html = await fetchHtml(path);
    const result = {
        provider: PROVIDER, items: parseCards(html), country, page: Number(page), totalPages: parseTotalPages(html)
    };
    cacheSet(key, result);
    return result;
}

async function getActor(actor, page = 1) {
    const key = `actor:${actor}:${page}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const path = page > 1 ? `/xfsearch/actors/${encodeURIComponent(actor)}/page/${page}/` : `/xfsearch/actors/${encodeURIComponent(actor)}/`;
    const html = await fetchHtml(path);
    const result = {
        provider: PROVIDER, items: parseCards(html), actor, page: Number(page), totalPages: parseTotalPages(html)
    };
    cacheSet(key, result);
    return result;
}

async function getDirector(director, page = 1) {
    const key = `director:${director}:${page}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const path = page > 1 ? `/xfsearch/directed/${encodeURIComponent(director)}/page/${page}/` : `/xfsearch/directed/${encodeURIComponent(director)}/`;
    const html = await fetchHtml(path);
    const result = {
        provider: PROVIDER, items: parseCards(html), director, page: Number(page), totalPages: parseTotalPages(html)
    };
    cacheSet(key, result);
    return result;
}

async function search(query, page = 1) {
    const key = `search:${query}:${page}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const start = (Number(page) - 1) * 10;
    const path = `/?do=search&subaction=search&search_start=${start}&full_search=0&story=${encodeURIComponent(query)}`;
    const html = await fetchHtml(path);
    const result = {
        provider: PROVIDER, items: parseCards(html), query, page: Number(page), totalPages: parseTotalPages(html)
    };
    cacheSet(key, result, 2 * 60 * 1000);
    return result;
}

async function getHome() {
    const cached = cacheGet('home');
    if (cached) return cached;

    const [homeHtml, serialsResult, tarjimaResult, multfilmResult] = await Promise.all([
        fetchHtml('/'),
        getCategory('seriallar', 1).catch(() => ({items: []})),
        getCategory('tarjima-kinolar', 1).catch(() => ({items: []})),
        getCategory('multfilmlar', 1).catch(() => ({items: []})),]);

    const result = {
        provider: PROVIDER,
        banner: parseBanner(homeHtml),
        sections: [
            { key: 'latest',   label: 'Yangilar',       viewAll: { type: 'latest' },                           items: parseCards(homeHtml).slice(0, 12) },
            { key: 'serials',  label: 'Seriallar',       viewAll: { type: 'category', slug: 'seriallar' },      items: serialsResult.items.slice(0, 12) },
            { key: 'tarjima',  label: 'Tarjima kinolar', viewAll: { type: 'category', slug: 'tarjima-kinolar' }, items: tarjimaResult.items.slice(0, 12) },
            { key: 'multfilm', label: 'Multfilmlar',     viewAll: { type: 'category', slug: 'multfilmlar' },    items: multfilmResult.items.slice(0, 12) },
        ],
    };

    cacheSet('home', result, 5 * 60 * 1000);
    return result;
}

async function getDetail(url) {
    if (!url || !url.startsWith('http')) {
        throw Object.assign(new Error('Valid absolute URL required'), {status: 400});
    }

    const key = `detail:${url}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const html = await fetchHtml(url.replace(BASE, ''));
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
        if (name) cast.push(name);
    });

    const director = $('a[href*="/xfsearch/directed/"]').first().text().trim() || null;
    const duration = $('a[href*="/xfsearch/time/"]').first().text().trim() || $('[itemprop="duration"]').first().text().trim() || null;
    const yearText = $('a[href*="/xfsearch/year/"]').first().text().trim();
    const country = $('a[href*="/xfsearch/world/"]').first().text().trim() || null;
    const likes = parseInt($('[data-likes-id]').first().text().trim()) || 0;
    const dislikes = parseInt($('[data-dislikes-id]').first().text().trim()) || 0;

    const contentId = $('.fs-action-icons__rate[data-id]').first().attr('data-id') || (url.match(/\/(\d+)-/) || [])[1] || null;

    const episodes = [];
    $('#episodes-raw-data a[href]').each((_, el) => {
        const raw = $(el).attr('href');
        const label = $(el).attr('data-label') || $(el).text().trim();
        const num = parseInt($(el).text().trim());
        const videoUrl = normalizeVideoUrl(unwrapPlayerUrl(raw));
        if (videoUrl) {
            episodes.push({episode: isNaN(num) ? episodes.length + 1 : num, label, videoUrl});
        }
    });

    let videoSources = [];
    $('.fs-player__tab[data-url]').each((_, el) => {
        const raw = $(el).attr('data-url');
        const quality = $(el).attr('data-name') || $(el).text().trim();
        const isDefault = $(el).hasClass('active');
        const videoUrl = normalizeVideoUrl(unwrapPlayerUrl(raw));
        if (videoUrl) videoSources.push({quality, videoUrl, isDefault});
    });

    if (videoSources.length > 0) {
        videoSources = await verifyVideoSources(videoSources);
    }

    const screenshots = [];
    $('.fs-screenshots__item').each((_, el) => {
        const full = $(el).attr('href');
        const thumb = $(el).find('img').attr('src');
        screenshots.push({full: full ? absUrl(full) : null, thumb: thumb ? absUrl(thumb) : null});
    });

    const related = parseCards(`<div>${$('.fs-related').html() || ''}</div>`).slice(0, 12);

    let playerSrc = null;
    if (videoSources.length > 0) {
        const accessible = videoSources.filter(s => s.accessible !== false);
        const best = accessible.find(s => s.isDefault) || accessible[0] || videoSources[0];
        playerSrc = best.videoUrl;
    } else if (episodes.length > 0) {
        playerSrc = episodes[0].videoUrl;
    }

    if (!playerSrc) {
        const iframeSrc = $('iframe[data-player-src]').first().attr('data-player-src') || $('iframe[src]').first().attr('src') || $('iframe[data-src]').first().attr('data-src') || null;
        playerSrc = normalizeVideoUrl(unwrapPlayerUrl(iframeSrc));
    }

    const isSerial = episodes.length > 0;

    const result = {
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
        isSerial, ...(isSerial ? {episodes} : {}), ...(!isSerial ? {videoSources} : {}),
        screenshots,
        related,
        playerSrc,
    };

    cacheSet(key, result, 10 * 60 * 1000);
    return result;
}

async function checkVideoUrl(videoUrl) {
    const normalized = normalizeVideoUrl(videoUrl);
    try {
        const response = await axios.head(normalized, {
            timeout: 8000, headers: {'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-0'}, maxRedirects: 5,
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

function getCategoryList() {
    return Object.keys(CATEGORIES).map(slug => ({
        provider: PROVIDER, slug, path: CATEGORIES[slug], url: `${BASE}/${CATEGORIES[slug]}/`,
    }));
}

function getGenreList() {
    return GENRES.map(genre => ({
        provider: PROVIDER, slug: genre, url: `${BASE}/xfsearch/genre/${genre}/`,
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
    checkVideoUrl,
    getCategoryList,
    getGenreList,
};
