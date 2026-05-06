const axios  = require('axios');
const https  = require('https');
const tmdb   = require('../utils/tmdb');
const { SwrCache } = require('../utils/swrCache');
const wyzie  = require('../services/wyzieService');

const PROVIDER   = 'vidsrc';
const EMBED_BASE = process.env.VIDSRC_BASE_URL || 'https://vidsrc.ru';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const STREAM_HEADERS = {
  'User-Agent': UA,
  'Referer':    `${EMBED_BASE}/`,
  'Origin':     EMBED_BASE,
};

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });
httpsAgent.setMaxListeners(0);

const http = axios.create({
  baseURL: EMBED_BASE,
  timeout: 15_000,
  httpsAgent,
  headers: { 'User-Agent': UA, Accept: '*/*' },
});

const swr = new SwrCache({ maxEntries: 400 });
swr.startSweepTimer();

// ─── embed URL builders ────────────────────────────────────────────────────────

function movieEmbedUrl(id) {
  return `${EMBED_BASE}/embed/movie/${id}`;
}

function tvEmbedUrl(id, season, episode) {
  return `${EMBED_BASE}/embed/tv/${id}/${season}/${episode}`;
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
      tmdbId:   Number(ref.id),
      imdbId:   ext.imdb_id || null,
      streamId: ext.imdb_id || ref.id,
      tmdbUrl:  tmdb.siteUrl(ref.type, ref.id),
    };
  }

  const tmdbRef = await imdbToTmdbRef(ref.id, ref.type);
  return {
    ...ref,
    type:     tmdbRef.type,
    tmdbId:   tmdbRef.id,
    imdbId:   ref.id,
    streamId: ref.id,
    tmdbUrl:  tmdb.siteUrl(tmdbRef.type, tmdbRef.id),
  };
}

// ─── stream extraction ────────────────────────────────────────────────────────

async function fetchSources(preferredId, type, season, episode) {
  const embedPath = type === 'tv'
    ? `/embed/tv/${preferredId}/${season}/${episode}`
    : `/embed/movie/${preferredId}`;

  const cacheKey = `vidsrc:src:${embedPath}`;
  return swr.fetch(cacheKey, 10 * 60 * 1000, 30 * 60 * 1000, async () => {
    const { data: html } = await http.get(embedPath, {
      headers: { ...STREAM_HEADERS, Accept: 'text/html,*/*' },
    });

    if (!html || typeof html !== 'string') {
      throw Object.assign(new Error('vidsrc: empty embed response'), { status: 502 });
    }

    const streams = [];
    const subtitles = [];

    // ── 1. direct m3u8 / mp4 URLs in page ──
    for (const [, url] of html.matchAll(/["'](https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi)) {
      if (!streams.some(s => s.url === url)) streams.push({ url, type: 'hls' });
    }
    for (const [, url] of html.matchAll(/["'](https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/gi)) {
      if (!streams.some(s => s.url === url)) streams.push({ url, type: 'mp4' });
    }

    // ── 2. subtitle URLs (.vtt / .srt) ──
    for (const [, url] of html.matchAll(/["'](https?:\/\/[^\s"'<>]+\.(?:vtt|srt|ass)[^\s"'<>]*)/gi)) {
      if (!subtitles.some(s => s.file === url)) {
        subtitles.push({ file: url, label: 'subtitle', kind: 'captions', default: false });
      }
    }

    // ── 3. <track> elements ──
    for (const [full, src] of html.matchAll(/<track[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
      const fileUrl = src.startsWith('http') ? src : `${EMBED_BASE}${src}`;
      if (!subtitles.some(s => s.file === fileUrl)) {
        const lbl = full.match(/label=["']([^"']+)["']/i)?.[1] || 'subtitle';
        const def = /\bdefault\b/i.test(full);
        subtitles.push({ file: fileUrl, label: lbl, kind: 'captions', default: def });
      }
    }

    // ── 4. JSON blob inside script (file/sources/tracks pattern) ──
    for (const [, json] of html.matchAll(/(?:sources|playerConfig|config)\s*[:=]\s*(\{[^}]{20,}\}|\[[^\]]{20,}\])/gi)) {
      try {
        const obj = JSON.parse(json);
        const items = Array.isArray(obj) ? obj : [obj];
        for (const item of items) {
          const u = item.file || item.src || item.url;
          if (u && /\.m3u8/i.test(u) && !streams.some(s => s.url === u)) {
            streams.push({ url: u, type: 'hls', quality: item.label || item.quality });
          }
          if (u && /\.mp4/i.test(u) && !streams.some(s => s.url === u)) {
            streams.push({ url: u, type: 'mp4', quality: item.label || item.quality });
          }
        }
      } catch {}
    }

    // ── 5. tracks array inside script ──
    for (const [, json] of html.matchAll(/tracks\s*[:=]\s*(\[[^\]]{10,}\])/gi)) {
      try {
        const arr = JSON.parse(json);
        for (const t of arr) {
          const f = t.file || t.src || t.url;
          if (f && !subtitles.some(s => s.file === f)) {
            subtitles.push({
              file:    f,
              label:   (t.label || t.lang || t.language || 'subtitle').trim(),
              kind:    t.kind || 'captions',
              default: Boolean(t.default),
            });
          }
        }
      } catch {}
    }

    // ── 6. AJAX source loading (data-id / data-hash) ──
    if (streams.length === 0) {
      const dataId = html.match(/data-(?:id|hash)=["']([^"']+)["']/)?.[1];
      if (dataId) {
        const ajaxHeaders = { ...STREAM_HEADERS, 'X-Requested-With': 'XMLHttpRequest' };
        const srcList = await http.get(`/ajax/embed/episode/${dataId}/sources`, { headers: ajaxHeaders })
          .then(r => r.data?.result || r.data?.sources || [])
          .catch(() => []);

        for (const src of (Array.isArray(srcList) ? srcList : [])) {
          if (!src.id) continue;
          const srcData = await http.get(`/ajax/embed/source/${src.id}`, { headers: ajaxHeaders })
            .then(r => r.data?.result || r.data || {})
            .catch(() => null);
          if (!srcData) continue;

          const u = srcData.url || srcData.file || srcData.stream;
          if (u) {
            streams.push({
              url:     u,
              type:    /\.m3u8/i.test(u) ? 'hls' : /\.mp4/i.test(u) ? 'mp4' : 'hls',
              quality: src.title || src.name || 'Auto',
            });
          }

          for (const sub of (srcData.subtitles || srcData.tracks || [])) {
            const f = sub.file || sub.url || sub.src;
            if (f && !subtitles.some(s => s.file === f)) {
              subtitles.push({
                file:    f,
                label:   (sub.label || sub.lang || 'subtitle').trim(),
                kind:    sub.kind || 'captions',
                default: Boolean(sub.default),
              });
            }
          }
        }
      }
    }

    if (streams.length === 0) {
      throw Object.assign(new Error('vidsrc: stream URLs not found'), { status: 502 });
    }

    return { streams, subtitles };
  });
}

function streamsToSources(streams) {
  return streams.map((s, i) => ({
    quality:   s.quality || `Server ${i + 1}`,
    videoUrl:  s.url,
    isDefault: i === 0,
    ...(s.type ? { type: s.type } : {}),
  }));
}

function normalizeSubtitles(raw) {
  return (raw || []).map(t => ({
    label:   (t.label || 'subtitle').trim(),
    file:    t.file,
    kind:    t.kind || 'captions',
    default: Boolean(t.default),
  })).filter(t => t.file);
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
  if (Array.isArray(out.items))    out.items   = out.items.map(toVidsrcCard);
  if (Array.isArray(out.banner))   out.banner  = out.banner.map(toVidsrcCard);
  if (Array.isArray(out.related))  out.related = out.related.map(toVidsrcCard);
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
    },
  };
}

