import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
  reason: { type: String, enum: ['spam', 'harassment', 'offensive', 'other'], required: true },
  details: { type: String, default: '', maxlength: 500 },
  status: { type: String, enum: ['open', 'reviewed', 'dismissed'], default: 'open' }
}, { timestamps: true });

reportSchema.index({ reporter: 1, post: 1 }, { unique: true });

export const Report = mongoose.models.Report || mongoose.model('Report', reportSchema);
