import dotenv from 'dotenv';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { Guild } from '../server/models/Guild.mjs';
import { GuildRole } from '../server/models/GuildRole.mjs';
import { GuildMembership } from '../server/models/GuildMembership.mjs';
import { Post } from '../server/models/Post.mjs';
import { User } from '../server/models/User.mjs';

dotenv.config();
if (!process.env.DB_URI) throw new Error('DB_URI is required.');
const dryRun = process.argv.includes('--dry-run');

const roles = [
  ['owner', 'Owner', 100, { manageGuild: true, manageRoles: true, manageMembers: true, managePosts: true, createPosts: true, chat: true, viewAudit: true }],
  ['moderator', 'Moderator', 80, { manageMembers: true, managePosts: true, createPosts: true, chat: true, viewAudit: true }],
  ['contributor', 'Contributor', 60, { createPosts: true, chat: true }],
  ['chatter', 'Chatter', 40, { chat: true }],
  ['viewer', 'Viewer', 20, { chat: false }]
];

await mongoose.connect(process.env.DB_URI);
const guilds = await Guild.find().lean();
console.log(`${dryRun ? 'Would migrate' : 'Migrating'} ${guilds.length} guilds.`);
if (!dryRun) {
  for (const guild of guilds) {
    await Guild.updateOne({ _id: guild._id }, { $set: { privacy: guild.privacy || 'public', inviteCode: guild.inviteCode || crypto.randomBytes(9).toString('base64url'), pinnedAnnouncement: guild.pinnedAnnouncement || '', settings: guild.settings || { allowJoinRequests: true, showMemberList: true } } });
    for (const [key, name, rank, permissions] of roles) await GuildRole.updateOne({ guild: guild._id, key }, { $setOnInsert: { guild: guild._id, key, name, rank, builtIn: true, permissions } }, { upsert: true });
    for (const member of guild.members || []) await GuildMembership.updateOne({ guild: guild._id, user: member }, { $setOnInsert: { guild: guild._id, user: member, roleKey: String(member) === String(guild.creator) ? 'owner' : 'chatter', status: 'active', joinedAt: guild.createdAt || new Date() } }, { upsert: true });
  }
  await Post.updateMany({ draft: { $exists: false } }, { $set: { draft: false, visibility: 'public', contentType: 'text', topics: [], contentWarning: '', reactionSet: 'classic', embedUrl: '' } });
  await User.updateMany({ avatarFrame: { $exists: false } }, { $set: { avatarFrame: 'none', featuredPosts: [], pinnedGuilds: [] } });
}
await mongoose.disconnect();
console.log(dryRun ? 'Dry run complete; no records changed.' : 'Creator feature migration complete.');
