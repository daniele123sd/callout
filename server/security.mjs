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
const optionalUrl = Joi.string().allow('').max(2048).uri({ scheme: ['http', 'https', 'data'] });
const optionalBanner = Joi.string().allow('').max(2_800_000).pattern(/^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i);
const mediaUrl = Joi.string().max(8_500_000).pattern(/^(https:\/\/|data:(image\/(png|jpeg|gif|webp)|video\/(mp4|webm));base64,)/i);
const mediaItem = Joi.object({
  type: Joi.string().valid('image', 'video', 'gif').required(),
  url: mediaUrl.required(),
  alt: plain(120).allow(''),
  duration: Joi.number().min(0).max(25).default(0),
  aspectRatio: Joi.number().min(0.1).max(10).default(1)
});
const mediaCollection = Joi.array().max(4).items(mediaItem).custom((items, helpers) => {
  if (!items.length) return items;
  const videos = items.filter(item => item.type === 'video');
  if (videos.length && (videos.length !== 1 || items.length !== 1)) return helpers.message({ custom: 'A post can contain one short video or an image set, not both.' });
  if (videos.some(item => item.aspectRatio < 0.7 || item.aspectRatio > 1.45)) return helpers.message({ custom: 'Short videos must use a square or near-square aspect ratio.' });
  if (!videos.length && ![1, 2, 4].includes(items.length)) return helpers.message({ custom: 'Image posts must contain 1, 2, or 4 images/GIFs.' });
  return items;
}, 'media layout validation');

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
    bio: plain(200).allow(''),
    bannerUrl: optionalBanner,
    avatarUrl: optionalUrl,
    themeColor: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/).required(),
    pronouns: plain(40).allow(''),
    status: Joi.string().valid('online', 'idle', 'dnd', 'invisible').required(),
    socialLinks: Joi.object({
      twitter: plain(2048).allow(''), instagram: plain(2048).allow(''), discord: plain(100).allow(''),
      youtube: plain(2048).allow(''), twitch: plain(2048).allow(''), custom: plain(2048).allow('')
    }).required(),
    preferences: Joi.object({
      theme: Joi.string().valid('light', 'dark', 'system').required(),
      notifications: Joi.object({ likes: Joi.boolean().required(), comments: Joi.boolean().required(), guildInvites: Joi.boolean().required() }).required(),
      directMessages: Joi.string().valid('everyone', 'guilds', 'nobody').required(),
      textSize: Joi.string().valid('small', 'medium', 'large').required()
    }).required()
  }),
  post: Joi.object({ content: plain(180).required(), category: Joi.string().valid('Movies', 'Music', 'Entertainment', 'Games', 'Life').required(), media: mediaCollection }),
  vote: Joi.object({ value: Joi.string().valid('alright', 'cringe').required() }),
  comment: Joi.object({ postId: recordId.required(), parent: recordId.allow(null, ''), text: plain(500).required(), gifUrl: Joi.string().allow('').max(2_800_000).pattern(/^(https:\/\/|data:image\/gif;base64,)/i) }),
  guild: Joi.object({ name: plain(60).required(), description: plain(240).allow('') }),
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
  return jwt.sign({ sub: String(userId), type: 'refresh', nonce: crypto.randomUUID() }, refreshSecret(), { expiresIn: '7d', issuer: 'callout' });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, refreshSecret(), { issuer: 'callout' });
}

export function setAuthCookies(res, accessToken, refreshToken) {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie(ACCESS_COOKIE, accessToken, { httpOnly: true, secure, sameSite: 'lax', maxAge: 15 * 60 * 1000, path: '/' });
  res.cookie(REFRESH_COOKIE, refreshToken, { httpOnly: true, secure, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/api/auth' });
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
