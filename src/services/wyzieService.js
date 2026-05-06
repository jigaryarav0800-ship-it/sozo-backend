'use strict';
const axios = require('axios');

const WYZIE_BASE = 'https://sub.wyzie.io';

async function searchSubtitles({ id, language = 'en', type, season, episode }) {
  if (!id) throw Object.assign(new Error('id majburiy'), { status: 400 });

  const params = new URLSearchParams({ id: String(id), language });
  const key = process.env.WYZIE_API_KEY;
  if (key) params.set('key', key);
  if (type)           params.set('type',    String(type));
  if (season != null) params.set('season',  String(season));
  if (episode != null) params.set('episode', String(episode));

  const res = await axios.get(`${WYZIE_BASE}/search?${params}`, {
    timeout: 8_000,
    headers: { 'User-Agent': 'SoPlay/1.0', 'Accept': 'application/json' },
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    throw Object.assign(new Error(`Wyzie ${res.status}: ${JSON.stringify(res.data)}`), { status: 502 });
  }

  const raw = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);

  return raw.map(s => ({
    label:    s.display || s.language || 'subtitle',
    file:     s.url,
    language: s.language || null,
    format:   s.format  || null,
    kind:     'subtitles',
    source:   s.source  || null,
  })).filter(s => s.file);
}

module.exports = { searchSubtitles };
