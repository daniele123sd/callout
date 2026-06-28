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
  contentPrivacy: { type: String, enum: ['members'], default: 'members' },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

export const Guild = mongoose.models.Guild || mongoose.model('Guild', guildSchema);
