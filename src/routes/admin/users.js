const express   = require('express');
const router    = express.Router();
const adminAuth = require('../../middlewares/adminAuth');
const c         = require('../../controllers/admin/users.controller');
const { rateLimit, timeout } = require('../../middlewares/rateLimit');

router.use(adminAuth);
router.use(timeout(15_000));

const writeLimit = rateLimit({ name: 'admin:users:write', capacity: 30, refillPerSec: 1, keyBy: 'ip' });

router.get('/',               c.list);
router.get('/:id',            c.getOne);
router.put('/:id',            writeLimit, c.update);
router.delete('/:id',         writeLimit, c.remove);
router.post('/:id/ban',       writeLimit, c.ban);
router.post('/:id/unban',     writeLimit, c.unban);
router.get('/:id/comments',   c.getUserComments);

module.exports = router;
