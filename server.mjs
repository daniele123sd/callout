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
import { featureFlags } from './server/featureFlags.mjs';
import { analyticsDataConfigured, getAnalyticsDashboard } from './server/analytics.mjs';
import { adsenseOAuthConfigured, completeAdsenseAuthorization, createAdsenseAuthorizationUrl, getAdsenseDashboard } from './server/adsense.mjs';
import {
  ACCESS_COOKIE, REFRESH_COOKIE, clearAuthCookies, comparePassword, createPasswordResetToken,
  hashPassword, optionalAuth, requireAuth, schemas, setAuthCookies, signAccessToken, signRefreshToken,
  validate, verifyRefreshToken
} from './server/security.mjs';
import {
  acceptFriendRequest, canAccessPost, connectDatabase, createComment, createFriendRequest, createGuild, createGuildMessage, createGuildPost, createMessage, createPost, createReport, createUser, databaseMode, deletePost,
  findUserByEmail, findUserByGoogleId, findUserById, getGuild, getPublicProfile, joinGuildByInvite, listComments, listFriends, listGuildAudit, listGuildMembers, listGuildMessages, listGuildPosts, listGuilds, listLeaderboard, listMessages,
  deleteNotificationMute, listDrafts, listNotificationMutes, listNotifications, listPosts, listSavedPostIds, markNotificationsRead, publicUser, recordPostView, searchCallout, setNotificationMute,
  toggleGuildMembership, toggleSavedPost, updateGuild, updateGuildMember, updateGuildRole, updatePost, updateUser, voteOnComment, voteOnPoll, voteOnPost
} from './server/repository.mjs';

dotenv.config();

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const app = express();
const messageStreams = new Map();
const requireFeature = name => (_req, res, next) => featureFlags[name] ? next() : res.status(404).json({ error: 'This feature is not enabled yet.' });
const adminEmails = () => new Set(String(process.env.ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
const isAdminAccount = user => Boolean(user?.email && adminEmails().has(String(user.email).toLowerCase()));
const accountPayload = user => ({ ...publicUser(user), isAdmin: isAdminAccount(user) });

async function requireAdmin(req, res, next) {
  try {
    const user = await findUserById(req.userId);
    if (!isAdminAccount(user)) return res.status(403).json({ error: 'Analytics dashboard access is restricted.' });
    req.adminUser = user;
    next();
  } catch (error) { next(error); }
}

function pushMessageUpdate(userId) {
  for (const response of messageStreams.get(String(userId)) || []) response.write(`event: messages\ndata: ${JSON.stringify({ updated: true })}\n\n`);
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  frameguard: process.env.NODE_ENV === 'production' ? { action: 'sameorigin' } : false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://pagead2.googlesyndication.com', 'https://www.googletagmanager.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https://accounts.google.com', 'https://www.google-analytics.com', 'https://analytics.google.com', 'https://region1.google-analytics.com'],
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
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: false, limit: '12mb' }));
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
  res.status(healthy ? 200 : 503).json({ ok: healthy, database: databaseMode(), googleOAuth: googleConfigured, analyticsTracking: /^G-[A-Z0-9]+$/i.test(process.env.GA_MEASUREMENT_ID || ''), analyticsDashboard: analyticsDataConfigured(), ads: /^ca-pub-\d{10,}$/.test(process.env.ADSENSE_CLIENT_ID || '') });
});
app.get('/api/features', (_req, res) => res.json({ features: featureFlags }));

