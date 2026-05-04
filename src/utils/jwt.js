const jwt = require('jsonwebtoken');

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  console.warn('[auth] JWT_ACCESS_SECRET / JWT_REFRESH_SECRET env o\'rnatilmagan — production da xavfli!');
}

const _access  = ACCESS_SECRET  || 'fallback_access_dev_only';
const _refresh = REFRESH_SECRET || 'fallback_refresh_dev_only';

function signAccess(payload)  { return jwt.sign(payload, _access,  { expiresIn: '15m' }); }
function signRefresh(payload) { return jwt.sign(payload, _refresh, { expiresIn: '7d'  }); }
function verifyAccess(token)  { return jwt.verify(token, _access);  }
function verifyRefresh(token) { return jwt.verify(token, _refresh); }

module.exports = { signAccess, signRefresh, verifyAccess, verifyRefresh };
