const express = require('express');
const router  = express.Router();

router.use('/auth',      require('./auth'));
router.use('/dashboard', require('./dashboard'));
router.use('/shorts',    require('./shorts'));
router.use('/users',     require('./users'));
router.use('/comments',  require('./comments'));

module.exports = router;
