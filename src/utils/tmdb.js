const axios = require('axios');
const https = require('https');
const { SwrCache } = require('./swrCache');

const TMDB_BASE = process.env.TMDB_PROXY_URL || 'https://jumpfreedom.com/3';
const IMG_BASE  = 'https://image.tmdb.org/t/p';

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 8 });
httpsAgent.setMaxListeners(0);

const http = axios.create({
    baseURL: TMDB_BASE,
    timeout: 12_000,
    httpsAgent,
    headers: { Accept: 'application/json' },
});

const swr = new SwrCache({ maxEntries: 800 });
swr.startSweepTimer();

function poster(path)   { return path ? `${IMG_BASE}/w500${path}`     : null; }
function backdrop(path) { return path ? `${IMG_BASE}/original${path}` : null; }

async function api(path, params = {}) {
    const key = `tmdb:${path}:${JSON.stringify(params)}`;
    return swr.fetch(key, 10 * 60 * 1000, 60 * 60 * 1000, async () => {
        try {
            const res = await http.get(path, { params });
            return res.data;
        } catch (err) {
            const status = err.response?.status;
            throw Object.assign(
                new Error(`tmdb ${status || 'network'}: ${path}`),
                { status: status || 502 }
            );
        }
    });
}

const CATEGORIES = {
    'popular':       { type: 'movie', path: '/movie/popular',     label: 'Popular Movies' },
    'top-rated':     { type: 'movie', path: '/movie/top_rated',   label: 'Top Rated Movies' },
    'upcoming':      { type: 'movie', path: '/movie/upcoming',    label: 'Upcoming Movies' },
    'now-playing':   { type: 'movie', path: '/movie/now_playing', label: 'Now Playing' },
    'popular-tv':    { type: 'tv',    path: '/tv/popular',        label: 'Popular TV' },
    'top-rated-tv':  { type: 'tv',    path: '/tv/top_rated',      label: 'Top Rated TV' },
    'on-air-tv':     { type: 'tv',    path: '/tv/on_the_air',     label: 'On Air TV' },
    'airing-today':  { type: 'tv',    path: '/tv/airing_today',   label: 'Airing Today' },
};

const GENRES = [
    { id: 28,    slug: 'action',      label: 'Action' },
    { id: 12,    slug: 'adventure',   label: 'Adventure' },
    { id: 16,    slug: 'animation',   label: 'Animation' },
    { id: 35,    slug: 'comedy',      label: 'Comedy' },
    { id: 80,    slug: 'crime',       label: 'Crime' },
    { id: 99,    slug: 'documentary', label: 'Documentary' },
    { id: 18,    slug: 'drama',       label: 'Drama' },
    { id: 10751, slug: 'family',      label: 'Family' },
    { id: 14,    slug: 'fantasy',     label: 'Fantasy' },
    { id: 36,    slug: 'history',     label: 'History' },
    { id: 27,    slug: 'horror',      label: 'Horror' },
    { id: 10402, slug: 'music',       label: 'Music' },
    { id: 9648,  slug: 'mystery',     label: 'Mystery' },
    { id: 10749, slug: 'romance',     label: 'Romance' },
    { id: 878,   slug: 'sci-fi',      label: 'Science Fiction' },
    { id: 53,    slug: 'thriller',    label: 'Thriller' },
    { id: 10752, slug: 'war',         label: 'War' },
    { id: 37,    slug: 'western',     label: 'Western' },
];

function genreById(id)     { return GENRES.find(g => g.id === id) || null; }
function genreBySlug(slug) { return GENRES.find(g => g.slug === slug) || null; }

function siteUrl(type, id)              { return `https://www.themoviedb.org/${type}/${id}`; }

function parseUrl(url) {
    if (!url) return null;
    const m = String(url).match(/themoviedb\.org\/(movie|tv)\/(\d+)(?:\/season\/(\d+)(?:\/episode\/(\d+))?)?/i);
    if (!m) return null;
    return {
        type:    m[1],
        id:      Number(m[2]),
        season:  m[3] ? Number(m[3]) : null,
        episode: m[4] ? Number(m[4]) : null,
    };
}

function toCard(item, providerName, type) {
    const t = type || (item.media_type === 'tv' ? 'tv' : 'movie');
    const title = item.title || item.name || '';
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const genres = (item.genre_ids || []).map(genreById).filter(Boolean).map(g => g.label);

    return {
        provider:   providerName,
        externalId: String(item.id),
        title,
        slug:       String(item.id),
        contentUrl: siteUrl(t, item.id),
        thumbnail:  poster(item.poster_path),
        year:       year ? Number(year) : null,
        rating:     item.vote_average ? Number(item.vote_average.toFixed(1)) : 0,
        qualities:  [],
        category:   t,
        genres,
    };
}

