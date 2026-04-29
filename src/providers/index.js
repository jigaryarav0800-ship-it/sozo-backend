const asilmedia = require('./asilmedia');

const _providers = {
    asilmedia,
    // idub: require('./idub'),
};

const _meta = {
    asilmedia: {
        id:          'asilmedia',
        name:        'AsilMedia',
        image:       'https://yt3.googleusercontent.com/-RIlt8gzCSWUh-bRzUGqWJIioEAl5BygNWNGp6Q-f18avpxgWufo9JLcGRA1WSi6XF_3MxmnPQ=s900-c-k-c0x00ffffff-no-rj',
        url:         'https://asilmedia.org',
        description: "O'zbek tilidagi kino va seriallar platformasi",
    },
    // idub: {
    //     id:          'idub',
    //     name:        'iDub',
    //     image:       null,
    //     url:         'https://idub.uz',
    //     description: null,
    // },
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
    for (const [name, provider] of Object.entries(_providers)) {
        if (provider.domains?.some(d => contentUrl.includes(d))) return name;
    }
    throw Object.assign(
        new Error(`Cannot detect provider from URL: ${contentUrl}`),
        { status: 400 }
    );
}

function listProviders() {
    return Object.keys(_providers).map(id => {
        const p = _providers[id];
        const m = _meta[id] ?? {};
        return {
            id,
            name:        m.name        ?? id,
            image:       m.image       ?? null,
            url:         m.url         ?? null,
            description: m.description ?? null,
            domains:     p.domains     ?? [],
        };
    });
}

function normalizeDetail(raw, providerName) {
    const isSerial = Boolean(raw.isSerial ?? (raw.episodes?.length > 0));
    return {
        provider:    raw.provider    ?? providerName,
        contentId:   raw.contentId   ?? null,
        contentUrl:  raw.contentUrl  ?? raw.url ?? null,
        title:       raw.title       ?? '',
        description: raw.description ?? null,
        thumbnail:   raw.thumbnail   ?? null,
        year:        raw.year        ?? null,
        duration:    raw.duration    ?? null,
        country:     raw.country     ?? null,
        director:    raw.director    ?? null,
        genres:      raw.genres      ?? [],
        cast:        raw.cast        ?? [],
        likes:       raw.likes       ?? 0,
        dislikes:    raw.dislikes    ?? 0,
        isSerial,
        ...(isSerial  ? { episodes:     raw.episodes     ?? [] } : {}),
        ...(!isSerial ? { videoSources: raw.videoSources ?? [] } : {}),
        playerSrc:   raw.playerSrc   ?? null,
        screenshots: raw.screenshots ?? [],
        related:     raw.related     ?? [],
    };
}

module.exports = { getProvider, detectProvider, listProviders, normalizeDetail };
