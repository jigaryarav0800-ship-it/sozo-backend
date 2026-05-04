const express      = require('express');
const router       = express.Router();
const auth         = require('../middlewares/auth');
const optionalAuth = require('../middlewares/optionalAuth');
const c            = require('../controllers/shorts.controller');
const { rateLimit, timeout } = require('../middlewares/rateLimit');

router.use(timeout(10_000));

const readLimit = rateLimit({ name: 'shorts:read', capacity: 60, refillPerSec: 1,     keyBy: 'ip'   });
const viewLimit = rateLimit({ name: 'shorts:view', capacity: 20, refillPerSec: 1 / 3, keyBy: 'ip'   });
const likeLimit = rateLimit({ name: 'shorts:like', capacity: 10, refillPerSec: 1,     keyBy: 'user' });

router.get('/feed',       optionalAuth, readLimit, c.feed);          // mobile uchun optimallashtirilgan
router.get('/',           optionalAuth, readLimit, c.list);
router.get('/:id',        optionalAuth, readLimit, c.getOne);
router.post('/:id/view',               viewLimit,  c.incrementView);
router.post('/:id/like',  auth,         likeLimit,  c.toggleLike);

module.exports = router;
