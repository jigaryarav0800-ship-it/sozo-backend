const express = require('express');
const router = express.Router();
const c = require('../controllers/contentController');

router.get('/categories',           c.getCategories);
router.get('/genres',               c.getGenres);
router.get('/home',                 c.getHome);
router.get('/latest',               c.getLatest);
router.get('/search',               c.search);
router.get('/detail',               c.getDetail);
router.get('/check-video',          c.checkVideo);
router.get('/category/:category',   c.getCategory);
router.get('/genre/:genre',         c.getGenre);
router.get('/year/:year',           c.getYear);
router.get('/country/:country',     c.getCountry);
router.get('/actor/:actor',         c.getActor);
router.get('/director/:director',   c.getDirector);

module.exports = router;
