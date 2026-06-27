import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import {
  ACCESS_COOKIE, REFRESH_COOKIE, clearAuthCookies, comparePassword, createPasswordResetToken,
  hashPassword, requireAuth, schemas, setAuthCookies, signAccessToken, signRefreshToken,
  validate, verifyRefreshToken
} from './server/security.mjs';
import {
  connectDatabase, createPost, createReport, createUser, databaseMode, deletePost,
  findUserByEmail, findUserByGoogleId, findUserById, publicUser, updatePost, updateUser
} from './server/repository.mjs';

dotenv.config();

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  frameguard: process.env.NODE_ENV === 'production' ? { action: 'sameorigin' } : false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://pagead2.googlesyndication.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https://accounts.google.com'],
      frameSrc: ["'self'", 'https://accounts.google.com', 'https://googleads.g.doubleclick.net', 'https://tpc.googlesyndication.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'", 'https://accounts.google.com'],
      frameAncestors: process.env.NODE_ENV === 'production' ? ["'self'"] : ["'self'", 'http://localhost:*', 'http://127.0.0.1:*', 'vscode-webview:'],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: false, limit: '3mb' }));
app.use(cookieParser());
app.use(passport.initialize());

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again in one minute.' }
});

async function establishSession(res, user) {
  const userId = String(user._id || user.id);
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId);
  await updateUser(userId, { refreshTokenHash: await hashPassword(refreshToken) });
  setAuthCookies(res, accessToken, refreshToken);
}

const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
if (googleConfigured) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || `${process.env.APP_ORIGIN || `http://127.0.0.1:${port}`}/api/auth/google/callback`
  }, async (_accessToken, _refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      if (!email) return done(new Error('Google did not provide an email address'));
      let user = await findUserByGoogleId(profile.id) || await findUserByEmail(email);
      if (!user) user = await createUser({ googleId: profile.id, email, displayName: profile.displayName || email.split('@')[0], avatarUrl: profile.photos?.[0]?.value || '' });
      else if (!user.googleId) user = await updateUser(String(user._id || user.id), { googleId: profile.id, avatarUrl: user.avatarUrl || profile.photos?.[0]?.value || '' });
      done(null, user);
    } catch (error) { done(error); }
  }));
}

app.get('/api/health', (_req, res) => {
  const healthy = process.env.NODE_ENV !== 'production' || databaseMode() === 'mongodb';
  res.status(healthy ? 200 : 503).json({ ok: healthy, database: databaseMode(), googleOAuth: googleConfigured });
});

