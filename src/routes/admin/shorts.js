const express   = require('express');
const router    = express.Router();
const adminAuth = require('../../middlewares/adminAuth');
const c         = require('../../controllers/admin/shorts.controller');
const { rateLimit, timeout } = require('../../middlewares/rateLimit');

router.use(adminAuth);
router.use(timeout(30_000));

const writeLimit   = rateLimit({ name: 'admin:shorts:write',   capacity: 30, refillPerSec: 1,      keyBy: 'ip' });
const resolveLimit = rateLimit({ name: 'admin:shorts:resolve', capacity: 10, refillPerSec: 1 / 3,  keyBy: 'ip' });

router.get('/resolve-content', resolveLimit, c.resolveContent); // /:id dan oldin bo'lishi shart
router.post('/upload-url',     writeLimit,   c.getUploadUrl);
router.post('/',               writeLimit,   c.create);
router.get('/',                              c.list);
router.get('/:id',                           c.getOne);
router.put('/:id',             writeLimit,   c.update);
router.delete('/:id',          writeLimit,   c.remove);

module.exports = router;
