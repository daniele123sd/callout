import mongoose from 'mongoose';

const mediaSchema = new mongoose.Schema({
  type: { type: String, enum: ['image', 'video', 'gif'], required: true },
  url: { type: String, required: true },
  alt: { type: String, default: '', maxlength: 120 },
  duration: { type: Number, default: 0, min: 0, max: 25 },
  aspectRatio: { type: Number, default: 1, min: 0.1, max: 10 }
}, { _id: false });

const externalEmbedSchema = new mongoose.Schema({
  platform: { type: String, enum: ['x', 'reddit', 'bluesky'], required: true },
  url: { type: String, required: true, maxlength: 2048 },
  authorName: { type: String, default: '', maxlength: 120 },
  authorHandle: { type: String, default: '', maxlength: 120 },
  authorAvatar: { type: String, default: '', maxlength: 2048 },
  text: { type: String, default: '', maxlength: 1200 },
  community: { type: String, default: '', maxlength: 120 },
  mediaUrl: { type: String, default: '', maxlength: 2048 },
  replyCount: { type: Number, default: 0, min: 0 },
  repostCount: { type: Number, default: 0, min: 0 },
  likeCount: { type: Number, default: 0, min: 0 },
  viewCount: { type: Number, default: 0, min: 0 },
  sourceCreatedAt: { type: Date, default: null },
  fetchedAt: { type: Date, default: Date.now }
}, { _id: false });

const postSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  clientRequestId: { type: String, default: '', maxlength: 80 },
  guild: { type: mongoose.Schema.Types.ObjectId, ref: 'Guild', default: null, index: true },
  content: { type: String, default: '', maxlength: 2000 },
  category: { type: String, enum: ['Movies', 'Music', 'Entertainment', 'Games', 'Life'], required: true },
  contentType: { type: String, enum: ['text', 'image', 'video', 'gif', 'poll'], default: 'text' },
  visibility: { type: String, enum: ['public', 'guild', 'friends'], default: 'public', index: true },
  draft: { type: Boolean, default: false, index: true },
  scheduledPublishedAt: { type: Date, default: null, index: true },
  topics: [{ type: String, trim: true, maxlength: 40 }],
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  contentWarning: { type: String, default: '', maxlength: 160 },
  reactionSet: { type: String, enum: ['classic', 'support', 'spicy'], default: 'classic' },
  embedUrl: { type: String, default: '', maxlength: 2048 },
  externalEmbed: { type: externalEmbedSchema, default: null },
  poll: {
    question: { type: String, default: '', maxlength: 240 },
    options: [{
      text: { type: String, required: true, maxlength: 100 },
      voters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
    }],
    closesAt: { type: Date, default: null }
  },
  alrightVotes: { type: Number, default: 0, min: 0 },
  cringeVotes: { type: Number, default: 0, min: 0 },
  impressions: { type: Number, default: 0, min: 0, index: true },
  adminMetrics: {
    basedAdjustment: { type: Number, default: 0 },
    cringeAdjustment: { type: Number, default: 0 },
    impressionsAdjustment: { type: Number, default: 0 },
    editedAt: { type: Date, default: null },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  media: { type: [mediaSchema], default: [] },
  votes: [{
    _id: false,
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    value: { type: String, enum: ['alright', 'cringe'], required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  emojiReactions: [{
    _id: false,
    key: { type: String, enum: ['fire', 'dead', 'laugh', 'sideeye', 'mindblown'], required: true },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  }]
}, { timestamps: true });

postSchema.index({ author: 1, clientRequestId: 1 }, { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string', $gt: '' } } });

export const Post = mongoose.models.Post || mongoose.model('Post', postSchema);