function buildListing(data, providerName, extras) {
    const items = (data.results || []).map(r => toCard(r, providerName, extras.type));
    return {
        provider:   providerName,
        items,
        ...extras,
        page:       data.page || 1,
        totalPages: Math.min(data.total_pages || 1, 500),
    };
}

async function getLatest(providerName, page = 1) {
    const data = await api('/trending/all/week', { page });
    return buildListing(data, providerName, { page: Number(page) });
}

async function getCategory(providerName, category, page = 1) {
    const meta = CATEGORIES[category];
    if (!meta) {
        throw Object.assign(
            new Error(`Unknown category "${category}". Valid: ${Object.keys(CATEGORIES).join(', ')}`),
            { status: 400 }
        );
    }
    const data = await api(meta.path, { page });
    return buildListing(data, providerName, { type: meta.type, category, page: Number(page) });
}

async function getGenre(providerName, genre, page = 1) {
    const g = genreBySlug(String(genre).toLowerCase()) || (Number(genre) && genreById(Number(genre)));
    if (!g) {
        throw Object.assign(
            new Error(`Unknown genre "${genre}". Valid: ${GENRES.map(x => x.slug).join(', ')}`),
            { status: 400 }
        );
    }
    const data = await api('/discover/movie', { with_genres: g.id, page, sort_by: 'popularity.desc' });
    return buildListing(data, providerName, { type: 'movie', genre: g.slug, page: Number(page) });
}

async function getYear(providerName, year, page = 1) {
    const y = Number(year);
    const data = await api('/discover/movie', { primary_release_year: y, page, sort_by: 'popularity.desc' });
    return buildListing(data, providerName, { type: 'movie', year: y, page: Number(page) });
}

async function getCountry(providerName, country, page = 1) {
    const data = await api('/discover/movie', { with_origin_country: country, page, sort_by: 'popularity.desc' });
    return buildListing(data, providerName, { type: 'movie', country, page: Number(page) });
}

async function getActor(providerName, actor, page = 1) {
    const id = Number(actor);
    if (!id) throw Object.assign(new Error('actor must be a numeric TMDB person id'), { status: 400 });
    const data = await api(`/person/${id}/combined_credits`);
    const all = (data.cast || []).map(r => toCard(r, providerName, r.media_type)).filter(c => c.title);
    const PER_PAGE = 20;
    const p = Math.max(parseInt(page) || 1, 1);
    return {
        provider:   providerName,
        items:      all.slice((p - 1) * PER_PAGE, p * PER_PAGE),
        page:       p,
        totalPages: Math.max(1, Math.ceil(all.length / PER_PAGE)),
        actor:      id,
    };
}

async function getDirector(providerName, director, page = 1) {
    const id = Number(director);
    if (!id) throw Object.assign(new Error('director must be a numeric TMDB person id'), { status: 400 });
    const data = await api(`/person/${id}/combined_credits`);
    const all = (data.crew || []).filter(c => c.job === 'Director').map(r => toCard(r, providerName, r.media_type));
    const PER_PAGE = 20;
    const p = Math.max(parseInt(page) || 1, 1);
    return {
        provider:   providerName,
        items:      all.slice((p - 1) * PER_PAGE, p * PER_PAGE),
        page:       p,
        totalPages: Math.max(1, Math.ceil(all.length / PER_PAGE)),
        director:   id,
    };
}

async function search(providerName, query, page = 1) {
    if (!query || String(query).trim().length < 2) {
        throw Object.assign(new Error('search query must be at least 2 chars'), { status: 400 });
    }
    const data = await api('/search/multi', { query: String(query).trim(), page, include_adult: false });
    const items = (data.results || [])
        .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
        .map(r => toCard(r, providerName, r.media_type));
    return {
        provider:   providerName,
        items,
        query,
        page:       data.page || Number(page),
        totalPages: Math.min(data.total_pages || 1, 500),
    };
}

