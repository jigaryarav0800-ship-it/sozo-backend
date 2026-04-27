const { getProvider, detectProvider, listProviders } = require('../providers');

async function getLatest(req, res) {
  const { page = 1, provider = 'asilmedia' } = req.query;
  const result = await getProvider(provider).getLatest(page);
  res.json(result);
}

async function getHome(req, res) {
  const { provider = 'asilmedia' } = req.query;
  const result = await getProvider(provider).getHome();
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
  const { url } = req.query;
  if (!url) return res.status(400).json({ message: 'url parametri majburiy' });
  const providerName = detectProvider(url);
  const result = await getProvider(providerName).getDetail(url);
  res.json(result);
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
  res.json({ items: getProvider(provider).getCategoryList() });
}

async function getGenres(req, res) {
  const { provider = 'asilmedia' } = req.query;
  res.json({ items: getProvider(provider).getGenreList() });
}

async function getProviders(req, res) {
  res.json({ items: listProviders() });
}

module.exports = {
  getLatest, getHome,
  getCategory, getGenre, getYear, getCountry, getActor, getDirector,
  search, getDetail, checkVideo,
  getCategories, getGenres, getProviders,
};
