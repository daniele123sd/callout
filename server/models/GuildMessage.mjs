import mongoose from 'mongoose';

const guildMessageSchema = new mongoose.Schema({
  guild: { type: mongoose.Schema.Types.ObjectId, ref: 'Guild', required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  text: { type: String, required: true, maxlength: 2000 }
}, { timestamps: true });

export const GuildMessage = mongoose.models.GuildMessage || mongoose.model('GuildMessage', guildMessageSchema);
