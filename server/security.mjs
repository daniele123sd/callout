import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import Joi from 'joi';

export const ACCESS_COOKIE = 'callout_access';
export const REFRESH_COOKIE = 'callout_refresh';
export const BCRYPT_ROUNDS = 12;

const accessSecret = () => process.env.JWT_SECRET || 'development-only-access-secret-change-me';
const refreshSecret = () => process.env.JWT_REFRESH_SECRET || 'development-only-refresh-secret-change-me';

export function sanitizePlainText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

const cleanString = (value, helpers) => {
  const sanitized = sanitizePlainText(value);
  if (!sanitized && value?.trim()) return helpers.error('string.empty');
  return sanitized;
};

const plain = max => Joi.string().max(max).custom(cleanString, 'plain-text sanitizer');
const recordId = Joi.string().pattern(/^(?:[a-f\d]{24}|[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12})$/i);
const optionalBanner = Joi.string().allow('').max(2_800_000).pattern(/^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i);
const mediaUrl = Joi.string().max(8_500_000).pattern(/^(https:\/\/|data:(image\/(png|jpeg|gif|webp)|video\/(mp4|webm));base64,)/i);
const mediaItem = Joi.object({
  type: Joi.string().valid('image', 'video', 'gif').required(),
  url: mediaUrl.required(),
  alt: plain(120).allow(''),
  duration: Joi.number().min(0).max(25).default(0),
  aspectRatio: Joi.number().min(0.1).max(10).default(1)
});
const mediaCollection = Joi.array().max(5).items(mediaItem).custom((items, helpers) => {
  if (!items.length) return items;
  const videos = items.filter(item => item.type === 'video');
  if (videos.some(item => item.aspectRatio < 0.95 || item.aspectRatio > 1.05)) return helpers.message({ custom: 'Short videos must use a square 1:1 aspect ratio.' });
  return items;
}, 'media layout validation');
const externalEmbed = Joi.object({
  platform: Joi.string().valid('x', 'reddit', 'bluesky').required(),
  url: Joi.string().uri({ scheme: ['https'] }).max(2048).required(),
  authorName: plain(120).allow('').default(''),
  authorHandle: plain(120).allow('').default(''),
  authorAvatar: Joi.string().uri({ scheme: ['https'] }).max(2048).allow('').default(''),
  text: plain(1200).allow('').default(''),
  community: plain(120).allow('').default(''),
  mediaUrl: Joi.string().uri({ scheme: ['https'] }).max(2048).allow('').default(''),
  mediaType: Joi.string().valid('', 'image', 'video').allow('').default(''),
  mediaItems: Joi.array().max(4).items(Joi.object({
    type: Joi.string().valid('image', 'video').required(),
    url: Joi.string().uri({ scheme: ['https'] }).max(2048).required(),
    thumbnailUrl: Joi.string().uri({ scheme: ['https'] }).max(2048).allow('').default(''),
    alt: plain(300).allow('').default('')
  })).default([]),
  replyCount: Joi.number().integer().min(0).max(1_000_000_000).default(0),
  repostCount: Joi.number().integer().min(0).max(1_000_000_000).default(0),
  likeCount: Joi.number().integer().min(0).max(1_000_000_000).default(0),
  viewCount: Joi.number().integer().min(0).max(1_000_000_000).default(0),
  sourceCreatedAt: Joi.date().iso().allow(null).default(null),
  fetchedAt: Joi.date().iso().required()
});
const postText = plain(2000).custom((value, helpers) => {
  if (value.includes('#')) return helpers.message({ custom: 'Hashtags are not allowed in post text.' });
  if (/(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|gg|me|tv)(?:\/|\b))/i.test(value)) return helpers.message({ custom: 'Links are not allowed in post text.' });
  return value;
}, 'post content rules');

