const crypto = require('crypto');

const SECRET = process.env.MEDIA_SECRET || 'soplay_media_dev_only_change_in_prod';
const KEY    = crypto.createHash('sha256').update(SECRET).digest();
const ALGO   = 'aes-256-gcm';
const TAG_LEN = 16;
const IV_LEN  = 12;
const PREFIX = 'k1.';

function encode(payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64url');
}

function decode(token) {
  if (!token || typeof token !== 'string') {
    throw Object.assign(new Error('Invalid media ref'), { status: 400 });
  }
  if (!token.startsWith(PREFIX)) {
    throw Object.assign(new Error('Unsupported media ref version'), { status: 400 });
  }
  let buf;
  try {
    buf = Buffer.from(token.slice(PREFIX.length), 'base64url');
  } catch {
    throw Object.assign(new Error('Malformed media ref'), { status: 400 });
  }
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw Object.assign(new Error('Malformed media ref'), { status: 400 });
  }
  const iv  = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct  = buf.subarray(IV_LEN + TAG_LEN);
  try {
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid or tampered media ref'), { status: 400 });
  }
}

module.exports = { encode, decode };
