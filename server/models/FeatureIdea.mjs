import mongoose from 'mongoose';

const featureIdeaSchema = new mongoose.Schema({
  text: { type: String, required: true, maxlength: 400 },
  mood: { type: String, enum: ['electric', 'chaotic', 'soft', 'dark', 'wild'], default: 'electric', index: true },
  code: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ['published', 'hidden'], default: 'published', index: true }
}, { timestamps: true });

export const FeatureIdea = mongoose.models.FeatureIdea || mongoose.model('FeatureIdea', featureIdeaSchema);
