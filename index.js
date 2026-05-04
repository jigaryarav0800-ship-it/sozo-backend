require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');

const connectDB = require('./src/config/db');
const swaggerSpec = require('./src/config/swagger');
const { loadShed } = require('./src/middlewares/loadShed');

const authRoutes    = require('./src/routes/auth');
const contentRoutes = require('./src/routes/content');
const commentRoutes = require('./src/routes/comments');
const shortsRoutes  = require('./src/routes/shorts');
const adminRoutes   = require('./src/routes/admin/index');

const app = express();

app.use(loadShed({ softMs: 200, hardMs: 500 }));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(morgan('dev'));

const CACHE_RULES = [
  { test: /^\/api\/contents\/home$/,       maxAge: 300, swr: 600 },
  { test: /^\/api\/contents\/latest$/,     maxAge: 180, swr: 600 },
  { test: /^\/api\/contents\/category\//,  maxAge: 600, swr: 1800 },
  { test: /^\/api\/contents\/genre\//,     maxAge: 600, swr: 1800 },
  { test: /^\/api\/contents\/year\//,      maxAge: 1800, swr: 3600 },
  { test: /^\/api\/contents\/country\//,   maxAge: 1800, swr: 3600 },
  { test: /^\/api\/contents\/categories$/, maxAge: 3600, swr: 86400 },
  { test: /^\/api\/contents\/genres$/,     maxAge: 3600, swr: 86400 },
  { test: /^\/api\/contents\/providers$/,  maxAge: 3600, swr: 86400 },
  { test: /^\/api\/contents\/detail$/,     maxAge: 600, swr: 1800 },
  { test: /^\/api\/contents\/episodes$/,   maxAge: 300, swr: 900 },
  { test: /^\/api\/contents\/search$/,     maxAge: 60, swr: 300 },
];
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  for (const rule of CACHE_RULES) {
    if (rule.test.test(req.path)) {
      res.setHeader('Cache-Control', `public, max-age=${rule.maxAge}, stale-while-revalidate=${rule.swr}`);
      break;
    }
  }
  next();
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/auth',     authRoutes);
app.use('/api/contents', contentRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/shorts',   shortsRoutes);
app.use('/api/admin',    adminRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {

  if (res.headersSent || res.locals?.timedOut) {
    return next(err);
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || '';
    const friendly = {
      email:       'Email already in use',
      username:    'Username already taken',
      firebaseUid: 'Google account already linked to another user',
    };
    return res.status(409).json({ message: friendly[field] || 'An account with these details already exists' });
  }
  const status = err.status || 500;
  res.status(status).json({ message: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server:  http://localhost:${PORT}`);
    console.log(`Swagger: http://localhost:${PORT}/api-docs`);
  });
}).catch((err) => {
  console.error('Startup error:', err);
  process.exit(1);
});
