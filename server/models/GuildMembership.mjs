import mongoose from 'mongoose';

const guildMembershipSchema = new mongoose.Schema({
  guild: { type: mongoose.Schema.Types.ObjectId, ref: 'Guild', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  roleKey: { type: String, required: true, default: 'viewer', lowercase: true },
  status: { type: String, enum: ['pending', 'active', 'suspended'], default: 'active', index: true },
  guildProfile: {
    nickname: { type: String, default: '', maxlength: 40 },
    avatarUrl: { type: String, default: '', maxlength: 2800000 },
    bannerUrl: { type: String, default: '', maxlength: 2800000 },
    bio: { type: String, default: '', maxlength: 300 },
    themeColor: { type: String, default: '#7444e8', match: /^#[0-9a-fA-F]{6}$/ },
    avatarFrame: { type: String, enum: ['none', 'spark', 'gold', 'violet', 'flame'], default: 'none' }
  },
  contributionScore: { type: Number, default: 0, min: 0 },
  guildXp: { type: Number, default: 0, min: 0 },
  streakDays: { type: Number, default: 0, min: 0 },
  lastActiveAt: { type: Date, default: null },
  onboardingAnswers: [{ question: { type: String, maxlength: 160 }, answer: { type: String, maxlength: 120 } }],
  onboardingCompletedAt: { type: Date, default: null },
  joinedAt: { type: Date, default: Date.now }
}, { timestamps: true });

guildMembershipSchema.index({ guild: 1, user: 1 }, { unique: true });

export const GuildMembership = mongoose.models.GuildMembership || mongoose.model('GuildMembership', guildMembershipSchema);
