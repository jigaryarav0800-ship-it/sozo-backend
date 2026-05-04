const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/auth');
const c       = require('../controllers/authController');
const { rateLimit, timeout } = require('../middlewares/rateLimit');

router.use(timeout(15_000));

const registerStartLimit  = rateLimit({ name: 'auth:register-start',  capacity: 3,  refillPerSec: 3 / 3600,  keyBy: 'ip' });
const registerResendLimit = rateLimit({ name: 'auth:register-resend', capacity: 5,  refillPerSec: 5 / 3600,  keyBy: 'ip' });
const registerVerifyLimit = rateLimit({ name: 'auth:register-verify', capacity: 10, refillPerSec: 10 / 300,  keyBy: 'ip' });
const loginLimit          = rateLimit({ name: 'auth:login',           capacity: 8,  refillPerSec: 8 / 60,    keyBy: 'ip' });
const refreshLimit        = rateLimit({ name: 'auth:refresh',         capacity: 30, refillPerSec: 30 / 60,   keyBy: 'ip' });
const forgotLimit         = rateLimit({ name: 'auth:forgot',          capacity: 3,  refillPerSec: 3 / 3600,  keyBy: 'ip' });
const resetLimit          = rateLimit({ name: 'auth:reset',           capacity: 8,  refillPerSec: 8 / 300,   keyBy: 'ip' });

const profileLimit = rateLimit({ name: 'auth:profile', capacity: 30, refillPerSec: 30 / 60, keyBy: 'user' });
const writeLimit   = rateLimit({ name: 'auth:write',   capacity: 20, refillPerSec: 20 / 60, keyBy: 'user' });

router.post('/register',         registerStartLimit,  c.startRegister);
router.post('/register/resend',  registerResendLimit, c.resendRegisterOtp);
router.post('/register/verify',  registerVerifyLimit, c.verifyRegister);
router.post('/login',            loginLimit,          c.login);
router.post('/refresh',          refreshLimit,        c.refreshTokens);
router.post('/forgot-password',  forgotLimit,         c.forgotPassword);
router.post('/reset-password',   resetLimit,          c.resetPassword);

router.post('/logout', auth, c.logout);

router.get('/profile', auth, profileLimit, c.getProfile);
router.put('/profile', auth, writeLimit,   c.updateProfile);

router.get('/favorites',    auth, profileLimit, c.getFavorites);
router.post('/favorites',   auth, writeLimit,   c.addFavorite);
router.delete('/favorites', auth, writeLimit,   c.removeFavorite);

router.get('/history',         auth, profileLimit, c.getHistory);
router.post('/history',        auth, writeLimit,   c.addToHistory);
router.delete('/history',      auth, writeLimit,   c.clearHistory);
router.delete('/history/item', auth, writeLimit,   c.removeFromHistory);

module.exports = router;
