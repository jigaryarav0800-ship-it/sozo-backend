'use strict';
const axios = require('axios');
const { SwrCache } = require('../utils/swrCache');

const STREMIO_BASE = 'https://opensubtitles-v3.strem.io';
const WYZIE_BASE   = 'https://sub.wyzie.io';

const swr = new SwrCache({ maxEntries: 300 });
swr.startSweepTimer();

const LANG_NAMES = {
  eng: 'English', rus: 'Russian', uzb: 'Uzbek', tur: 'Turkish',
  spa: 'Spanish', fre: 'French', ger: 'German', ita: 'Italian',
  por: 'Portuguese', ara: 'Arabic', hin: 'Hindi', jpn: 'Japanese',
  kor: 'Korean', chi: 'Chinese', pol: 'Polish', dut: 'Dutch',
  swe: 'Swedish', dan: 'Danish', nor: 'Norwegian', fin: 'Finnish',
  cze: 'Czech', hun: 'Hungarian', rum: 'Romanian', bul: 'Bulgarian',
  hrv: 'Croatian', srp: 'Serbian', slv: 'Slovenian', heb: 'Hebrew',
  tha: 'Thai', vie: 'Vietnamese', ind: 'Indonesian', may: 'Malay',
  gre: 'Greek', ukr: 'Ukrainian', est: 'Estonian', geo: 'Georgian',
};

function langLabel(code) {
  if (!code) return 'subtitle';
  return LANG_NAMES[code] || code;
}

/**
 * Stremio OpenSubtitles v3 — bepul, API key shart emas
 */
async function fetchFromStremio({ imdbId, type, season, episode }) {
  const stremioType = type === 'tv' ? 'series' : 'movie';
  const id = type === 'tv'
    ? `${imdbId}:${season || 1}:${episode || 1}`
    : imdbId;

  const url = `${STREMIO_BASE}/subtitles/${stremioType}/${id}.json`;

  const { data } = await axios.get(url, {
    timeout: 8_000,
    headers: { 'User-Agent': 'SoPlay/1.0', Accept: 'application/json' },
  });

  const raw = data?.subtitles || [];
  if (!Array.isArray(raw) || raw.length === 0) return [];

  // Har tildan bitta eng yaxshisini olish
  const byLang = new Map();
  for (const s of raw) {
    if (!s.url) continue;
    const lang = s.lang || 'eng';
    if (!byLang.has(lang)) {
      byLang.set(lang, {
        label:    langLabel(lang),
        file:     s.url,
        language: lang,
        kind:     'captions',
        default:  lang === 'eng',
      });
    }
  }

  return [...byLang.values()];
}

/**
 * Wyzie fallback — WYZIE_API_KEY bo'lsa ishlatadi
 */
async function fetchFromWyzie({ id, language, type, season, episode }) {
  const key = process.env.WYZIE_API_KEY;
  if (!key) return [];

  const params = new URLSearchParams({ id: String(id), language: language || 'en', key });
  if (type)            params.set('type',    String(type));
  if (season != null)  params.set('season',  String(season));
  if (episode != null) params.set('episode', String(episode));

  const res = await axios.get(`${WYZIE_BASE}/search?${params}`, {
    timeout: 8_000,
    headers: { 'User-Agent': 'SoPlay/1.0', Accept: 'application/json' },
    validateStatus: () => true,
  });

  if (res.status !== 200) return [];

  const raw = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
  return raw.map(s => ({
    label:    s.display || s.language || 'subtitle',
    file:     s.url,
    language: s.language || null,
    kind:     'captions',
    default:  false,
  })).filter(s => s.file);
}

/**
 * Asosiy funksiya — avval Stremio, keyin Wyzie fallback
 */
async function searchSubtitles({ id, language = 'en', type, season, episode }) {
  if (!id) throw Object.assign(new Error('id majburiy'), { status: 400 });

  const isImdb = /^tt\d+$/i.test(String(id));
  const cacheKey = `subs:${id}:${type}:${season}:${episode}`;

  return swr.fetch(cacheKey, 30 * 60 * 1000, 2 * 60 * 60 * 1000, async () => {
    // 1. Stremio (IMDB ID kerak)
    if (isImdb) {
      const stremioResult = await fetchFromStremio({
        imdbId: id, type, season, episode,
      }).catch(() => []);
      if (stremioResult.length > 0) return stremioResult;
    }

    // 2. Wyzie fallback
    const wyzieResult = await fetchFromWyzie({
      id, language, type, season, episode,
    }).catch(() => []);
    return wyzieResult;
  });
}

module.exports = { searchSubtitles };
