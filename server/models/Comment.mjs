import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema({
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null, index: true },
  text: { type: String, required: true, maxlength: 500 },
  gifUrl: { type: String, default: '', maxlength: 2800000 },
  upvotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

export const Comment = mongoose.models.Comment || mongoose.model('Comment', commentSchema);
