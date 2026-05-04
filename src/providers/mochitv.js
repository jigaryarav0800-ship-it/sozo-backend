const axios = require('axios');
const https = require('https');
const { SwrCache } = require('../utils/swrCache');

const PROVIDER = 'mochitv';
const BASE = 'https://www.mochitv.uz';

const SUPABASE_URL = process.env.MOCHITV_SUPABASE_URL || 'https://qjpqwhwbdpdymxmtaoui.supabase.co';
const SUPABASE_KEY = process.env.MOCHITV_SUPABASE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqcHF3aHdiZHBkeW14bXRhb3VpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDc1OTU4NSwiZXhwIjoyMDgwMzM1NTg1fQ.y07XZmhyFYalS_u9LgySm-88CPuH9P9BzWyVwdRwyeM';

const PAGE_SIZE = 20;

const VIDEO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Referer':    `${BASE}/`,
    'Origin':     BASE,
};

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 8 });
httpsAgent.setMaxListeners(0);

const http = axios.create({
    baseURL: `${SUPABASE_URL}/rest/v1`,
    timeout: 15000,
    httpsAgent,
    headers: {
        apikey:        SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept:        'application/json',
    },
});

const swr = new SwrCache({ maxEntries: 200 });
swr.startSweepTimer();

async function rest(path, params = {}) {
    try {
        const res = await http.get(path, { params });
        return res.data;
    } catch (err) {
        const status = err.response?.status;
        const msg = status ? `mochitv supabase ${status} for "${path}"` : `Network error: ${err.message}`;
        throw Object.assign(new Error(msg), { status: status || 502 });
    }
}

async function loadAllAnime() {
    return swr.fetch('all', 5 * 60 * 1000, 30 * 60 * 1000, () =>
        rest('/anime_cards', { select: '*', limit: 500 })
    );
}

async function loadCarousel() {
    return swr.fetch('carousel', 30 * 60 * 1000, 60 * 60 * 1000, () =>
        rest('/anime_carousel', { select: 'anime_id,position', order: 'position.asc' })
    );
}

function contentUrlFor(id) {
    return `${BASE}/anime/${id}`;
}

