import mongoose from 'mongoose';

const guildMembershipSchema = new mongoose.Schema({
  guild: { type: mongoose.Schema.Types.ObjectId, ref: 'Guild', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  roleKey: { type: String, required: true, default: 'viewer', lowercase: true },
  status: { type: String, enum: ['pending', 'active', 'suspended'], default: 'active', index: true },
  joinedAt: { type: Date, default: Date.now }
}, { timestamps: true });

guildMembershipSchema.index({ guild: 1, user: 1 }, { unique: true });

export const GuildMembership = mongoose.models.GuildMembership || mongoose.model('GuildMembership', guildMembershipSchema);
