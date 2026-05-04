const axios  = require('axios');
const https  = require('https');
const tmdb   = require('../utils/tmdb');
const { SwrCache } = require('../utils/swrCache');

const PROVIDER  = 'vidsrc';
const EMBED_BASE = process.env.VIDSRC_BASE_URL || 'https://vidsrc.ru';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const EMBED_HEADERS = {
  'User-Agent': UA,
  'Referer':    `${EMBED_BASE}/`,
  'Origin':     EMBED_BASE,
};

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });
httpsAgent.setMaxListeners(0);

const swr = new SwrCache({ maxEntries: 400 });
swr.startSweepTimer();

// ─── embed URL builders ────────────────────────────────────────────────────────

function movieEmbedUrl(id) {
  return `${EMBED_BASE}/embed/movie/${id}`;
}

function tvEmbedUrl(id, season, episode) {
  return `${EMBED_BASE}/embed/tv/${id}/${season}/${episode}`;
}

// ─── TMDB-delegated catalog ────────────────────────────────────────────────────

const getLatest   = (page = 1)          => tmdb.getLatest(PROVIDER, page);
const getCategory = (cat, page = 1)     => tmdb.getCategory(PROVIDER, cat, page);
const getGenre    = (genre, page = 1)   => tmdb.getGenre(PROVIDER, genre, page);
const getYear     = (year, page = 1)    => tmdb.getYear(PROVIDER, year, page);
const getCountry  = (country, page = 1) => tmdb.getCountry(PROVIDER, country, page);
const getActor    = (actor, page = 1)   => tmdb.getActor(PROVIDER, actor, page);
const getDirector = (dir, page = 1)     => tmdb.getDirector(PROVIDER, dir, page);
const search      = (q, page = 1)       => tmdb.search(PROVIDER, q, page);
const getHome     = ()                  => tmdb.getHome(PROVIDER);
const getDetail   = (url)               => tmdb.getDetail(PROVIDER, url);

// ─── episodes ──────────────────────────────────────────────────────────────────

async function getEpisodes(url) {
  const ref = tmdb.parseUrl(url);
  if (!ref) throw Object.assign(new Error('Valid TMDB URL required'), { status: 400 });

  return swr.fetch(`vidsrc:episodes:${url}`, 10 * 60 * 1000, 60 * 60 * 1000, async () => {
    const ext = await tmdb.getExternalIds(ref.type, ref.id).catch(() => ({}));
    const imdbId = ext.imdb_id || null;
    const preferredId = imdbId || ref.id;

    if (ref.type === 'movie') {
      const embedUrl = movieEmbedUrl(preferredId);
      return {
        provider:     PROVIDER,
        contentUrl:   url,
        isSerial:     false,
        videoSources: [{ quality: 'Auto', videoUrl: embedUrl, isDefault: true }],
        playerSrc:    embedUrl,
        type:         'iframe',
        headers:      EMBED_HEADERS,
      };
    }

    // TV — get all seasons from TMDB detail
    const detail = await tmdb.getDetail(PROVIDER, url);
    const seasons = (detail.extra?.seasons || []).filter(s => s.seasonNumber > 0);
    if (seasons.length === 0) {
      return { provider: PROVIDER, contentUrl: url, isSerial: true, episodes: [] };
    }

    const seasonMetaList = await Promise.all(
      seasons.map(s => tmdb.getSeasonEpisodes(ref.id, s.seasonNumber).catch(() => null))
    );

    const episodes = [];
    for (let i = 0; i < seasons.length; i++) {
      const seasonNum = seasons[i].seasonNumber;
      const meta = seasonMetaList[i];
      const epList = meta?.episodes || [];

      for (const ep of epList) {
        const epNum = ep.episode_number;
        episodes.push({
          episode:  episodes.length + 1,
          label:    `S${seasonNum}E${epNum}` + (ep.name ? ` · ${ep.name}` : ''),
          mediaRef: `${PROVIDER}:tv:${imdbId || ''}:${ref.id}:${seasonNum}:${epNum}`,
          image:    ep.still_path ? tmdb.poster(ep.still_path) : undefined,
          airdate:  ep.air_date || undefined,
          runtime:  ep.runtime ? `${ep.runtime} min` : undefined,
          overview: ep.overview || undefined,
        });
      }
    }

    return { provider: PROVIDER, contentUrl: url, isSerial: true, episodes };
  });
}

// ─── media resolution ──────────────────────────────────────────────────────────

async function resolveMedia(mediaRef) {
  if (!mediaRef) throw Object.assign(new Error("vidsrc: mediaRef bo'sh"), { status: 400 });

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
    if (!ref) throw Object.assign(new Error('vidsrc: invalid mediaRef'), { status: 400 });
    const ext = await tmdb.getExternalIds(ref.type, ref.id).catch(() => ({}));
    imdbId = ext.imdb_id || null;
    tmdbId = ref.id;
    type = ref.type;
    season = ref.season; episode = ref.episode;
  }

  const preferredId = imdbId || tmdbId;
  if (!preferredId) {
    throw Object.assign(new Error('vidsrc: no IMDB or TMDB ID available'), { status: 400 });
  }

  let embedUrl;
  if (type === 'tv') {
    if (!season || !episode) {
      throw Object.assign(new Error('vidsrc: season and episode required for TV'), { status: 400 });
    }
    embedUrl = tvEmbedUrl(preferredId, season, episode);
  } else {
    embedUrl = movieEmbedUrl(preferredId);
  }

  return {
    videoUrl:     embedUrl,
    type:         'iframe',
    headers:      EMBED_HEADERS,
    videoSources: [{
      quality:   'Auto',
      videoUrl:  embedUrl,
      isDefault: true,
      type:      'iframe',
      host:      'vidsrc.ru',
      embed:     embedUrl,
    }],
    embed: embedUrl,
    host:  'vidsrc.ru',
  };
}

// ─── utils ─────────────────────────────────────────────────────────────────────

async function checkVideoUrl(videoUrl) {
  try {
    const res = await axios.head(videoUrl, {
      timeout: 8_000,
      headers: EMBED_HEADERS,
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
    return { accessible: false, status: err.response?.status || 0, error: err.message };
  }
}

const getCategoryList = () => tmdb.categoryList(PROVIDER);
const getGenreList    = () => tmdb.genreList(PROVIDER);

module.exports = {
  name:    PROVIDER,
  domains: ['vidsrc.ru'],
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