app.post('/api/auth/signup', authLimiter, validate(schemas.signup), async (req, res, next) => {
  try {
    if (await findUserByEmail(req.body.email)) return res.status(409).json({ error: 'An account with that email already exists.' });
    const user = await createUser({ email: req.body.email, displayName: req.body.displayName, password: await hashPassword(req.body.password) });
    await establishSession(res, user);
    res.status(201).json({ user: accountPayload(user) });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', authLimiter, validate(schemas.login), async (req, res, next) => {
  try {
    const user = await findUserByEmail(req.body.email, true);
    if (!user?.password || !(await comparePassword(req.body.password, user.password))) return res.status(401).json({ error: 'Invalid email or password.' });
    await establishSession(res, user);
    res.json({ user: accountPayload(user) });
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
    res.json({ user: accountPayload(user) });
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
  res.json({ user: accountPayload(user) });
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
  res.json({ user: accountPayload(user) });
});
app.patch('/api/profile', requireAuth, validate(schemas.profile), async (req, res, next) => {
  try { res.json({ user: accountPayload(await updateUser(req.userId, req.body)) }); } catch (error) { next(error); }
});

app.get('/api/posts', optionalAuth, async (req, res, next) => {
  try { res.json({ posts: await listPosts(req.userId) }); } catch (error) { next(error); }
});
app.get('/api/posts/trending', optionalAuth, async (req, res, next) => {
  try { res.json({ posts: await listPosts(req.userId, { trending: true }) }); } catch (error) { next(error); }
});
app.get('/api/drafts', requireFeature('richComposer'), requireAuth, async (req, res, next) => {
  try { res.json({ drafts: await listDrafts(req.userId) }); } catch (error) { next(error); }
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
app.post('/api/posts/:id/vote', requireAuth, validate(schemas.vote), async (req, res, next) => {
  try {
    if (!(await canAccessPost(req.params.id, req.userId))) return res.status(403).json({ error: 'This post is not available to you.' });
    const post = await voteOnPost(req.params.id, req.userId, req.body.value);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (post.forbidden) return res.status(400).json({ error: 'You cannot rank your own take.' });
    res.json({ post });
  } catch (error) { next(error); }
});
app.post('/api/posts/:id/poll-vote', requireFeature('richComposer'), requireAuth, validate(schemas.pollVote), async (req, res, next) => {
  try {
    if (!(await canAccessPost(req.params.id, req.userId))) return res.status(403).json({ error: 'This poll is not available to you.' });
    const post = await voteOnPoll(req.params.id, req.userId, req.body.optionId);
    if (!post) return res.status(404).json({ error: 'Poll or option not found, or the poll has closed.' });
    res.json({ post });
  } catch (error) { next(error); }
});
app.post('/api/posts/:id/view', optionalAuth, async (req, res, next) => {
  try {
    if (!(await canAccessPost(req.params.id, req.userId))) return res.status(403).json({ error: 'This post is not available to you.' });
    const post = await recordPostView(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    res.status(204).end();
  } catch (error) { next(error); }
});
app.get('/api/posts/:id/comments', optionalAuth, async (req, res, next) => {
  try { if (!(await canAccessPost(req.params.id, req.userId))) return res.status(403).json({ error: 'This discussion is members-only.' }); res.json({ comments: await listComments(req.params.id, req.userId) }); } catch (error) { next(error); }
});

app.post('/api/comments', requireAuth, validate(schemas.comment), async (req, res, next) => {
  try {
    if (!(await canAccessPost(req.body.postId, req.userId))) return res.status(403).json({ error: 'This discussion is members-only.' });
    const comment = await createComment(req.body.postId, req.userId, req.body);
    if (!comment) return res.status(404).json({ error: 'Post or parent comment not found.' });
    res.status(201).json({ comment });
  } catch (error) { next(error); }
});
app.post('/api/comments/:id/vote', requireAuth, async (req, res, next) => {
  try {
    const comment = await voteOnComment(req.params.id, req.userId);
    if (!comment) return res.status(404).json({ error: 'Comment not found.' });
    res.json({ comment });
  } catch (error) { next(error); }
});

app.get('/api/saved', requireAuth, async (req, res, next) => {
  try { res.json({ savedPostIds: await listSavedPostIds(req.userId) }); } catch (error) { next(error); }
});
app.post('/api/posts/:id/save', requireAuth, async (req, res, next) => {
  try {
    if (!(await canAccessPost(req.params.id, req.userId))) return res.status(403).json({ error: 'This post is not available to you.' });
    const saved = await toggleSavedPost(req.userId, req.params.id);
    if (!saved) return res.status(404).json({ error: 'Post not found.' });
    res.json(saved);
  } catch (error) { next(error); }
});

app.get('/api/guilds', optionalAuth, async (req, res, next) => {
  try { res.json({ guilds: await listGuilds(req.userId) }); } catch (error) { next(error); }
});
app.post('/api/guilds', requireAuth, validate(schemas.guild), async (req, res, next) => {
  try { res.status(201).json({ guild: await createGuild(req.userId, req.body) }); } catch (error) { next(error); }
});
app.get('/api/guilds/:id', optionalAuth, async (req, res, next) => {
  try { const guild = await getGuild(req.params.id, req.userId); if (!guild) return res.status(404).json({ error: 'Guild not found.' }); res.json({ guild }); } catch (error) { next(error); }
});
app.patch('/api/guilds/:id', requireAuth, validate(schemas.guildSettings), async (req, res, next) => {
  try { const guild = await updateGuild(req.params.id, req.userId, req.body); if (!guild) return res.status(403).json({ error: 'Only the guild creator can change these settings.' }); res.json({ guild }); } catch (error) { next(error); }
});
app.get('/api/guilds/:id/posts', requireAuth, async (req, res, next) => {
  try { const posts = await listGuildPosts(req.params.id, req.userId); if (!posts) return res.status(403).json({ error: 'Join this guild to view its feed.' }); res.json({ posts }); } catch (error) { next(error); }
});
app.post('/api/guilds/:id/posts', requireAuth, validate(schemas.post), async (req, res, next) => {
  try { const post = await createGuildPost(req.params.id, req.userId, req.body); if (!post) return res.status(403).json({ error: 'Join this guild to post.' }); res.status(201).json({ post }); } catch (error) { next(error); }
});
app.get('/api/guilds/:id/messages', requireAuth, async (req, res, next) => {
  try { const messages = await listGuildMessages(req.params.id, req.userId); if (!messages) return res.status(403).json({ error: 'Join this guild to open its group chat.' }); res.json({ messages }); } catch (error) { next(error); }
});
app.post('/api/guilds/:id/messages', requireAuth, validate(schemas.guildMessage), async (req, res, next) => {
  try { const message = await createGuildMessage(req.params.id, req.userId, req.body.text); if (!message) return res.status(403).json({ error: 'Join this guild to use its group chat.' }); res.status(201).json({ message }); } catch (error) { next(error); }
});
app.post('/api/guilds/:id/membership', requireAuth, async (req, res, next) => {
  try {
    const result = await toggleGuildMembership(req.userId, req.params.id);
    if (!result) return res.status(404).json({ error: 'Guild not found.' });
    if (result.owner) return res.status(409).json({ error: 'Guild owners cannot leave their own guild.' });
    res.json(result);
  } catch (error) { next(error); }
});
app.post('/api/guilds/join/invite', requireFeature('creatorGuilds'), requireAuth, validate(schemas.guildInvite), async (req, res, next) => {
  try { const guild = await joinGuildByInvite(req.userId, req.body.inviteCode); if (!guild) return res.status(404).json({ error: 'Invite is invalid or expired.' }); res.json({ guild }); } catch (error) { next(error); }
});
app.get('/api/guilds/:id/members', requireFeature('creatorGuilds'), requireAuth, async (req, res, next) => {
  try { const members = await listGuildMembers(req.params.id, req.userId); if (!members) return res.status(403).json({ error: 'Guild membership is required.' }); res.json({ members }); } catch (error) { next(error); }
});
app.patch('/api/guilds/:id/members/:userId', requireFeature('creatorGuilds'), requireAuth, validate(schemas.guildMember), async (req, res, next) => {
  try { const membership = await updateGuildMember(req.params.id, req.userId, req.params.userId, req.body); if (!membership) return res.status(403).json({ error: 'You cannot change this membership.' }); res.json({ membership }); } catch (error) { next(error); }
});
app.patch('/api/guilds/:id/roles/:roleKey', requireFeature('creatorGuilds'), requireAuth, validate(schemas.guildRole), async (req, res, next) => {
  try { const role = await updateGuildRole(req.params.id, req.userId, req.params.roleKey, req.body.permissions); if (!role) return res.status(403).json({ error: 'You cannot change this role.' }); res.json({ role }); } catch (error) { next(error); }
});
app.get('/api/guilds/:id/audit', requireFeature('creatorGuilds'), requireAuth, async (req, res, next) => {
  try { const audit = await listGuildAudit(req.params.id, req.userId); if (!audit) return res.status(403).json({ error: 'Audit access is not permitted.' }); res.json({ audit }); } catch (error) { next(error); }
});

app.get('/api/leaderboard', async (req, res, next) => {
  try { const period = ['weekly', 'monthly', 'all'].includes(req.query.period) ? req.query.period : 'all'; res.json({ users: await listLeaderboard(period) }); } catch (error) { next(error); }
});
app.get('/api/users/:id', optionalAuth, async (req, res, next) => {
  try { const user = await getPublicProfile(req.params.id, req.userId); if (!user) return res.status(404).json({ error: 'User not found.' }); res.json({ user }); } catch (error) { next(error); }
});
app.get('/api/friends', requireAuth, async (req, res, next) => {
  try { res.json({ friendships: await listFriends(req.userId) }); } catch (error) { next(error); }
});
app.post('/api/friends', requireAuth, validate(schemas.friend), async (req, res, next) => {
  try { const friendship = await createFriendRequest(req.userId, req.body.userId); if (!friendship) return res.status(400).json({ error: 'Friend request could not be created.' }); res.status(201).json({ friendship }); } catch (error) { next(error); }
});
app.post('/api/friends/:id/accept', requireAuth, async (req, res, next) => {
  try { const friendship = await acceptFriendRequest(req.params.id, req.userId); if (!friendship) return res.status(404).json({ error: 'Friend request not found.' }); res.json({ friendship }); } catch (error) { next(error); }
});
app.get('/api/search', async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim().slice(0, 80);
    if (query.length < 2) return res.json({ users: [], posts: [], guilds: [] });
    res.json(await searchCallout(query));
  } catch (error) { next(error); }
});

app.get('/api/notifications', requireAuth, async (req, res, next) => {
  try { res.json({ notifications: await listNotifications(req.userId) }); } catch (error) { next(error); }
});
app.post('/api/notifications/read', requireAuth, async (req, res, next) => {
  try { await markNotificationsRead(req.userId); res.status(204).end(); } catch (error) { next(error); }
});
app.get('/api/notifications/mutes', requireFeature('notificationControls'), requireAuth, async (req, res, next) => {
  try { res.json({ mutes: await listNotificationMutes(req.userId) }); } catch (error) { next(error); }
});
app.post('/api/notifications/mutes', requireFeature('notificationControls'), requireAuth, validate(schemas.notificationMute), async (req, res, next) => {
  try { res.status(201).json({ mute: await setNotificationMute(req.userId, req.body) }); } catch (error) { next(error); }
});
app.delete('/api/notifications/mutes/:id', requireFeature('notificationControls'), requireAuth, async (req, res, next) => {
  try { if (!(await deleteNotificationMute(req.userId, req.params.id))) return res.status(404).json({ error: 'Mute rule not found.' }); res.status(204).end(); } catch (error) { next(error); }
});

app.get('/api/analytics/summary', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const days = [7, 28, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 28;
    res.set('Cache-Control', 'private, no-store');
    const [analytics, adsense] = await Promise.all([
      getAnalyticsDashboard(days),
      getAdsenseDashboard(days).catch(error => ({ configured: adsenseOAuthConfigured(), connected: false, error: error.message, rangeDays: days, siteStatus: 'GETTING_READY' }))
    ]);
    res.json({ analytics: { ...analytics, adsense } });
  } catch (error) {
    console.error('Google Analytics report failed:', error.message);
    res.status(502).json({ error: 'Google Analytics data is temporarily unavailable. Verify the property and service-account access.' });
  }
});

app.get('/api/admin/reporting/connect', requireAuth, requireAdmin, (req, res, next) => {
  try { res.redirect(createAdsenseAuthorizationUrl(req.userId)); } catch (error) { next(error); }
});

app.get('/api/admin/reporting/callback', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error));
    await completeAdsenseAuthorization({ code: req.query.code, state: req.query.state, userId: req.userId });
    res.redirect('/#analytics');
  } catch (error) {
    console.error('AdSense authorization failed:', error.message);
    res.redirect('/#analytics');
  }
});

