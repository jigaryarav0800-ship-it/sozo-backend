const express   = require('express');
const router    = express.Router();
const adminAuth = require('../../middlewares/adminAuth');
const c         = require('../../controllers/admin/dashboard.controller');
const { rateLimit, timeout } = require('../../middlewares/rateLimit');

router.use(adminAuth);
router.use(timeout(15_000));

const statsLimit = rateLimit({ name: 'admin:dashboard', capacity: 30, refillPerSec: 1, keyBy: 'ip' });

router.get('/stats',     statsLimit, c.stats);
router.get('/growth',    statsLimit, c.growth);
router.get('/providers', statsLimit, c.providers);

module.exports = router;
