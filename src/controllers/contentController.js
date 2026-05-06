const { getProvider, detectProvider, listProviders, normalizeDetail, normalizeEpisodes, normalizeMedia, getEpisodes: providerGetEpisodes, resolveMedia } = require('../providers');
const wyzieService = require('../services/wyzieService');

function normalizeFavoriteUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function isFavoritedBy(user, providerName, detail, requestUrl) {
  if (!user) return null;

  const candidates = new Set(
    [requestUrl, detail.contentUrl]
      .filter(Boolean)
      .map(normalizeFavoriteUrl)
  );

  return (user.favorites || []).some((favorite) => (
    favorite.provider === providerName
    && candidates.has(normalizeFavoriteUrl(favorite.contentUrl))
  ));
}

async function getLatest(req, res) {
  const { page = 1, provider = 'asilmedia' } = req.query;
  const result = await getProvider(provider).getLatest(page);
  res.json(result);
}

async function getHome(req, res) {
  const { provider = 'asilmedia' } = req.query;
  const result = await getProvider(provider).getHome();

  // token bo'lsa — myList seksiyasini qo'shish
  if (req.user && Array.isArray(req.user.favorites) && req.user.favorites.length > 0) {
    const myListItems = req.user.favorites
      .filter(f => !provider || f.provider === provider)
      .slice(0, 12)
      .map(f => ({
        provider:   f.provider,
        title:      f.title || '',
        contentUrl: f.contentUrl,
        thumbnail:  f.thumbnail || null,
      }));
    if (myListItems.length > 0) {
      const myListSection = { key: 'my-list', label: 'Mening ro\'yxatim', items: myListItems };
      result.sections = [myListSection, ...(result.sections || [])];
    }
  }

  res.json(result);
}

async function getCategory(req, res) {
  const { page = 1, provider = 'asilmedia' } = req.query;
  const result = await getProvider(provider).getCategory(req.params.category, page);
  res.json(result);
}

async function getGenre(req, res) {
  const { page = 1, provider = 'asilmedia' } = req.query;
  const result = await getProvider(provider).getGenre(req.params.genre, page);
  res.json(result);
}

async function getYear(req, res) {
  const { page = 1, provider = 'asilmedia' } = req.query;
  const result = await getProvider(provider).getYear(req.params.year, page);
  res.json(result);
}

async function getCountry(req, res) {
  const { page = 1, provider = 'asilmedia' } = req.query;
  const result = await getProvider(provider).getCountry(req.params.country, page);
  res.json(result);
}

async function getActor(req, res) {
  const { page = 1, provider = 'asilmedia' } = req.query;
  const result = await getProvider(provider).getActor(req.params.actor, page);
  res.json(result);
}

async function getDirector(req, res) {
  const { page = 1, provider = 'asilmedia' } = req.query;
  const result = await getProvider(provider).getDirector(req.params.director, page);
  res.json(result);
}

async function search(req, res) {
  const { q, page = 1, provider = 'asilmedia' } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ message: 'q parametri kamida 2 ta belgi bo\'lishi kerak' });
  }
  const result = await getProvider(provider).search(q.trim(), page);
  res.json(result);
}

async function getDetail(req, res) {
  const { url, provider } = req.query;
  if (!url) return res.status(400).json({ message: 'url parametri majburiy' });
  const providerName = provider || detectProvider(url);
  const raw = await getProvider(providerName).getDetail(url);
  const detail = normalizeDetail(raw, providerName);
  const isFavorited = isFavoritedBy(req.user, providerName, detail, url);
  if (isFavorited !== null) detail.isFavorited = isFavorited;
  res.json(detail);
}

async function getEpisodes(req, res) {
  const { url, page, size, sort, provider } = req.query;
  if (!url) return res.status(400).json({ message: 'url parametri majburiy' });
  const providerName = provider || detectProvider(url);
  const opts = { page, size, sort };
  const raw = await providerGetEpisodes(providerName, url, opts);
  res.json(normalizeEpisodes(raw, providerName, opts));
}

async function checkVideo(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ message: 'url parametri majburiy' });
  const providerName = detectProvider(url);
  const result = await getProvider(providerName).checkVideoUrl(url);
  res.json(result);
}

async function getCategories(req, res) {
  const { provider = 'asilmedia' } = req.query;
  const items = await getProvider(provider).getCategoryList();
  res.json({ items });
}

async function getGenres(req, res) {
  const { provider = 'asilmedia' } = req.query;
  const items = await getProvider(provider).getGenreList();
  res.json({ items });
}

async function getMedia(req, res) {
  const { ref, provider, lang, server } = req.query;
  if (!ref)      return res.status(400).json({ message: 'ref parametri majburiy' });
  if (!provider) return res.status(400).json({ message: 'provider parametri majburiy' });
  const raw = await resolveMedia(provider, ref, { lang, server });
  res.json(normalizeMedia(raw, provider));
}

async function getProviders(req, res) {
  res.json({ items: listProviders() });
}

async function getSubtitles(req, res) {
  const { id, language = 'en', type, season, episode } = req.query;
  if (!id) return res.status(400).json({ message: 'id (TMDB yoki IMDB) majburiy' });
  const items = await wyzieService.searchSubtitles({ id, language, type, season, episode });
  res.json({ items });
}

async function diagnose(req, res) {
  const { url, provider = 'anikai' } = req.query;
  if (!url) return res.status(400).json({ message: 'url parametri majburiy' });
  const p = getProvider(provider);
  if (typeof p.diagnose !== 'function') {
    return res.status(501).json({ message: `${provider} diagnose qo'llab-quvvatlamaydi` });
  }
  const result = await p.diagnose(url);
  res.json(result);
}

module.exports = {
  getLatest, getHome,
  getCategory, getGenre, getYear, getCountry, getActor, getDirector,
  search, getDetail, getEpisodes, getMedia, checkVideo,
  getCategories, getGenres, getProviders, diagnose, getSubtitles,
};