// ─── episodes ──────────────────────────────────────────────────────────────────

async function getEpisodes(url) {
  const ref = await resolveRef(url);

  return swr.fetch(`vidsrc:episodes:${url}`, 10 * 60 * 1000, 60 * 60 * 1000, async () => {
    if (ref.type === 'movie') {
      const preferredId = ref.imdbId || ref.tmdbId;
      const data = await fetchSources(preferredId, 'movie').catch(() => null);
      if (!data || data.streams.length === 0) {
        return {
          provider: PROVIDER, contentUrl: url, isSerial: false,
          videoSources: [], playerSrc: null, type: null, headers: STREAM_HEADERS,
        };
      }
      const sources = streamsToSources(data.streams);
      let subs = normalizeSubtitles(data.subtitles);
      if (subs.length === 0 && ref.imdbId) {
        subs = await wyzie.searchSubtitles({ id: ref.imdbId, type: 'movie' }).catch(() => []);
      }
      const result = {
        provider:     PROVIDER,
        contentUrl:   url,
        isSerial:     false,
        videoSources: sources,
        playerSrc:    sources[0].videoUrl,
        type:         data.streams[0].type || 'hls',
        headers:      STREAM_HEADERS,
      };
      if (subs.length > 0) result.subtitles = subs;
      return result;
    }

    // TV — season / episode already specified
    if (ref.season && ref.episode) {
      const preferredId = ref.imdbId || ref.tmdbId;
      const data = await fetchSources(preferredId, 'tv', ref.season, ref.episode).catch(() => null);
      if (!data || data.streams.length === 0) {
        return {
          provider: PROVIDER, contentUrl: url, isSerial: false,
          videoSources: [], playerSrc: null, type: null, headers: STREAM_HEADERS,
        };
      }
      const sources = streamsToSources(data.streams);
      let subs = normalizeSubtitles(data.subtitles);
      if (subs.length === 0 && ref.imdbId) {
        subs = await wyzie.searchSubtitles({ id: ref.imdbId, type: 'tv', season: ref.season, episode: ref.episode }).catch(() => []);
      }
      const result = {
        provider:     PROVIDER,
        contentUrl:   url,
        isSerial:     false,
        videoSources: sources,
        playerSrc:    sources[0].videoUrl,
        type:         data.streams[0].type || 'hls',
        headers:      STREAM_HEADERS,
      };
      if (subs.length > 0) result.subtitles = subs;
      return result;
    }

    // TV — list all episodes
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

  if (type === 'tv' && (!season || !episode)) {
    throw Object.assign(new Error('vidsrc: season and episode required for TV'), { status: 400 });
  }

  const data = await fetchSources(preferredId, type, season, episode);
  const sources = streamsToSources(data.streams);
  let subs = normalizeSubtitles(data.subtitles);

  // embed dan subtitle kelmasa — wyzie dan olish
  if (subs.length === 0 && imdbId) {
    subs = await wyzie.searchSubtitles({ id: imdbId, type, season, episode }).catch(() => []);
  }

  const result = {
    videoUrl:     sources[0].videoUrl,
    type:         data.streams[0].type || 'hls',
    headers:      STREAM_HEADERS,
    videoSources: sources,
  };
  if (subs.length > 0) result.subtitles = subs;
  return result;
}

// ─── utils ─────────────────────────────────────────────────────────────────────

async function checkVideoUrl(videoUrl) {
  try {
    const res = await axios.head(videoUrl, {
      timeout: 8_000,
      headers: STREAM_HEADERS,
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
