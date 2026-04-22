const asilmedia = require('../services/asilmedia');

async function getLatest(req, res) {
  const { page = 1 } = req.query;
  const result = await asilmedia.getLatest(page);
  res.json(result);
}

async function getHome(req, res) {
  const result = await asilmedia.getHome();
  res.json(result);
}

async function getCategory(req, res) {
  const { page = 1 } = req.query;
  const result = await asilmedia.getCategory(req.params.category, page);
  res.json(result);
}

async function getGenre(req, res) {
  const { page = 1 } = req.query;
  const result = await asilmedia.getGenre(req.params.genre, page);
  res.json(result);
}

async function getYear(req, res) {
  const { page = 1 } = req.query;
  const result = await asilmedia.getYear(req.params.year, page);
  res.json(result);
}

async function getCountry(req, res) {
  const { page = 1 } = req.query;
  const result = await asilmedia.getCountry(req.params.country, page);
  res.json(result);
}

async function getActor(req, res) {
  const { page = 1 } = req.query;
  const result = await asilmedia.getActor(req.params.actor, page);
  res.json(result);
}

async function getDirector(req, res) {
  const { page = 1 } = req.query;
  const result = await asilmedia.getDirector(req.params.director, page);
  res.json(result);
}

async function search(req, res) {
  const { q, page = 1 } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ message: 'q parametri kamida 2 ta belgi bo\'lishi kerak' });
  }
  const result = await asilmedia.search(q.trim(), page);
  res.json(result);
}

async function getDetail(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ message: 'url parametri majburiy' });
  const result = await asilmedia.getDetail(url);
  res.json(result);
}

async function checkVideo(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ message: 'url parametri majburiy' });
  const result = await asilmedia.checkVideoUrl(url);
  res.json(result);
}

async function getCategories(req, res) {
  res.json({ items: asilmedia.getCategoryList() });
}

async function getGenres(req, res) {
  res.json({ items: asilmedia.getGenreList() });
}

module.exports = {
  getLatest, getHome,
  getCategory, getGenre, getYear, getCountry, getActor, getDirector,
  search, getDetail, checkVideo,
  getCategories, getGenres,
};
