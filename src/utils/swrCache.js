class SwrCache {
  constructor({ maxEntries = 1000 } = {}) {
    this.max = maxEntries;
    this._map = new Map();
    this._inflight = new Map();
  }

  _evict() {
    while (this._map.size >= this.max) {
      this._map.delete(this._map.keys().next().value);
    }
  }

  _store(key, data, freshMs, staleMs) {
    this._evict();
    const now = Date.now();
    this._map.set(key, {
      data,
      freshUntil: now + freshMs,
      staleUntil: now + freshMs + (staleMs || 0),
      refreshing: false,
    });
  }

  async fetch(key, freshMs, staleMs, fetcher) {
    const now = Date.now();
    const entry = this._map.get(key);

    if (entry && now < entry.freshUntil) return entry.data;

    if (entry && now < entry.staleUntil) {
      if (!entry.refreshing) {
        entry.refreshing = true;
        Promise.resolve()
          .then(fetcher)
          .then(data => this._store(key, data, freshMs, staleMs))
          .catch(() => { entry.refreshing = false; });
      }
      return entry.data;
    }

    if (this._inflight.has(key)) return this._inflight.get(key);
    const p = Promise.resolve()
      .then(fetcher)
      .then(data => { this._store(key, data, freshMs, staleMs); this._inflight.delete(key); return data; })
      .catch(err => { this._inflight.delete(key); throw err; });
    this._inflight.set(key, p);
    return p;
  }

  get(key) {
    const e = this._map.get(key);
    if (!e) return null;
    if (Date.now() >= e.staleUntil) { this._map.delete(key); return null; }
    return e.data;
  }

  set(key, data, freshMs, staleMs = 0) {
    this._store(key, data, freshMs, staleMs);
  }

  delete(key) { this._map.delete(key); }

  sweep() {
    const now = Date.now();
    for (const [k, e] of this._map) if (now >= e.staleUntil) this._map.delete(k);
  }

  startSweepTimer(intervalMs = 5 * 60 * 1000) {
    setInterval(() => this.sweep(), intervalMs).unref?.();
  }
}

module.exports = { SwrCache };
