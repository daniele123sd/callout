import mongoose from 'mongoose';

const mediaSchema = new mongoose.Schema({
  type: { type: String, enum: ['image', 'video', 'gif'], required: true },
  url: { type: String, required: true },
  alt: { type: String, default: '', maxlength: 120 },
  duration: { type: Number, default: 0, min: 0, max: 25 },
  aspectRatio: { type: Number, default: 1, min: 0.1, max: 10 }
}, { _id: false });

const postSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  content: { type: String, required: true, maxlength: 180 },
  category: { type: String, enum: ['Movies', 'Music', 'Entertainment', 'Games', 'Life'], required: true },
  alrightVotes: { type: Number, default: 0, min: 0 },
  cringeVotes: { type: Number, default: 0, min: 0 },
  impressions: { type: Number, default: 0, min: 0, index: true },
  media: { type: [mediaSchema], default: [] },
  votes: [{
    _id: false,
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    value: { type: String, enum: ['alright', 'cringe'], required: true }
  }]
}, { timestamps: true });

export const Post = mongoose.models.Post || mongoose.model('Post', postSchema);
