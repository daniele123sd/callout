import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  type: { type: String, enum: ['vote', 'comment', 'reply', 'guild', 'guild_invite', 'friend_request', 'friend_accept', 'message', 'system'], required: true },
  text: { type: String, required: true, maxlength: 240 },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
  guild: { type: mongoose.Schema.Types.ObjectId, ref: 'Guild', default: null },
  read: { type: Boolean, default: false }
}, { timestamps: true });

export const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
