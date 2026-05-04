const axios = require('axios');
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 8 });
httpsAgent.setMaxListeners(0);

const http = axios.create({
    timeout: 15_000,
    httpsAgent,
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8' },
});

function unpackPacker(packed) {
    if (!packed) return null;

    const m = packed.match(/}\s*\(\s*['"]([\s\S]+?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"]([\s\S]+?)['"]\.split\(['"]\|['"]\)/);
    if (!m) return null;

    let payload = m[1];
    const radix = parseInt(m[2], 10);
    const count = parseInt(m[3], 10);
    const symtab = m[4].split('|');

    for (let i = count - 1; i >= 0; i--) {
        const sym = symtab[i];
        if (!sym) continue;
        const token = i.toString(radix);
        payload = payload.replace(new RegExp('\\b' + token + '\\b', 'g'), sym);
    }
    return payload;
}

function findPackerBlock(html) {
    if (!html) return null;
    const m = html.match(/eval\(function\(p,a,c,k,e,d?\)[\s\S]+?\.split\([^)]+\)[\s\S]*?\)\s*\)/);
    return m ? m[0] : null;
}

async function extractMixDrop(embedUrl, referer = '') {
    const res = await http.get(embedUrl, {
        headers: {
            'User-Agent': UA,
            'Referer': referer || new URL(embedUrl).origin + '/',
        },
        validateStatus: () => true,
    });
    if (res.status !== 200 || typeof res.data !== 'string') {
        throw Object.assign(new Error(`mixdrop: ${res.status}`), { status: 502 });
    }

    const packer = findPackerBlock(res.data);
    if (!packer) throw Object.assign(new Error('mixdrop: packed block not found'), { status: 502 });

    const unpacked = unpackPacker(packer);
    if (!unpacked) throw Object.assign(new Error('mixdrop: could not unpack'), { status: 502 });

    const wurlMatch = unpacked.match(/MDCore\.wurl\s*=\s*"([^"]+)"/);
    const posterMatch = unpacked.match(/MDCore\.poster\s*=\s*"([^"]+)"/);

    if (!wurlMatch) throw Object.assign(new Error('mixdrop: wurl not in unpacked payload'), { status: 502 });

    const protoUrl = u => u?.startsWith('//') ? `https:${u}` : u;

    return {
        host:     'mixdrop',
        videoUrl: protoUrl(wurlMatch[1]),
        type:     /\.m3u8/.test(wurlMatch[1]) ? 'hls' : 'mp4',
        poster:   protoUrl(posterMatch?.[1] || null),
        headers:  { Referer: new URL(embedUrl).origin + '/', 'User-Agent': UA },
    };
}

