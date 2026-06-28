import mongoose from 'mongoose';

const friendshipSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  pairKey: { type: String, required: true, unique: true },
  status: { type: String, enum: ['pending', 'accepted'], default: 'pending', index: true }
}, { timestamps: true });

export const Friendship = mongoose.models.Friendship || mongoose.model('Friendship', friendshipSchema);
