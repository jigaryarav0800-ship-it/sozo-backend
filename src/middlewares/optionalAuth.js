const { tryAuthenticate } = require('./auth');

module.exports = async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    req.user = await tryAuthenticate(header.slice(7));
  }
  next();
};