app.get('/api/messages', requireAuth, async (req, res, next) => {
  try { res.json({ messages: await listMessages(req.userId) }); } catch (error) { next(error); }
});
app.get('/api/messages/stream', requireAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  res.flushHeaders(); res.write('event: ready\ndata: {}\n\n');
  const key = String(req.userId); const clients = messageStreams.get(key) || new Set(); clients.add(res); messageStreams.set(key, clients);
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25000);
  req.on('close', () => { clearInterval(heartbeat); clients.delete(res); if (!clients.size) messageStreams.delete(key); });
});
app.post('/api/messages', requireAuth, validate(schemas.message), async (req, res, next) => {
  try {
    const message = await createMessage(req.userId, req.body.recipient, req.body.message);
    if (!message) return res.status(404).json({ error: 'Recipient not found. Use their @username or email.' });
    if (message.forbidden) return res.status(403).json({ error: message.reason });
    pushMessageUpdate(req.userId); pushMessageUpdate(message.recipient?.id);
    res.status(201).json({ message });
  } catch (error) { next(error); }
});

app.get('/vendor/dompurify.min.js', (_req, res) => res.sendFile(path.join(root, 'node_modules', 'dompurify', 'dist', 'purify.min.js')));
app.get('/privacy', (_req, res) => res.sendFile(path.join(root, 'privacy.html')));
app.get('/terms', (_req, res) => res.sendFile(path.join(root, 'terms.html')));
async function renderIndex(_req, res, next) {
  try {
    let template = await readFile(path.join(root, 'index.html'), 'utf8');
    const replacements = {
      'ca-pub-XXXXXXXXXXXXXXXX': /^ca-pub-\d{10,}$/.test(process.env.ADSENSE_CLIENT_ID || '') ? process.env.ADSENSE_CLIENT_ID : '',
      'ADSENSE_HEADER_SLOT': /^\d+$/.test(process.env.ADSENSE_SLOT_HEADER || '') ? process.env.ADSENSE_SLOT_HEADER : '',
      'ADSENSE_SIDEBAR_SLOT': /^\d+$/.test(process.env.ADSENSE_SLOT_SIDEBAR || '') ? process.env.ADSENSE_SLOT_SIDEBAR : '',
      'ADSENSE_RIGHT_RAIL_SLOT': /^\d+$/.test(process.env.ADSENSE_SLOT_RIGHT_RAIL || '') ? process.env.ADSENSE_SLOT_RIGHT_RAIL : '',
      'ADSENSE_IN_FEED_SLOT': /^\d+$/.test(process.env.ADSENSE_SLOT_IN_FEED || '') ? process.env.ADSENSE_SLOT_IN_FEED : '',
      'ADSENSE_FOOTER_SLOT': /^\d+$/.test(process.env.ADSENSE_SLOT_FOOTER || '') ? process.env.ADSENSE_SLOT_FOOTER : '',
      'G-XXXXXXXXXX': /^G-[A-Z0-9]+$/i.test(process.env.GA_MEASUREMENT_ID || '') ? process.env.GA_MEASUREMENT_ID : ''
    };
    for (const [placeholder, value] of Object.entries(replacements)) template = template.replaceAll(placeholder, value);
    res.type('html').send(template);
  } catch (error) { next(error); }
}
app.get(['/', '/index.html'], renderIndex);
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