async function getHome(providerName) {
    return swr.fetch(`tmdb:home:${providerName}`, 5 * 60 * 1000, 30 * 60 * 1000, async () => {
        const HOME_LIMIT = 12;
        const [trending, popMovies, topMovies, popTv, onAir] = await Promise.all([
            api('/trending/all/day').catch(() => ({ results: [] })),
            api('/movie/popular').catch(() => ({ results: [] })),
            api('/movie/top_rated').catch(() => ({ results: [] })),
            api('/tv/popular').catch(() => ({ results: [] })),
            api('/tv/on_the_air').catch(() => ({ results: [] })),
        ]);
        return {
            provider: providerName,
            banner:   (trending.results || []).slice(0, HOME_LIMIT).map(r => toCard(r, providerName, r.media_type)),
            sections: [
                { key: 'popular',     label: 'Popular Movies',   viewAll: { type: 'category', slug: 'popular' },     items: (popMovies.results || []).slice(0, HOME_LIMIT).map(r => toCard(r, providerName, 'movie')) },
                { key: 'top-rated',   label: 'Top Rated Movies', viewAll: { type: 'category', slug: 'top-rated' },   items: (topMovies.results || []).slice(0, HOME_LIMIT).map(r => toCard(r, providerName, 'movie')) },
                { key: 'popular-tv',  label: 'Popular TV',       viewAll: { type: 'category', slug: 'popular-tv' },  items: (popTv.results || []).slice(0, HOME_LIMIT).map(r => toCard(r, providerName, 'tv')) },
                { key: 'on-air-tv',   label: 'On Air TV',        viewAll: { type: 'category', slug: 'on-air-tv' },   items: (onAir.results || []).slice(0, HOME_LIMIT).map(r => toCard(r, providerName, 'tv')) },
            ],
        };
    });
}

async function getDetail(providerName, url) {
    const ref = parseUrl(url);
    if (!ref) throw Object.assign(new Error('Valid TMDB URL required (themoviedb.org/movie/<id> or /tv/<id>)'), { status: 400 });

    const data = await api(`/${ref.type}/${ref.id}`, { append_to_response: 'credits,images,external_ids,videos,similar' });

    const isSerial = ref.type === 'tv';
    const cast = (data.credits?.cast || []).slice(0, 20).map(c => ({
        id:    String(c.id),
        name:  c.name,
        image: c.profile_path ? poster(c.profile_path) : null,
    }));
    const director = (data.credits?.crew || []).find(c => c.job === 'Director')?.name
                  || (data.created_by || [])[0]?.name
                  || null;
    const screenshots = (data.images?.backdrops || []).slice(0, 12).map(b => ({
        full:  backdrop(b.file_path),
        thumb: poster(b.file_path),
    }));
    const related = (data.similar?.results || []).slice(0, 12).map(r => toCard(r, providerName, ref.type));

    const year = (data.release_date || data.first_air_date || '').slice(0, 4);
    const duration = isSerial
        ? (data.episode_run_time?.[0] ? `${data.episode_run_time[0]} min` : null)
        : (data.runtime ? `${data.runtime} min` : null);
    const country = (data.production_countries || [])[0]?.name
                 || (data.origin_country || [])[0]
                 || null;
    const genres = (data.genres || []).map(g => g.name);
    const imdbId = data.external_ids?.imdb_id || data.imdb_id || null;

    return {
        provider:    providerName,
        contentId:   String(ref.id),
        contentUrl:  url,
        title:       data.title || data.name || '',
        description: data.overview || null,
        thumbnail:   poster(data.poster_path),
        banner:      backdrop(data.backdrop_path),
        year:        year ? Number(year) : null,
        duration,
        country,
        director,
        genres,
        cast,
        likes:       0,
        dislikes:    0,
        isSerial,
        screenshots,
        related,
        extra: {
            tmdbId:      ref.id,
            imdbId,
            tagline:     data.tagline || null,
            voteAverage: data.vote_average ?? null,
            voteCount:   data.vote_count ?? null,
            status:      data.status || null,
            seasons: isSerial
                ? (data.seasons || []).filter(s => s.season_number > 0).map(s => ({
                    seasonNumber: s.season_number,
                    name:         s.name,
                    episodeCount: s.episode_count,
                    airDate:      s.air_date,
                    poster:       poster(s.poster_path),
                  }))
                : null,
        },
    };
}

async function getSeasonEpisodes(tmdbId, season) {
    return api(`/tv/${tmdbId}/season/${season}`);
}

async function getExternalIds(type, tmdbId) {
    return api(`/${type}/${tmdbId}/external_ids`);
}

function categoryList(providerName) {
    return Object.keys(CATEGORIES).map(slug => ({
        provider: providerName,
        slug,
        label:    CATEGORIES[slug].label,
        type:     CATEGORIES[slug].type,
        url:      `https://www.themoviedb.org/${CATEGORIES[slug].type}`,
    }));
}

function genreList(providerName) {
    return GENRES.map(g => ({
        provider: providerName,
        slug:     g.slug,
        label:    g.label,
        url:      `https://www.themoviedb.org/discover/movie?with_genres=${g.id}`,
        image:    null,
    }));
}

module.exports = {
    api,
    poster,
    backdrop,
    parseUrl,
    siteUrl,
    toCard,
    buildListing,
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
    getSeasonEpisodes,
    getExternalIds,
    categoryList,
    genreList,
    CATEGORIES,
    GENRES,
};