app.post('/api/auth/signup', authLimiter, validate(schemas.signup), async (req, res, next) => {
  try {
    if (await findUserByEmail(req.body.email)) return res.status(409).json({ error: 'An account with that email already exists.' });
    const user = await createUser({ email: req.body.email, displayName: req.body.displayName, password: await hashPassword(req.body.password) });
    await establishSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', authLimiter, validate(schemas.login), async (req, res, next) => {
  try {
    const user = await findUserByEmail(req.body.email, true);
    if (!user?.password || !(await comparePassword(req.body.password, user.password))) return res.status(401).json({ error: 'Invalid email or password.' });
    await establishSession(res, user);
    res.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

app.post('/api/auth/password-reset/request', authLimiter, validate(schemas.passwordRequest), async (req, res, next) => {
  try {
    const user = await findUserByEmail(req.body.email, true);
    let developmentResetToken;
    if (user) {
      const token = createPasswordResetToken();
      await updateUser(String(user._id || user.id), { passwordResetHash: await hashPassword(token), passwordResetExpiresAt: new Date(Date.now() + 15 * 60 * 1000) });
      if (process.env.NODE_ENV !== 'production') developmentResetToken = token;
    }
    res.json({ message: 'If the account exists, reset instructions have been generated.', ...(developmentResetToken ? { developmentResetToken } : {}) });
  } catch (error) { next(error); }
});

app.post('/api/auth/password-reset/confirm', authLimiter, validate(schemas.passwordReset), async (req, res, next) => {
  try {
    const user = await findUserByEmail(req.body.email, true);
    const valid = user?.passwordResetHash && user.passwordResetExpiresAt && new Date(user.passwordResetExpiresAt) > new Date() && await bcrypt.compare(req.body.token, user.passwordResetHash);
    if (!valid) return res.status(400).json({ error: 'Reset token is invalid or expired.' });
    await updateUser(String(user._id || user.id), { password: await hashPassword(req.body.password), passwordResetHash: '', passwordResetExpiresAt: null });
    res.json({ message: 'Password updated.' });
  } catch (error) { next(error); }
});

app.post('/api/auth/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return res.status(401).json({ error: 'Refresh token missing.' });
  try {
    const payload = verifyRefreshToken(token);
    if (payload.type !== 'refresh') throw new Error('Invalid token type');
    const user = await findUserById(payload.sub, true);
    if (!user?.refreshTokenHash || !(await bcrypt.compare(token, user.refreshTokenHash))) throw new Error('Refresh token revoked');
    await establishSession(res, user);
    res.json({ user: publicUser(user) });
  } catch {
    clearAuthCookies(res);
    res.status(401).json({ error: 'Refresh token is invalid or expired.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (token) {
      try {
        const payload = (await import('jsonwebtoken')).default.decode(token);
        if (payload?.sub) await updateUser(payload.sub, { refreshTokenHash: '' });
      } catch { /* cookie clearing is still sufficient */ }
    }
    clearAuthCookies(res);
    res.status(204).end();
  } catch { clearAuthCookies(res); res.status(204).end(); }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await findUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: publicUser(user) });
});

if (googleConfigured) {
  app.get('/api/auth/google', authLimiter, passport.authenticate('google', { scope: ['profile', 'email'], session: false }));
  app.get('/api/auth/google/callback', authLimiter, passport.authenticate('google', { session: false, failureRedirect: '/#auth?error=google' }), async (req, res, next) => {
    try { await establishSession(res, req.user); res.redirect('/#profile'); } catch (error) { next(error); }
  });
} else {
  app.get('/api/auth/google', (_req, res) => res.status(503).send('Google OAuth is not configured. Add credentials to .env.'));
}

app.get('/api/profile', requireAuth, async (req, res) => {
  const user = await findUserById(req.userId);
  res.json({ user: publicUser(user) });
});
app.patch('/api/profile', requireAuth, validate(schemas.profile), async (req, res, next) => {
  try { res.json({ user: publicUser(await updateUser(req.userId, req.body)) }); } catch (error) { next(error); }
});

app.post('/api/posts', requireAuth, validate(schemas.post), async (req, res, next) => {
  try { res.status(201).json({ post: await createPost(req.userId, req.body) }); } catch (error) { next(error); }
});
app.patch('/api/posts/:id', requireAuth, validate(schemas.post), async (req, res, next) => {
  try {
    const post = await updatePost(req.params.id, req.userId, req.body);
    if (!post) return res.status(404).json({ error: 'Post not found or not owned by you.' });
    res.json({ post });
  } catch (error) { next(error); }
});
app.delete('/api/posts/:id', requireAuth, async (req, res, next) => {
  try {
    const post = await deletePost(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found or not owned by you.' });
    res.status(204).end();
  } catch (error) { next(error); }
});
app.post('/api/posts/:id/reports', requireAuth, validate(schemas.report), async (req, res, next) => {
  try { res.status(201).json({ report: await createReport(req.userId, req.params.id, req.body) }); } catch (error) { next(error); }
});

app.post('/api/comments', requireAuth, validate(schemas.comment), (req, res) => res.status(201).json({ comment: req.body }));
app.post('/api/messages', requireAuth, validate(schemas.message), (req, res) => res.status(202).json({ message: 'Message accepted.', sanitized: req.body }));

app.get('/vendor/dompurify.min.js', (_req, res) => res.sendFile(path.join(root, 'node_modules', 'dompurify', 'dist', 'purify.min.js')));
app.get('/privacy', (_req, res) => res.sendFile(path.join(root, 'privacy.html')));
app.get('/terms', (_req, res) => res.sendFile(path.join(root, 'terms.html')));
app.get('/', async (_req, res, next) => {
  try {
    const template = await readFile(path.join(root, 'index.html'), 'utf8');
    const clientId = /^ca-pub-\d{10,}$/.test(process.env.ADSENSE_CLIENT_ID || '') ? process.env.ADSENSE_CLIENT_ID : 'ca-pub-XXXXXXXXXXXXXXXX';
    res.type('html').send(template.replaceAll('ca-pub-XXXXXXXXXXXXXXXX', clientId));
  } catch (error) { next(error); }
});
app.use(express.static(root, { index: 'index.html', extensions: ['html'] }));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.code === 11000) return res.status(409).json({ error: 'That record already exists.' });
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error.' : error.message });
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    const required = ['DB_URI', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'APP_ORIGIN'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
    if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different.');
    const connected = await connectDatabase();
    if (!connected) throw new Error('Production requires a working MongoDB connection.');
  }

  app.listen(port, () => {
    console.log(`Callout is running at http://localhost:${port} (${databaseMode()} store)`);
    if (process.env.NODE_ENV !== 'production') connectDatabase().catch(error => console.warn(`Database connection failed: ${error.message}`));
  });
}

await startServer();
