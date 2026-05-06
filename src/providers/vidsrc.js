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
  return `${EMBED_BASE}/movie/${id}`;
}

function tvEmbedUrl(id, season, episode) {
  return `${EMBED_BASE}/tv/${id}/${season}/${episode}`;
}

function parseVidsrcUrl(url) {
  const value = String(url || '');
  let m = value.match(/vidsrc\.ru\/(?:embed\/)?movie\/([^/?#]+)/i);
  if (m) return { type: 'movie', id: decodeURIComponent(m[1]), season: null, episode: null };

  m = value.match(/vidsrc\.ru\/(?:embed\/)?tv\/([^/?#]+)(?:\/(\d+)\/(\d+))?/i);
  if (m) {
    return {
      type:    'tv',
      id:      decodeURIComponent(m[1]),
      season:  m[2] ? Number(m[2]) : null,
      episode: m[3] ? Number(m[3]) : null,
    };
  }
  return null;
}

function isImdbId(id) {
  return /^tt\d+$/i.test(String(id || ''));
}

async function imdbToTmdbRef(imdbId, type) {
  const data = await tmdb.api(`/find/${imdbId}`, { external_source: 'imdb_id' });
  const movie = data.movie_results?.[0];
  const tv = data.tv_results?.[0];
  const hit = type === 'tv' ? tv : type === 'movie' ? movie : (movie || tv);
  if (!hit?.id) {
    throw Object.assign(new Error(`vidsrc: TMDB id not found for ${imdbId}`), { status: 404 });
  }
  return { type: type || (hit === tv ? 'tv' : 'movie'), id: hit.id };
}

async function resolveRef(input) {
  const ref = tmdb.parseUrl(input) || parseVidsrcUrl(input);
  if (!ref) throw Object.assign(new Error('vidsrc: valid TMDB or Vidsrc URL required'), { status: 400 });

  if (!isImdbId(ref.id)) {
    const ext = await tmdb.getExternalIds(ref.type, ref.id).catch(() => ({}));
    return {
      ...ref,
      tmdbId: Number(ref.id),
      imdbId: ext.imdb_id || null,
      streamId: ext.imdb_id || ref.id,
      tmdbUrl: tmdb.siteUrl(ref.type, ref.id),
    };
  }

  const tmdbRef = await imdbToTmdbRef(ref.id, ref.type);
  return {
    ...ref,
    type: tmdbRef.type,
    tmdbId: tmdbRef.id,
    imdbId: ref.id,
    streamId: ref.id,
    tmdbUrl: tmdb.siteUrl(tmdbRef.type, tmdbRef.id),
  };
}

// ─── TMDB-delegated catalog ────────────────────────────────────────────────────

function providerUrl(type, id) {
  return `${EMBED_BASE}/${type === 'tv' ? 'tv' : 'movie'}/${id}`;
}

function toVidsrcCard(card) {
  if (!card || typeof card !== 'object') return card;
  const type = card.category === 'tv' ? 'tv' : 'movie';
  const id = card.externalId || card.slug;
  return id ? { ...card, provider: PROVIDER, contentUrl: providerUrl(type, id) } : { ...card, provider: PROVIDER };
}

function withVidsrcUrls(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload, provider: PROVIDER };
  if (Array.isArray(out.items)) out.items = out.items.map(toVidsrcCard);
  if (Array.isArray(out.banner)) out.banner = out.banner.map(toVidsrcCard);
  if (Array.isArray(out.related)) out.related = out.related.map(toVidsrcCard);
  if (Array.isArray(out.sections)) {
    out.sections = out.sections.map(section => ({
      ...section,
      items: Array.isArray(section.items) ? section.items.map(toVidsrcCard) : section.items,
    }));
  }
  return out;
}

const getLatest   = async (page = 1)          => withVidsrcUrls(await tmdb.getLatest(PROVIDER, page));
const getCategory = async (cat, page = 1)     => withVidsrcUrls(await tmdb.getCategory(PROVIDER, cat, page));
const getGenre    = async (genre, page = 1)   => withVidsrcUrls(await tmdb.getGenre(PROVIDER, genre, page));
const getYear     = async (year, page = 1)    => withVidsrcUrls(await tmdb.getYear(PROVIDER, year, page));
const getCountry  = async (country, page = 1) => withVidsrcUrls(await tmdb.getCountry(PROVIDER, country, page));
const getActor    = async (actor, page = 1)   => withVidsrcUrls(await tmdb.getActor(PROVIDER, actor, page));
const getDirector = async (dir, page = 1)     => withVidsrcUrls(await tmdb.getDirector(PROVIDER, dir, page));
const search      = async (q, page = 1)       => withVidsrcUrls(await tmdb.search(PROVIDER, q, page));
const getHome     = async ()                  => withVidsrcUrls(await tmdb.getHome(PROVIDER));

async function getDetail(url) {
  const ref = await resolveRef(url);
  const detail = await tmdb.getDetail(PROVIDER, ref.tmdbUrl);
  return {
    ...detail,
    contentUrl: parseVidsrcUrl(url) ? url : providerUrl(ref.type, ref.tmdbId),
    related: Array.isArray(detail.related) ? detail.related.map(toVidsrcCard) : detail.related,
    extra: {
      ...(detail.extra || {}),
      tmdbId: ref.tmdbId,
      imdbId: ref.imdbId || detail.extra?.imdbId || null,
      vidsrcUrl: ref.type === 'tv'
        ? tvEmbedUrl(ref.streamId, ref.season || 1, ref.episode || 1)
        : movieEmbedUrl(ref.streamId),
    },
  };
}

// ─── episodes ──────────────────────────────────────────────────────────────────

async function getEpisodes(url) {
  const ref = await resolveRef(url);

  return swr.fetch(`vidsrc:episodes:${url}`, 10 * 60 * 1000, 60 * 60 * 1000, async () => {
    if (ref.type === 'movie') {
      const embedUrl = movieEmbedUrl(ref.streamId);
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
    if (ref.season && ref.episode) {
      const embedUrl = tvEmbedUrl(ref.streamId, ref.season, ref.episode);
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

    const detail = await tmdb.getDetail(PROVIDER, ref.tmdbUrl);
    const seasons = (detail.extra?.seasons || []).filter(s => s.seasonNumber > 0);
    if (seasons.length === 0) {
      return { provider: PROVIDER, contentUrl: url, isSerial: true, episodes: [] };
    }

    const seasonMetaList = await Promise.all(
      seasons.map(s => tmdb.getSeasonEpisodes(ref.tmdbId, s.seasonNumber).catch(() => null))
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
          mediaRef: `${PROVIDER}:tv:${ref.imdbId || ''}:${ref.tmdbId}:${seasonNum}:${epNum}`,
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
  } else if (/^tt\d+$/i.test(mediaRef)) {
    imdbId = mediaRef; type = 'movie';
  } else {
    const ref = await resolveRef(mediaRef);
    imdbId = ref.imdbId || null;
    tmdbId = ref.tmdbId;
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