async function extractStreamWish(embedUrl, referer = '') {
    const origin = new URL(embedUrl).origin;
    const res = await http.get(embedUrl, {
        headers: {
            'User-Agent': UA,
            'Referer': referer || origin + '/',
        },
        validateStatus: () => true,
    });
    if (res.status !== 200 || typeof res.data !== 'string') {
        throw Object.assign(new Error(`streamwish: ${res.status}`), { status: 502 });
    }

    let body = res.data;
    let unpackedFromInline = null;

    const packer = findPackerBlock(body);
    if (packer) {
        unpackedFromInline = unpackPacker(packer);
    }

    const findFile = (text) => {
        if (!text) return null;
        const m = text.match(/file\s*:\s*"([^"]+\.m3u8[^"]*)"/) || text.match(/file\s*:\s*"([^"]+\.mp4[^"]*)"/);
        return m ? m[1] : null;
    };

    let fileUrl = findFile(unpackedFromInline) || findFile(body);

    if (!fileUrl) {
        const slugMatch = embedUrl.match(/\/(?:e|d|embed-)\/([A-Za-z0-9]+)/);
        const fileCode = slugMatch ? slugMatch[1] : null;
        if (!fileCode) {
            throw Object.assign(new Error('streamwish: no file URL and no slug'), { status: 502 });
        }
        const form = new URLSearchParams({ op: 'embed', file_code: fileCode, auto: '1', referer: '' });
        const post = await http.post(`${origin}/dl`, form.toString(), {
            headers: {
                'User-Agent':   UA,
                'Referer':      embedUrl,
                'Origin':       origin,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            validateStatus: () => true,
        });
        if (post.status !== 200 || typeof post.data !== 'string') {
            throw Object.assign(new Error(`streamwish: /dl ${post.status}`), { status: 502 });
        }
        let postBody = post.data;
        const postPacker = findPackerBlock(postBody);
        if (postPacker) {
            const u = unpackPacker(postPacker);
            if (u) postBody = u;
        }
        fileUrl = findFile(postBody);
        if (!fileUrl) {
            throw Object.assign(new Error('streamwish: file URL still not found after /dl'), { status: 502 });
        }
    }

    return {
        host:     'streamwish',
        videoUrl: fileUrl,
        type:     /\.m3u8/.test(fileUrl) ? 'hls' : 'mp4',
        headers:  { Referer: origin + '/', 'User-Agent': UA },
    };
}

async function extractDoodStream(embedUrl, referer = '') {
    const origin = new URL(embedUrl).origin;
    const res = await http.get(embedUrl, {
        headers: { 'User-Agent': UA, 'Referer': referer || origin + '/' },
        validateStatus: () => true,
    });
    if (res.status !== 200 || typeof res.data !== 'string') {
        throw Object.assign(new Error(`dood: ${res.status}`), { status: 502 });
    }

    const md5Match = res.data.match(/\/pass_md5\/[^'"]+/);
    if (!md5Match) throw Object.assign(new Error('dood: pass_md5 not found'), { status: 502 });
    const md5Url = origin + md5Match[0];

    const md5Res = await http.get(md5Url, {
        headers: { 'User-Agent': UA, 'Referer': embedUrl },
        validateStatus: () => true,
    });
    if (md5Res.status !== 200 || typeof md5Res.data !== 'string') {
        throw Object.assign(new Error(`dood: pass_md5 ${md5Res.status}`), { status: 502 });
    }

    const token = md5Url.split('/').pop();
    const rand = Array.from({ length: 10 }, () =>
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62))
    ).join('');
    const trueUrl = `${md5Res.data.trim()}${rand}?token=${token}`;

    return {
        host:     'doodstream',
        videoUrl: trueUrl,
        type:     'mp4',
        headers:  { Referer: origin + '/', 'User-Agent': UA },
    };
}

// ─── VOE.sx ────────────────────────────────────────────────────────────────
//
// VOE renders a redirect HTML that points to a hash-encoded URL. The unpacked
// payload contains a `'hls': '...m3u8'` field.
async function extractVoe(embedUrl, referer = '') {
    let url = embedUrl;
    let res = await http.get(url, {
        headers: { 'User-Agent': UA, 'Referer': referer || new URL(url).origin + '/' },
        maxRedirects: 5,
        validateStatus: () => true,
    });
    if (res.status !== 200 || typeof res.data !== 'string') {
        throw Object.assign(new Error(`voe: ${res.status}`), { status: 502 });
    }
    let body = res.data;

    // Step 1: VOE may serve a redirect "window.location" to the actual embed
    // page. Follow it.
    const redirectMatch = body.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
    if (redirectMatch) {
        url = redirectMatch[1];
        res = await http.get(url, {
            headers: { 'User-Agent': UA, 'Referer': embedUrl },
            validateStatus: () => true,
        });
        body = res.data;
    }

    // Step 2: extract `'hls': '...m3u8'` (sometimes base64-encoded,
    // sometimes plaintext after rot13 + reverse).
    const hlsPlain = body.match(/['"]hls['"]\s*:\s*['"]([^'"]+)['"]/);
    if (hlsPlain) {
        return {
            host:     'voe',
            videoUrl: hlsPlain[1],
            type:     'hls',
            headers:  { Referer: new URL(url).origin + '/', 'User-Agent': UA },
        };
    }
    throw Object.assign(new Error('voe: hls source not found'), { status: 502 });
}

const HOST_MATCHERS = [

    { test: /(?:m1xdrop|mixdrop|mxdrop)\.[a-z]+\b/i,                  host: 'mixdrop',     extractor: extractMixDrop },
    { test: /streamhls\.|vidhide|vidsp\.|luluvdo|streamwish/i,        host: 'streamwish',  extractor: extractStreamWish },
    { test: /\bdood\.|ds2play\./i,                                    host: 'doodstream',  extractor: extractDoodStream },
    { test: /voe\.|voe-?un\.|voecdn\./i,                              host: 'voe',         extractor: extractVoe },
];

function findExtractor(url) {
    for (const m of HOST_MATCHERS) {
        if (m.test.test(url)) return m;
    }
    return null;
}

async function extract(url, referer = '') {
    const m = findExtractor(url);
    if (!m) {
        const err = new Error(`No extractor for ${url}`);
        err.status = 501;
        err.host = (() => { try { return new URL(url).hostname; } catch { return null; } })();
        throw err;
    }
    return m.extractor(url, referer);
}

module.exports = {
    extract,
    findExtractor,
    extractMixDrop,
    extractStreamWish,
    extractDoodStream,
    extractVoe,
    unpackPacker,
};
