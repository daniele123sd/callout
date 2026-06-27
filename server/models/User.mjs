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
  notifications: {
    likes: { type: Boolean, default: true },
    comments: { type: Boolean, default: true },
    guildInvites: { type: Boolean, default: true }
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
  bio: { type: String, default: '', maxlength: 200 },
  bannerUrl: { type: String, default: '' },
  themeColor: { type: String, default: '#ff4713', match: /^#[0-9a-fA-F]{6}$/ },
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
