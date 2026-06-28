import mongoose from 'mongoose';

const notificationMuteSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  scopeType: { type: String, enum: ['user', 'guild', 'category'], required: true },
  scopeId: { type: String, required: true, trim: true, maxlength: 80 },
  snoozedUntil: { type: Date, default: null }
}, { timestamps: true });

notificationMuteSchema.index({ user: 1, scopeType: 1, scopeId: 1 }, { unique: true });

export const NotificationMute = mongoose.models.NotificationMute || mongoose.model('NotificationMute', notificationMuteSchema);
