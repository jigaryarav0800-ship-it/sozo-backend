

const SAMPLE_MS = 500;

let lag = 0;
let lastTick = Date.now();

setInterval(() => {
  const now = Date.now();
  lag = Math.max(0, now - lastTick - SAMPLE_MS);
  lastTick = now;
}, SAMPLE_MS).unref?.();

function getLagMs() { return lag; }

function loadShed({ softMs = 200, hardMs = 500 } = {}) {
  return (req, res, next) => {
    const l = lag;
    if (l <= softMs) return next();

    const p = Math.min(1, (l - softMs) / Math.max(1, hardMs - softMs));
    if (Math.random() < p) {
      res.set('Retry-After', '3');
      return res.status(503).json({
        message: 'Server hozir bandlik darajasida, bir-ikki soniyadan keyin urinib ko\'ring',
      });
    }
    next();
  };
}

module.exports = { loadShed, getLagMs };
