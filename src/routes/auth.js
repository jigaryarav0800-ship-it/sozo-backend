const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const c = require('../controllers/authController');

router.post('/register', c.register);
router.post('/login', c.login);

router.get('/profile', auth, c.getProfile);
router.put('/profile', auth, c.updateProfile);

router.post('/favorites', auth, c.addFavorite);
router.delete('/favorites', auth, c.removeFavorite);

router.post('/history', auth, c.addToHistory);

module.exports = router;
