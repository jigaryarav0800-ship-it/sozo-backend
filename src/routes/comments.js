const express = require('express');
const router  = express.Router();
const auth          = require('../middlewares/auth');
const optionalAuth  = require('../middlewares/optionalAuth');
const c             = require('../controllers/commentController');
const { rateLimit, timeout } = require('../middlewares/rateLimit');

router.use(timeout(10_000));

const readLimit = rateLimit({ name: 'comments:read', capacity: 60, refillPerSec: 60 / 60, keyBy: 'ip' });

const createLimit = rateLimit({ name: 'comments:create', capacity: 3,  refillPerSec: 1 / 8,  keyBy: 'user' });
const editLimit   = rateLimit({ name: 'comments:edit',   capacity: 3,  refillPerSec: 1 / 5,  keyBy: 'user' });
const deleteLimit = rateLimit({ name: 'comments:delete', capacity: 5,  refillPerSec: 1 / 2,  keyBy: 'user' });
const likeLimit   = rateLimit({ name: 'comments:like',   capacity: 10, refillPerSec: 1,      keyBy: 'user' });

router.get('/',             optionalAuth, readLimit, c.list);
router.get('/:id/replies',  optionalAuth, readLimit, c.listReplies);

router.post('/',            auth, createLimit, c.create);
router.put('/:id',          auth, editLimit,   c.update);
router.delete('/:id',       auth, deleteLimit, c.remove);
router.post('/:id/like',    auth, likeLimit,   c.toggleLike);

module.exports = router;
