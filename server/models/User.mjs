import mongoose from 'mongoose';

const socialLinksSchema = new mongoose.Schema({
  twitter: { type: String, default: '' },
  instagram: { type: String, default: '' },
  discord: { type: String, default: '' },
  youtube: { type: String, default: '' },
  twitch: { type: String, default: '' },
  custom: { type: String, default: '' }
}, { _id: false });

const preferencesSchema = new mongoose.Schema({
  theme: { type: String, enum: ['light', 'dark', 'system'], default: 'light' },
  palette: { type: String, enum: ['callout', 'midnight', 'mint', 'violet', 'sunset'], default: 'callout' },
  reducedMotion: { type: Boolean, default: false },
  feedDensity: { type: String, enum: ['compact', 'comfortable', 'spacious'], default: 'comfortable' },
  voteEffect: { type: String, enum: ['pop', 'confetti', 'pulse', 'none'], default: 'pop' },
  notificationSound: { type: String, enum: ['callout', 'spark', 'soft', 'none'], default: 'callout' },
  widgetOrder: [{ type: String, enum: ['trending-guilds', 'activity', 'achievements', 'friends', 'topics'] }],
  hiddenTopics: [{ type: String, maxlength: 40 }],
  notifications: {
    likes: { type: Boolean, default: true },
    comments: { type: Boolean, default: true },
    guildInvites: { type: Boolean, default: true },
    mentions: { type: Boolean, default: true },
    follows: { type: Boolean, default: true },
    guildActivity: { type: Boolean, default: true },
    directMessages: { type: Boolean, default: true }
  },
  notificationDelivery: {
    inApp: { type: Boolean, default: true },
    push: { type: Boolean, default: false },
    email: { type: Boolean, default: false }
  },
  directMessages: { type: String, enum: ['everyone', 'guilds', 'nobody'], default: 'everyone' },
  textSize: { type: String, enum: ['small', 'medium', 'large'], default: 'medium' }
}, { _id: false });

const userSchema = new mongoose.Schema({
  googleId: { type: String, sparse: true, index: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  displayName: { type: String, required: true, trim: true },
  handle: { type: String, unique: true, sparse: true, lowercase: true, trim: true, match: /^@[a-z0-9_]{3,30}$/ },
  avatarUrl: { type: String, default: '' },
  vibeScore: { type: Number, default: 0, min: 0 },
  cringeScore: { type: Number, default: 0, min: 0, index: true },
  points: { type: Number, default: 0, min: 0, index: true },
  postCount: { type: Number, default: 0, min: 0 },
  savedPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }],
  bio: { type: String, default: '', maxlength: 1000 },
  bannerUrl: { type: String, default: '' },
  themeColor: { type: String, default: '#ff4713', match: /^#[0-9a-fA-F]{6}$/ },
  avatarFrame: { type: String, enum: ['none', 'spark', 'gold', 'violet', 'flame'], default: 'none' },
  profileEffect: { type: String, enum: ['none', 'glow', 'bubbles', 'spotlight', 'confetti'], default: 'none' },
  vibeAura: { type: String, enum: ['auto', 'none', 'rookie', 'star', 'legend'], default: 'auto' },
  profileBackground: { type: String, enum: ['clean', 'grid', 'waves', 'stars', 'noise'], default: 'clean' },
  profileLayout: [{ type: String, enum: ['posts', 'about', 'guilds', 'achievements', 'media', 'trophies'] }],
  showcaseMode: { type: String, enum: ['featured', 'popular', 'controversial', 'recent'], default: 'featured' },
  featuredBadges: [{ type: String, maxlength: 40 }],
  featuredPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }],
  pinnedGuilds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Guild' }],
  socialLinks: { type: socialLinksSchema, default: () => ({}) },
  pronouns: { type: String, default: '', maxlength: 40 },
  status: { type: String, enum: ['online', 'idle', 'dnd', 'invisible'], default: 'online' },
  preferences: { type: preferencesSchema, default: () => ({}) },
  password: { type: String, select: false },
  refreshTokenHash: { type: String, select: false, default: '' },
  passwordResetHash: { type: String, select: false, default: '' },
  passwordResetExpiresAt: { type: Date }
}, { timestamps: { createdAt: true, updatedAt: true } });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
