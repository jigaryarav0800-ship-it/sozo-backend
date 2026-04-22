const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const c = require('../controllers/authController');

router.post('/register',     c.register);
router.post('/login',        c.login);
router.post('/google',       c.googleAuth);

router.get('/profile',  auth, c.getProfile);
router.put('/profile',  auth, c.updateProfile);

router.get('/favorites',    auth, c.getFavorites);
router.post('/favorites',   auth, c.addFavorite);
router.delete('/favorites', auth, c.removeFavorite);

router.get('/history',        auth, c.getHistory);
router.post('/history',       auth, c.addToHistory);
router.delete('/history',     auth, c.clearHistory);
router.delete('/history/item', auth, c.removeFromHistory);

module.exports = router;
