import mongoose from 'mongoose';

const adminIntegrationSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  encryptedRefreshToken: { type: String, select: false, default: '' },
  tokenIv: { type: String, select: false, default: '' },
  tokenTag: { type: String, select: false, default: '' },
  accountName: { type: String, default: '' },
  connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

export const AdminIntegration = mongoose.models.AdminIntegration || mongoose.model('AdminIntegration', adminIntegrationSchema);
