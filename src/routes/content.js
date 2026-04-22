const express = require('express');
const router = express.Router();
const c = require('../controllers/contentController');

router.get('/categories',           c.getCategories);
router.get('/genres',               c.getGenres);
router.get('/latest',               c.getLatest);
router.get('/search',               c.search);
router.get('/detail',               c.getDetail);
router.get('/category/:category',   c.getCategory);
router.get('/genre/:genre',         c.getGenre);
router.get('/year/:year',           c.getYear);

module.exports = router;