export const schemas = {
  signup: Joi.object({
    email: Joi.string().email().max(254).lowercase().required(),
    password: Joi.string().min(8).max(128).required(),
    displayName: plain(40).required(),
    ageConfirmed: Joi.boolean().valid(true).required()
  }),
  login: Joi.object({ email: Joi.string().email().max(254).lowercase().required(), password: Joi.string().max(128).required() }),
  passwordRequest: Joi.object({ email: Joi.string().email().max(254).lowercase().required() }),
  passwordReset: Joi.object({ email: Joi.string().email().max(254).lowercase().required(), token: Joi.string().min(32).max(512).required(), password: Joi.string().min(8).max(128).required() }),
  profile: Joi.object({
    displayName: plain(40).required(),
    handle: Joi.string().lowercase().pattern(/^@[a-z0-9_]{3,30}$/).required(),
    bio: plain(1000).allow(''),
    bannerUrl: optionalBanner,
    avatarUrl: optionalBanner,
    themeColor: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/).required(),
    avatarFrame: Joi.string().valid('none', 'spark', 'gold', 'violet', 'flame').default('none'),
    profileEffect: Joi.string().valid('none', 'glow', 'bubbles', 'spotlight', 'confetti').default('none'),
    vibeAura: Joi.string().valid('auto', 'none', 'rookie', 'star', 'legend').default('auto'),
    profileBackground: Joi.string().valid('clean', 'grid', 'waves', 'stars', 'noise').default('clean'),
    profileLayout: Joi.array().min(1).max(6).unique().items(Joi.string().valid('posts', 'about', 'guilds', 'achievements', 'media', 'trophies')).default(['posts', 'about', 'guilds', 'achievements', 'media', 'trophies']),
    showcaseMode: Joi.string().valid('featured', 'popular', 'controversial', 'recent').default('featured'),
    featuredBadges: Joi.array().max(3).unique().items(plain(40)).default([]),
    featuredPosts: Joi.array().max(3).items(recordId).default([]),
    pinnedGuilds: Joi.array().max(5).items(recordId).default([]),
    pronouns: plain(40).allow(''),
    status: Joi.string().valid('online', 'idle', 'dnd', 'invisible').required(),
    socialLinks: Joi.object({
      twitter: plain(2048).allow(''), instagram: plain(2048).allow(''), discord: plain(100).allow(''),
      youtube: plain(2048).allow(''), twitch: plain(2048).allow(''), custom: plain(2048).allow('')
    }).required(),
    preferences: Joi.object({
      theme: Joi.string().valid('light', 'dark', 'system').required(),
      palette: Joi.string().valid('callout', 'midnight', 'mint', 'violet', 'sunset').default('callout'),
      reducedMotion: Joi.boolean().default(false),
      feedDensity: Joi.string().valid('compact', 'comfortable', 'spacious').default('comfortable'),
      voteEffect: Joi.string().valid('pop', 'confetti', 'pulse', 'none').default('pop'),
      notificationSound: Joi.string().valid('callout', 'spark', 'soft', 'none').default('callout'),
      widgetOrder: Joi.array().max(5).unique().items(Joi.string().valid('trending-guilds', 'activity', 'achievements', 'friends', 'topics')).default(['trending-guilds', 'activity', 'achievements']),
      hiddenTopics: Joi.array().max(30).unique().items(plain(40)).default([]),
      notifications: Joi.object({
        likes: Joi.boolean().required(), comments: Joi.boolean().required(), guildInvites: Joi.boolean().required(),
        mentions: Joi.boolean().default(true), follows: Joi.boolean().default(true), guildActivity: Joi.boolean().default(true), directMessages: Joi.boolean().default(true)
      }).required(),
      notificationDelivery: Joi.object({ inApp: Joi.boolean().default(true), push: Joi.boolean().default(false), email: Joi.boolean().default(false) }).default({ inApp: true, push: false, email: false }),
      directMessages: Joi.string().valid('everyone', 'guilds', 'nobody').required(),
      textSize: Joi.string().valid('small', 'medium', 'large').required()
    }).required()
  }),
  post: Joi.object({
    clientRequestId: Joi.string().guid({ version: ['uuidv4'] }).allow('').default(''),
    content: postText.allow('').default(''),
    category: Joi.string().valid('Movies', 'Music', 'Entertainment', 'Games', 'Life').required(),
    contentType: Joi.string().valid('text', 'image', 'video', 'gif', 'poll').default('text'),
    visibility: Joi.string().valid('public', 'guild', 'friends').default('public'),
    draft: Joi.boolean().default(false),
    scheduledPublishedAt: Joi.date().iso().allow(null).default(null),
    topics: Joi.array().max(5).items(plain(40)).default([]),
    contentWarning: plain(160).allow('').default(''),
    reactionSet: Joi.string().valid('classic', 'support', 'spicy').default('classic'),
    embedUrl: Joi.string().uri({ scheme: ['https'] }).max(2048).allow('').default(''),
    externalEmbed: externalEmbed.allow(null).default(null),
    poll: Joi.object({
      question: plain(240).required(),
      options: Joi.array().min(2).max(6).items(Joi.object({ text: plain(100).required() })).required(),
      closesAt: Joi.date().iso().greater('now').allow(null).default(null)
    }).allow(null).default(null),
    media: mediaCollection.default([])
  }).custom((value, helpers) => {
    if (!value.draft && !value.content && !value.media.length && !value.poll && !value.externalEmbed) return helpers.message({ custom: 'Published posts need text, media, an attachment, or a poll.' });
    if (value.contentType === 'poll' && !value.poll) return helpers.message({ custom: 'Poll posts require a question and at least two options.' });
    return value;
  }, 'composer requirements'),
  vote: Joi.object({ value: Joi.string().valid('alright', 'cringe').required() }),
  tts: Joi.object({ voiceKey: Joi.string().valid('spark', 'debate', 'calm').required() }),
  emojiReaction: Joi.object({ key: Joi.string().valid('fire', 'dead', 'laugh', 'sideeye', 'mindblown').required() }),
  embedPreview: Joi.object({ url: Joi.string().uri({ scheme: ['https'] }).max(2048).required() }),
  featureIdea: Joi.object({ text: plain(400).min(8).required(), mood: Joi.string().valid('electric', 'chaotic', 'soft', 'dark', 'wild').required() }),
  adminPost: Joi.object({
    content: postText.allow('').required(),
    category: Joi.string().valid('Movies', 'Music', 'Entertainment', 'Games', 'Life').required(),
    visibility: Joi.string().valid('public', 'friends').required(),
    impressions: Joi.number().integer().min(0).max(1_000_000_000).required(),
    basedVotes: Joi.number().integer().min(0).max(1_000_000_000).required(),
    cringeVotes: Joi.number().integer().min(0).max(1_000_000_000).required()
  }),
  pollVote: Joi.object({ optionId: recordId.required() }),
  comment: Joi.object({ postId: recordId.required(), parent: recordId.allow(null, ''), text: plain(500).required(), gifUrl: Joi.string().allow('').max(2_800_000).pattern(/^(https:\/\/|data:image\/gif;base64,)/i) }),
  guild: Joi.object({ name: plain(60).required(), description: plain(240).allow(''), privacy: Joi.string().valid('public', 'private').default('public') }),
  guildSettings: Joi.object({
    name: plain(60).required(), description: plain(240).allow(''), tagline: plain(100).allow(''), rules: plain(1200).allow(''),
    iconUrl: optionalBanner, bannerUrl: optionalBanner,
    themeColor: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/).required(), accentColor: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/).required(),
    backgroundPattern: Joi.string().valid('clean', 'grid', 'waves', 'stars', 'noise').default('clean'),
    cardStyle: Joi.string().valid('solid', 'soft', 'glass', 'outline').default('solid'),
    iconShape: Joi.string().valid('rounded', 'circle', 'shield', 'hex').default('rounded'),
    seasonalEffect: Joi.string().valid('none', 'confetti', 'snow', 'embers', 'sparkles').default('none'),
    customEmojis: Joi.array().max(24).items(Joi.object({ name: Joi.string().lowercase().pattern(/^[a-z0-9_]{2,24}$/).required(), imageUrl: optionalBanner.required() })).default([]),
    reactionSet: Joi.array().min(2).max(8).unique().items(plain(12)).default(['👍', '🔥', '😂', '💀']),
    landingLayout: Joi.array().min(1).max(7).unique().items(Joi.string().valid('announcement', 'about', 'rules', 'featured', 'members', 'events', 'progress')).default(['announcement', 'about', 'rules', 'featured', 'members', 'progress']),
    welcomeMessage: plain(500).allow('').default(''),
    onboardingQuestions: Joi.array().max(8).items(Joi.object({ prompt: plain(160).required(), options: Joi.array().min(2).max(8).items(plain(60)).required(), required: Joi.boolean().default(false) })).default([]),
    privacy: Joi.string().valid('public', 'private').default('public'), pinnedAnnouncement: plain(500).allow('').default(''),
    settings: Joi.object({ allowJoinRequests: Joi.boolean().required(), showMemberList: Joi.boolean().required(), allowPerGuildProfiles: Joi.boolean().default(true), showOnlineStatus: Joi.boolean().default(true) }).default({ allowJoinRequests: true, showMemberList: true, allowPerGuildProfiles: true, showOnlineStatus: true }),
    contentPrivacy: Joi.string().valid('members').required()
  }),
  guildInvite: Joi.object({ inviteCode: Joi.string().pattern(/^[A-Za-z0-9_-]{8,40}$/).required() }),
  guildMember: Joi.object({ roleKey: Joi.string().lowercase().pattern(/^[a-z0-9_-]{2,30}$/), status: Joi.string().valid('active', 'suspended') }).or('roleKey', 'status'),
  guildIdentity: Joi.object({
    nickname: plain(40).allow('').default(''), avatarUrl: optionalBanner, bannerUrl: optionalBanner, bio: plain(300).allow('').default(''),
    themeColor: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/).required(), avatarFrame: Joi.string().valid('none', 'spark', 'gold', 'violet', 'flame').default('none'),
    onboardingAnswers: Joi.array().max(8).items(Joi.object({ question: plain(160).required(), answer: plain(120).required() })).default([])
  }),
  guildRole: Joi.object({ name: plain(40), color: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/), icon: plain(12), permissions: Joi.object({
    manageGuild: Joi.boolean(), manageRoles: Joi.boolean(), manageMembers: Joi.boolean(), managePosts: Joi.boolean(),
    createPosts: Joi.boolean(), chat: Joi.boolean(), viewAudit: Joi.boolean()
  }).min(1).required() }),
  notificationMute: Joi.object({
    scopeType: Joi.string().valid('user', 'guild', 'category').required(),
    scopeId: plain(80).required(),
    snoozedUntil: Joi.date().iso().allow(null).default(null)
  }),
  guildMessage: Joi.object({ text: plain(2000).required() }),
  friend: Joi.object({ userId: recordId.required() }),
  message: Joi.object({ recipient: plain(254).required(), message: plain(2000).required() }),
  report: Joi.object({ reason: Joi.string().valid('spam', 'harassment', 'offensive', 'other').required(), details: plain(500).allow('') })
};

