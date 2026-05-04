const _buckets = new Map();
const MAX_BUCKETS = 50_000;

function takeToken(key, capacity, refillPerSec) {
  const now = Date.now();
  let b = _buckets.get(key);
  if (!b) {
    if (_buckets.size >= MAX_BUCKETS) _buckets.delete(_buckets.keys().next().value);
    b = { tokens: capacity, last: now };
    _buckets.set(key, b);
  }
  const elapsedSec = (now - b.last) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSec);
  b.last = now;
  if (b.tokens < 1) {
    const waitMs = Math.ceil(((1 - b.tokens) / refillPerSec) * 1000);
    return { allowed: false, retryAfterMs: waitMs };
  }
  b.tokens -= 1;
  return { allowed: true };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _buckets) {
    if (now - v.last > 30 * 60 * 1000) _buckets.delete(k);
  }
}, 5 * 60 * 1000).unref();

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function rateLimit({ capacity, refillPerSec, name = 'default', keyBy = 'ip' }) {
  return (req, res, next) => {
    const userId = req.user?._id || req.user?.id;
    const key = keyBy === 'user' && userId
      ? `${name}:u:${userId}`
      : `${name}:ip:${clientIp(req)}`;
    const r = takeToken(key, capacity, refillPerSec);
    if (!r.allowed) {
      res.set('Retry-After', Math.ceil(r.retryAfterMs / 1000));
      return res.status(429).json({ message: "Juda ko'p so'rov, biroz keyinroq urinib ko'ring" });
    }
    next();
  };
}

function timeout(ms) {
  return (req, res, next) => {

    res.locals.timedOut = false;

    const origJson = res.json.bind(res);
    const origSend = res.send.bind(res);
    const origEnd  = res.end.bind(res);

    const wrap = (orig) => (...args) => {
      if (res.locals.timedOut || res.headersSent) return res;
      return orig(...args);
    };
    res.json = wrap(origJson);
    res.send = wrap(origSend);
    res.end  = wrap(origEnd);

    const t = setTimeout(() => {
      if (res.headersSent) return;
      res.locals.timedOut = true;
      res.statusCode = 504;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      origEnd(JSON.stringify({ message: "Upstream so'rov juda uzoq davom etdi, qaytadan urinib ko'ring" }));
    }, ms);
    t.unref?.();
    res.on('finish', () => clearTimeout(t));
    res.on('close',  () => clearTimeout(t));
    next();
  };
}

module.exports = { rateLimit, timeout };
