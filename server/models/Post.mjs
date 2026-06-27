import mongoose from 'mongoose';

const postSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  content: { type: String, required: true, maxlength: 180 },
  category: { type: String, enum: ['Movies', 'Music', 'Entertainment', 'Games', 'Life'], required: true },
  alrightVotes: { type: Number, default: 0, min: 0 },
  cringeVotes: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

export const Post = mongoose.models.Post || mongoose.model('Post', postSchema);