export function validate(schema) {
  return (req, res, next) => {
    const { value, error } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ error: 'Validation failed', details: error.details.map(item => item.message) });
    req.body = value;
    next();
  };
}

export function signAccessToken(userId) {
  return jwt.sign({ sub: String(userId), type: 'access' }, accessSecret(), { expiresIn: '15m', issuer: 'callout' });
}

export function signRefreshToken(userId) {
  return jwt.sign({ sub: String(userId), type: 'refresh', nonce: crypto.randomUUID() }, refreshSecret(), { expiresIn: '365d', issuer: 'callout' });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, refreshSecret(), { issuer: 'callout' });
}

export function setAuthCookies(res, accessToken, refreshToken) {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie(ACCESS_COOKIE, accessToken, { httpOnly: true, secure, sameSite: 'lax', maxAge: 15 * 60 * 1000, path: '/' });
  // The refresh cookie is renewed whenever it is used, keeping a trusted device
  // signed in while retaining short-lived access tokens for request security.
  res.cookie(REFRESH_COOKIE, refreshToken, { httpOnly: true, secure, sameSite: 'lax', maxAge: 365 * 24 * 60 * 60 * 1000, path: '/api/auth' });
}

export function clearAuthCookies(res) {
  const secure = process.env.NODE_ENV === 'production';
  res.clearCookie(ACCESS_COOKIE, { httpOnly: true, secure, sameSite: 'lax', path: '/' });
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth' });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, accessSecret(), { issuer: 'callout' });
    if (payload.type !== 'access') throw new Error('Invalid token type');
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
}

export function optionalAuth(req, _res, next) {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, accessSecret(), { issuer: 'callout' });
    if (payload.type === 'access') req.userId = payload.sub;
  } catch { /* public routes remain available to signed-out visitors */ }
  next();
}

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function createPasswordResetToken() {
  return crypto.randomBytes(32).toString('hex');
}
