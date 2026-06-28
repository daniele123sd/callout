import mongoose from 'mongoose';

const guildAuditSchema = new mongoose.Schema({
  guild: { type: mongoose.Schema.Types.ObjectId, ref: 'Guild', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true, maxlength: 80 },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  details: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: { createdAt: true, updatedAt: false } });

export const GuildAudit = mongoose.models.GuildAudit || mongoose.model('GuildAudit', guildAuditSchema);
