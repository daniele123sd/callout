import mongoose from 'mongoose';

const guildSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, maxlength: 60 },
  description: { type: String, default: '', maxlength: 240 },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

export const Guild = mongoose.models.Guild || mongoose.model('Guild', guildSchema);
