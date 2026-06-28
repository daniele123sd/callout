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
  privacy: { type: String, enum: ['public', 'private'], default: 'public' },
  inviteCode: { type: String, sparse: true, unique: true, index: true },
  pinnedAnnouncement: { type: String, default: '', maxlength: 500 },
  settings: {
    allowJoinRequests: { type: Boolean, default: true },
    showMemberList: { type: Boolean, default: true }
  },
  contentPrivacy: { type: String, enum: ['members'], default: 'members' },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

export const Guild = mongoose.models.Guild || mongoose.model('Guild', guildSchema);
