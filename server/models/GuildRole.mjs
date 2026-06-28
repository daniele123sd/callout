import mongoose from 'mongoose';

const permissionSchema = new mongoose.Schema({
  manageGuild: { type: Boolean, default: false },
  manageRoles: { type: Boolean, default: false },
  manageMembers: { type: Boolean, default: false },
  managePosts: { type: Boolean, default: false },
  createPosts: { type: Boolean, default: false },
  chat: { type: Boolean, default: true },
  viewAudit: { type: Boolean, default: false }
}, { _id: false });

const guildRoleSchema = new mongoose.Schema({
  guild: { type: mongoose.Schema.Types.ObjectId, ref: 'Guild', required: true, index: true },
  key: { type: String, required: true, lowercase: true, trim: true, maxlength: 30 },
  name: { type: String, required: true, trim: true, maxlength: 40 },
  color: { type: String, default: '#6b7280', match: /^#[0-9a-fA-F]{6}$/ },
  rank: { type: Number, default: 0 },
  builtIn: { type: Boolean, default: false },
  permissions: { type: permissionSchema, default: () => ({}) }
}, { timestamps: true });

guildRoleSchema.index({ guild: 1, key: 1 }, { unique: true });

export const GuildRole = mongoose.models.GuildRole || mongoose.model('GuildRole', guildRoleSchema);
