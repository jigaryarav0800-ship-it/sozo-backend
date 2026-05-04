const axios = require('axios');
const https = require('https');
const tmdb = require('../utils/tmdb');
const { SwrCache } = require('../utils/swrCache');

const PROVIDER = 'vidapi';
const STREAM_API = 'https://streamdata.vaplayer.ru/api.php';

const STREAM_REFERER = 'https://brightpathsignals.com/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const STREAM_HEADERS = {
    'User-Agent': UA,
    'Referer':    STREAM_REFERER,
    'Origin':     'https://brightpathsignals.com',
};

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });
httpsAgent.setMaxListeners(0);

const http = axios.create({
    timeout: 12_000,
    httpsAgent,
    headers: { 'User-Agent': UA, Referer: STREAM_REFERER, Accept: 'application/json,*/*;q=0.8' },
});

const swr = new SwrCache({ maxEntries: 400 });
swr.startSweepTimer();

async function fetchAvailability({ imdbId, tmdbId }) {
    const params = new URLSearchParams();
    if (imdbId)      params.set('imdb', imdbId);
    else if (tmdbId) params.set('tmdb', String(tmdbId));
    params.set('type', 'tv');
    params.set('source', 'justhd');
    const url = `${STREAM_API}?${params.toString()}`;
    return swr.fetch(`avail:${url}`, 30 * 60 * 1000, 60 * 60 * 1000, async () => {
        const res = await http.get(url, { validateStatus: () => true });
        if (res.status !== 200 || !res.data || res.data.status_code === 404) {
            throw Object.assign(new Error('vidapi: tv availability not found'), { status: 404 });
        }
        if (String(res.data.status_code) !== '200') {
            throw Object.assign(new Error(`vidapi: api status ${res.data.status_code}`), { status: 502 });
        }
        return res.data.data || {};
    });
}

async function fetchStreamData({ imdbId, tmdbId, type, season, episode }) {
    const params = new URLSearchParams();
    if (imdbId)       params.set('imdb', imdbId);
    else if (tmdbId)  params.set('tmdb', String(tmdbId));
    params.set('type', type);
    if (type === 'tv') {
        params.set('season',  String(season || 1));
        params.set('episode', String(episode || 1));
    }
    params.set('source', 'justhd');
    const url = `${STREAM_API}?${params.toString()}`;
    const cacheKey = `stream:${url}`;
    return swr.fetch(cacheKey, 30 * 60 * 1000, 60 * 60 * 1000, async () => {
        const res = await http.get(url, { validateStatus: () => true });
        if (res.status !== 200 || !res.data || res.data.status_code === 404) {
            throw Object.assign(new Error('vidapi: stream data not found'), { status: 404 });
        }
        if (String(res.data.status_code) !== '200') {
            throw Object.assign(new Error(`vidapi: api status ${res.data.status_code}`), { status: 502 });
        }
        return res.data.data || {};
    });
}

function streamUrlsToSources(stream_urls) {
    if (!Array.isArray(stream_urls)) return [];
    return stream_urls.map((url, i) => ({
        quality:   `Server ${i + 1}`,
        videoUrl:  url,
        isDefault: i === 0,
    }));
}

const getLatest    = (page = 1)         => tmdb.getLatest(PROVIDER, page);
const getCategory  = (cat, page = 1)    => tmdb.getCategory(PROVIDER, cat, page);
const getGenre     = (genre, page = 1)  => tmdb.getGenre(PROVIDER, genre, page);
const getYear      = (year, page = 1)   => tmdb.getYear(PROVIDER, year, page);
const getCountry   = (country, page = 1)=> tmdb.getCountry(PROVIDER, country, page);
const getActor     = (actor, page = 1)  => tmdb.getActor(PROVIDER, actor, page);
const getDirector  = (dir, page = 1)    => tmdb.getDirector(PROVIDER, dir, page);
const search       = (q, page = 1)      => tmdb.search(PROVIDER, q, page);
const getHome      = ()                 => tmdb.getHome(PROVIDER);
const getDetail    = (url)              => tmdb.getDetail(PROVIDER, url);

