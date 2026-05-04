const jwt = require('jsonwebtoken');

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

const ADMIN_ACCESS_SECRET  = process.env.ADMIN_JWT_ACCESS_SECRET;
const ADMIN_REFRESH_SECRET = process.env.ADMIN_JWT_REFRESH_SECRET;

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  console.warn('[auth] JWT_ACCESS_SECRET / JWT_REFRESH_SECRET env o\'rnatilmagan — production da xavfli!');
}
if (!ADMIN_ACCESS_SECRET || !ADMIN_REFRESH_SECRET) {
  console.warn('[admin] ADMIN_JWT_ACCESS_SECRET / ADMIN_JWT_REFRESH_SECRET env o\'rnatilmagan — production da xavfli!');
}

const _access        = ACCESS_SECRET        || 'fallback_access_dev_only';
const _refresh       = REFRESH_SECRET       || 'fallback_refresh_dev_only';
const _adminAccess   = ADMIN_ACCESS_SECRET  || 'fallback_admin_access_dev_only';
const _adminRefresh  = ADMIN_REFRESH_SECRET || 'fallback_admin_refresh_dev_only';

function signAccess(payload)        { return jwt.sign(payload, _access,       { expiresIn: '15m' }); }
function signRefresh(payload)       { return jwt.sign(payload, _refresh,      { expiresIn: '7d'  }); }
function verifyAccess(token)        { return jwt.verify(token, _access);  }
function verifyRefresh(token)       { return jwt.verify(token, _refresh); }

function signAdminAccess(payload)   { return jwt.sign(payload, _adminAccess,  { expiresIn: '1h'  }); }
function signAdminRefresh(payload)  { return jwt.sign(payload, _adminRefresh, { expiresIn: '30d' }); }
function verifyAdminAccess(token)   { return jwt.verify(token, _adminAccess);  }
function verifyAdminRefresh(token)  { return jwt.verify(token, _adminRefresh); }

module.exports = {
  signAccess, signRefresh, verifyAccess, verifyRefresh,
  signAdminAccess, signAdminRefresh, verifyAdminAccess, verifyAdminRefresh,
};
