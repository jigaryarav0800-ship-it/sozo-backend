const asilmedia = require('./asilmedia');

// Register providers here. Adding a new provider = one line.
const _providers = {
  asilmedia,
  // uzmovi: require('./uzmovi'),
  // idub:   require('./idub'),
};

function getProvider(name) {
  const p = _providers[name];
  if (!p) {
    throw Object.assign(
      new Error(`Unknown provider "${name}". Valid: ${Object.keys(_providers).join(', ')}`),
      { status: 400 }
    );
  }
  return p;
}

function detectProvider(contentUrl) {
  if (!contentUrl) throw Object.assign(new Error('contentUrl is required'), { status: 400 });
  if (contentUrl.includes('asilmedia.org')) return 'asilmedia';
  // if (contentUrl.includes('uzmovi.uz'))    return 'uzmovi';
  // if (contentUrl.includes('idub.tv'))      return 'idub';
  throw Object.assign(
    new Error(`Cannot detect provider from URL: ${contentUrl}`),
    { status: 400 }
  );
}

function listProviders() {
  return Object.keys(_providers);
}

module.exports = { getProvider, detectProvider, listProviders };
