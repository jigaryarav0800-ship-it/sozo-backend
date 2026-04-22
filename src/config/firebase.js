const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccount.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