function cleanGenre(g) {
    if (!g) return '';
    return String(g)
        .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function rowGenres(row) {
    const seen = new Set();
    const out = [];
    for (const g of row.genres || []) {
        const clean = cleanGenre(g);
        const key = clean.toLowerCase();
        if (clean && !seen.has(key)) {
            seen.add(key);
            out.push(clean);
        }
    }
    return out;
}

function isSerialRow(row) {
    return (row.episodes || 0) > 1;
}

function toCard(row) {
    return {
        provider:    PROVIDER,
        externalId:  row.id,
        title:       row.title || '',
        description: row.description || null,
        slug:        row.id,
        contentUrl:  contentUrlFor(row.id),
        thumbnail:   row.image_url || null,
        year:        row.year || null,
        rating:      row.rating || 0,
        qualities:   [],
        category:    isSerialRow(row) ? 'serial' : 'movie',
        genres:      rowGenres(row),
        extra:       { episodes: row.episodes || null },
    };
}

function toDetail(row, url) {
    return {
        provider:    PROVIDER,
        contentId:   row.id,
        contentUrl:  url,
        title:       row.title || '',
        description: row.description || null,
        thumbnail:   row.image_url || null,
        banner:      null,
        year:        row.year || null,
        duration:    null,
        country:     null,
        director:    null,
        genres:      rowGenres(row),
        cast:        [],
        likes:       0,
        dislikes:    0,
        isSerial:    isSerialRow(row),
        screenshots: [],
        related:     [],
        extra:       { episodes: row.episodes || null, rating: row.rating || 0 },
    };
}

function paginate(rows, page, extras = {}) {
    const p = Math.max(parseInt(page) || 1, 1);
    const start = (p - 1) * PAGE_SIZE;
    const slice = rows.slice(start, start + PAGE_SIZE);
    return {
        provider:   PROVIDER,
        items:      slice.map(toCard),
        page:       p,
        totalPages: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
        ...extras,
    };
}

function sortByCreatedDesc(rows) {
    return [...rows].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

const CATEGORIES = {
    serials: { label: 'Seriallar', filter: r => isSerialRow(r) },
    movies:  { label: 'Filmlar',   filter: r => !isSerialRow(r) },
};

async function getLatest(page = 1) {
    return paginate(sortByCreatedDesc(await loadAllAnime()), page);
}

async function getCategory(category, page = 1) {
    const meta = CATEGORIES[category];
    if (!meta) {
        throw Object.assign(
            new Error(`Unknown category "${category}". Valid: ${Object.keys(CATEGORIES).join(', ')}`),
            { status: 400 }
        );
    }
    const all = await loadAllAnime();
    return paginate(sortByCreatedDesc(all.filter(meta.filter)), page, { category });
}

async function getGenre(genre, page = 1) {
    const wanted = cleanGenre(genre).toLowerCase();
    if (!wanted) {
        throw Object.assign(new Error('genre kerak'), { status: 400 });
    }
    const all = await loadAllAnime();
    const filtered = all.filter(a => (a.genres || []).some(g => cleanGenre(g).toLowerCase() === wanted));
    return paginate(sortByCreatedDesc(filtered), page, { genre });
}

async function getYear(year, page = 1) {
    const y = Number(year);
    const all = await loadAllAnime();
    return paginate(sortByCreatedDesc(all.filter(a => a.year === y)), page, { year: y });
}

async function getCountry() {
    throw Object.assign(new Error('mochitv provider does not support country browse'), { status: 501 });
}

async function getActor() {
    throw Object.assign(new Error('mochitv provider does not support actor browse'), { status: 501 });
}

async function getDirector() {
    throw Object.assign(new Error('mochitv provider does not support director browse'), { status: 501 });
}

async function search(query, page = 1) {
    if (!query || String(query).trim().length < 2) {
        throw Object.assign(new Error('search query must be at least 2 chars'), { status: 400 });
    }
    const q = String(query).trim().toLowerCase();
    const all = await loadAllAnime();
    const filtered = all.filter(a =>
        String(a.title || '').toLowerCase().includes(q) ||
        String(a.description || '').toLowerCase().includes(q)
    );
    return paginate(filtered, page, { query });
}

async function getHome() {
    return swr.fetch('home', 5 * 60 * 1000, 30 * 60 * 1000, async () => {
        const [all, carousel] = await Promise.all([loadAllAnime(), loadCarousel()]);
        const byId = new Map(all.map(a => [a.id, a]));

        const banner = carousel
            .map(c => byId.get(c.anime_id))
            .filter(Boolean)
            .slice(0, 12)
            .map(toCard);

        const HOME_LIMIT = 12;
        const sortedRecent = sortByCreatedDesc(all).slice(0, HOME_LIMIT);
        const sortedRated  = [...all].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, HOME_LIMIT);
        const serials      = all.filter(isSerialRow).slice(0, HOME_LIMIT);
        const movies       = all.filter(r => !isSerialRow(r)).slice(0, HOME_LIMIT);

        return {
            provider: PROVIDER,
            banner,
            sections: [
                { key: 'latest',  label: 'Yangilar',           viewAll: { type: 'latest' },                    items: sortedRecent.map(toCard) },
                { key: 'top',     label: 'Eng yuqori reyting', viewAll: { type: 'category', slug: 'serials' }, items: sortedRated.map(toCard) },
                { key: 'serials', label: 'Seriallar',          viewAll: { type: 'category', slug: 'serials' }, items: serials.map(toCard) },
                { key: 'movies',  label: 'Filmlar',            viewAll: { type: 'category', slug: 'movies' },  items: movies.map(toCard) },
            ],
        };
    });
}

function animeIdFromUrl(url) {
    const m = String(url || '').match(/\/(?:anime|watch)\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
}

async function getDetail(url) {
    const id = animeIdFromUrl(url);
    if (!id) throw Object.assign(new Error('mochitv URL must contain anime id'), { status: 400 });
    const all = await loadAllAnime();
    const row = all.find(a => a.id === id);
    if (!row) throw Object.assign(new Error('mochitv: anime topilmadi'), { status: 404 });
    return toDetail(row, url);
}

async function getEpisodes(url) {
    const id = animeIdFromUrl(url);
    if (!id) throw Object.assign(new Error('mochitv URL must contain anime id'), { status: 400 });

    return swr.fetch(`episodes:${id}`, 10 * 60 * 1000, 60 * 60 * 1000, async () => {
        const rows = await rest('/anime_episodes', {
            anime_id: `eq.${id}`,
            select:   '*',
            order:    'episode_number.asc',
        });

        if (rows.length > 1) {
            return {
                provider:   PROVIDER,
                contentUrl: url,
                isSerial:   true,
                episodes: rows.map(e => ({
                    episode:  e.episode_number,
                    label:    e.title || `${e.episode_number}-qism`,
                    mediaRef: e.video_url,
                })),
            };
        }

        const single = rows[0];
        return {
            provider:     PROVIDER,
            contentUrl:   url,
            isSerial:     false,
            videoSources: single ? [{ quality: 'auto', videoUrl: single.video_url, isDefault: true }] : [],
            playerSrc:    single?.video_url || null,
            headers:      VIDEO_HEADERS,
        };
    });
}

async function resolveMedia(mediaRef) {
    if (!mediaRef) {
        throw Object.assign(new Error('mochitv: mediaRef bo\'sh'), { status: 400 });
    }
    return {
        videoUrl:     mediaRef,
        type:         /\.m3u8/i.test(mediaRef) ? 'hls' : 'mp4',
        headers:      VIDEO_HEADERS,
        videoSources: [{ quality: 'auto', videoUrl: mediaRef, isDefault: true }],
    };
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
        url:      `${BASE}/category/${slug}`,
    }));
}

async function getGenreList() {
    const all = await loadAllAnime();
    const counts = new Map();
    const firstImage = new Map();

    for (const row of all) {
        for (const raw of row.genres || []) {
            const g = cleanGenre(raw);
            if (!g) continue;
            counts.set(g, (counts.get(g) || 0) + 1);
            if (!firstImage.has(g) && row.image_url) firstImage.set(g, row.image_url);
        }
    }

    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([g]) => ({
            provider: PROVIDER,
            slug:     g,
            label:    g,
            url:      `${BASE}/genre/${encodeURIComponent(g)}`,
            image:    firstImage.get(g) || null,
        }));
}

module.exports = {
    name:    PROVIDER,
    domains: ['mochitv.uz'],
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