async function getEpisodes(url) {
    const ref = tmdb.parseUrl(url);
    if (!ref) throw Object.assign(new Error('Valid TMDB URL required'), { status: 400 });

    return swr.fetch(`episodes:${url}`, 10 * 60 * 1000, 60 * 60 * 1000, async () => {
        const ext = await tmdb.getExternalIds(ref.type, ref.id).catch(() => ({}));
        const imdbId = ext.imdb_id || null;

        if (ref.type === 'movie') {
            const data = await fetchStreamData({ imdbId, tmdbId: ref.id, type: 'movie' })
                .catch(() => null);
            const sources = streamUrlsToSources(data?.stream_urls);
            if (sources.length === 0) {
                return {
                    provider: PROVIDER, contentUrl: url, isSerial: false,
                    videoSources: [], playerSrc: null, type: null, headers: STREAM_HEADERS,
                };
            }
            return {
                provider:     PROVIDER,
                contentUrl:   url,
                isSerial:     false,
                videoSources: sources,
                playerSrc:    sources[0].videoUrl,
                type:         'hls',
                headers:      STREAM_HEADERS,
            };
        }

        const availability = await fetchAvailability({ imdbId, tmdbId: ref.id })
            .catch(() => null);
        if (!availability || !availability.eps || Object.keys(availability.eps).length === 0) {
            return { provider: PROVIDER, contentUrl: url, isSerial: true, episodes: [] };
        }

        const seasonNumbers = Object.keys(availability.eps).map(Number).sort((a, b) => a - b);
        const seasonMetaList = await Promise.all(
            seasonNumbers.map(s => tmdb.getSeasonEpisodes(ref.id, s).catch(() => null))
        );
        const seasonMetaByNum = new Map();
        seasonNumbers.forEach((n, i) => seasonMetaByNum.set(n, seasonMetaList[i]));

        const episodes = [];
        for (const seasonNum of seasonNumbers) {
            const epNumbers = (availability.eps[seasonNum] || []).map(Number).sort((a, b) => a - b);
            const meta = seasonMetaByNum.get(seasonNum);
            const epMetaByNum = new Map();
            for (const e of (meta?.episodes || [])) epMetaByNum.set(e.episode_number, e);

            for (const epNum of epNumbers) {
                const m = epMetaByNum.get(epNum);
                episodes.push({
                    episode:  episodes.length + 1,
                    label:    `S${seasonNum}E${epNum}` + (m?.name ? ` · ${m.name}` : ''),
                    mediaRef: `${PROVIDER}:tv:${imdbId || ''}:${ref.id}:${seasonNum}:${epNum}`,
                    image:    m?.still_path ? tmdb.poster(m.still_path) : undefined,
                    airdate:  m?.air_date || undefined,
                    runtime:  m?.runtime ? `${m.runtime} min` : undefined,
                    overview: m?.overview || undefined,
                });
            }
        }

        return { provider: PROVIDER, contentUrl: url, isSerial: true, episodes };
    });
}

async function resolveMedia(mediaRef) {
    if (!mediaRef) throw Object.assign(new Error("vidapi: mediaRef bo'sh"), { status: 400 });

    let imdbId = null, tmdbId = null, type = 'movie', season = null, episode = null;

    if (mediaRef.startsWith(`${PROVIDER}:tv:`)) {
        const [, , imdb, tmdbid, s, e] = mediaRef.split(':');
        imdbId = imdb || null; tmdbId = tmdbid || null;
        type = 'tv'; season = Number(s); episode = Number(e);
    } else if (mediaRef.startsWith(`${PROVIDER}:movie:`)) {
        const [, , imdb, tmdbid] = mediaRef.split(':');
        imdbId = imdb || null; tmdbId = tmdbid || null;
        type = 'movie';
    } else if (/^tt\d+$/.test(mediaRef)) {
        imdbId = mediaRef; type = 'movie';
    } else {
        const ref = tmdb.parseUrl(mediaRef);
        if (!ref) throw Object.assign(new Error('vidapi: invalid mediaRef'), { status: 400 });
        const ext = await tmdb.getExternalIds(ref.type, ref.id).catch(() => ({}));
        imdbId = ext.imdb_id || null;
        tmdbId = ref.id;
        type = ref.type;
        season = ref.season; episode = ref.episode;
    }

    const data = await fetchStreamData({ imdbId, tmdbId, type, season, episode });
    const sources = streamUrlsToSources(data.stream_urls);
    if (sources.length === 0) {
        throw Object.assign(new Error('vidapi: stream URLs not available for this title'), { status: 502 });
    }

    return {
        videoUrl:     sources[0].videoUrl,
        type:         'hls',
        headers:      STREAM_HEADERS,
        videoSources: sources,
        title:        data.title || null,
        backdrop:     data.backdrop || null,
    };
}

async function checkVideoUrl(videoUrl) {
    try {
        const res = await axios.head(videoUrl, { timeout: 8_000, headers: STREAM_HEADERS, maxRedirects: 5, httpsAgent });
        return {
            accessible:    res.status < 400,
            status:        res.status,
            contentType:   res.headers['content-type'] || null,
            contentLength: res.headers['content-length'] ? parseInt(res.headers['content-length']) : null,
            acceptRanges:  res.headers['accept-ranges'] || null,
        };
    } catch (err) {
        return { accessible: false, status: err.response?.status || 0, error: err.message };
    }
}

const getCategoryList = () => tmdb.categoryList(PROVIDER);
const getGenreList    = () => tmdb.genreList(PROVIDER);

module.exports = {
    name:    PROVIDER,
    domains: ['themoviedb.org', 'vidapi.ru', 'vaplayer.ru', 'streamdata.vaplayer.ru'],
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
