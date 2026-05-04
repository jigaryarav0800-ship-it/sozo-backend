const express   = require('express');
const router    = express.Router();
const adminAuth = require('../../middlewares/adminAuth');
const c         = require('../../controllers/admin/users.controller');
const { timeout } = require('../../middlewares/rateLimit');

router.use(adminAuth);
router.use(timeout(15_000));

router.get('/', c.list);

module.exports = router;
