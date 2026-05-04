const { verifyAccess } = require('../utils/jwt');
const User = require('../models/User');

let firebase = null;
try { firebase = require('../config/firebase'); } catch {  }

async function tryAuthenticate(token) {
  if (!token) return null;

  try {
    const decoded = verifyAccess(token);
    const user = await User.findById(decoded.id);
    if (user) return user;
  } catch {  }

  if (!firebase) return null;
  try {
    const decoded = await firebase.auth().verifyIdToken(token);
    const { uid, email, name, picture } = decoded;

    let user = await User.findOne({ firebaseUid: uid });
    if (!user && email) user = await User.findOne({ email });

    if (!user) {
      const base = (name || email?.split('@')[0] || uid)
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .slice(0, 20);
      let username = base;
      let i = 1;
      while (await User.findOne({ username })) username = `${base}_${i++}`;

      const resolvedEmail = email || `${uid}@firebase.noemail`;

      user = await User.create({
        username,
        email:        resolvedEmail,
        displayName:  name    || null,
        password:     null,
        photoURL:     picture || null,
        firebaseUid:  uid,
        authProvider: 'firebase',
      });
    } else if (!user.firebaseUid) {
      user.firebaseUid = uid;
      if (picture && !user.photoURL)    user.photoURL    = picture;
      if (name    && !user.displayName) user.displayName = name;
      await user.save();
    }

    return user;
  } catch {
    return null;
  }
}

async function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization header kerak' });
  }
  const user = await tryAuthenticate(header.slice(7));
  if (!user) return res.status(401).json({ message: 'Token noto\'g\'ri yoki muddati o\'tgan' });
  req.user = user;
  next();
}

module.exports = auth;
module.exports.tryAuthenticate = tryAuthenticate;
