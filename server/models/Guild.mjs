import mongoose from 'mongoose';

const guildSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, maxlength: 60 },
  description: { type: String, default: '', maxlength: 240 },
  tagline: { type: String, default: '', maxlength: 100 },
  rules: { type: String, default: '', maxlength: 1200 },
  iconUrl: { type: String, default: '' },
  bannerUrl: { type: String, default: '' },
  themeColor: { type: String, default: '#7444e8', match: /^#[0-9a-fA-F]{6}$/ },
  accentColor: { type: String, default: '#ff4713', match: /^#[0-9a-fA-F]{6}$/ },
  backgroundPattern: { type: String, enum: ['clean', 'grid', 'waves', 'stars', 'noise'], default: 'clean' },
  cardStyle: { type: String, enum: ['solid', 'soft', 'glass', 'outline'], default: 'solid' },
  iconShape: { type: String, enum: ['rounded', 'circle', 'shield', 'hex'], default: 'rounded' },
  seasonalEffect: { type: String, enum: ['none', 'confetti', 'snow', 'embers', 'sparkles'], default: 'none' },
  customEmojis: [{ name: { type: String, maxlength: 24 }, imageUrl: { type: String, maxlength: 2800000 } }],
  reactionSet: [{ type: String, maxlength: 12 }],
  landingLayout: [{ type: String, enum: ['announcement', 'about', 'rules', 'featured', 'members', 'events', 'progress'] }],
  welcomeMessage: { type: String, default: '', maxlength: 500 },
  onboardingQuestions: [{ prompt: { type: String, maxlength: 160 }, options: [{ type: String, maxlength: 60 }], required: { type: Boolean, default: false } }],
  guildXp: { type: Number, default: 0, min: 0 },
  level: { type: Number, default: 1, min: 1 },
  achievements: [{ key: { type: String, maxlength: 40 }, name: { type: String, maxlength: 80 }, icon: { type: String, maxlength: 12 } }],
  privacy: { type: String, enum: ['public', 'private'], default: 'public' },
  inviteCode: { type: String, sparse: true, unique: true, index: true },
  pinnedAnnouncement: { type: String, default: '', maxlength: 500 },
  settings: {
    allowJoinRequests: { type: Boolean, default: true },
    showMemberList: { type: Boolean, default: true },
    allowPerGuildProfiles: { type: Boolean, default: true },
    showOnlineStatus: { type: Boolean, default: true }
  },
  contentPrivacy: { type: String, enum: ['members'], default: 'members' },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

export const Guild = mongoose.models.Guild || mongoose.model('Guild', guildSchema);
