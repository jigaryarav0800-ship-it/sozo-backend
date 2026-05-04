const express   = require('express');
const router    = express.Router();
const adminAuth = require('../../middlewares/adminAuth');
const c         = require('../../controllers/admin/comments.controller');
const { rateLimit, timeout } = require('../../middlewares/rateLimit');

router.use(adminAuth);
router.use(timeout(15_000));

const readLimit  = rateLimit({ name: 'admin:comments:read',   capacity: 60, refillPerSec: 1,     keyBy: 'ip' });
const writeLimit = rateLimit({ name: 'admin:comments:write',  capacity: 30, refillPerSec: 1,     keyBy: 'ip' });

router.get('/',     readLimit,  c.list);
router.delete('/:id', writeLimit, c.remove);

module.exports = router;
