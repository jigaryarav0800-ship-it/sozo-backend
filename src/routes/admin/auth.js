const express    = require('express');
const router     = express.Router();
const adminAuth  = require('../../middlewares/adminAuth');
const c          = require('../../controllers/admin/auth.controller');
const { rateLimit, timeout } = require('../../middlewares/rateLimit');

router.use(timeout(15_000));

const loginLimit = rateLimit({ name: 'admin:login', capacity: 5, refillPerSec: 1 / 180, keyBy: 'ip' });

router.post('/login',   loginLimit, c.login);
router.post('/refresh',             c.refresh);
router.post('/logout',  adminAuth,  c.logout);

module.exports = router;
