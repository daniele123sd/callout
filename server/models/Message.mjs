import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  text: { type: String, required: true, maxlength: 2000 },
  read: { type: Boolean, default: false }
}, { timestamps: true });

export const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
