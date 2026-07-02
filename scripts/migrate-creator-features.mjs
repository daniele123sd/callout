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
    await Guild.updateOne({ _id: guild._id }, { $set: { privacy: guild.privacy || 'public', inviteCode: guild.inviteCode || crypto.randomBytes(9).toString('base64url'), pinnedAnnouncement: guild.pinnedAnnouncement || '', backgroundPattern: guild.backgroundPattern || 'clean', cardStyle: ['solid','soft','glass','outline'].includes(guild.cardStyle) ? guild.cardStyle : 'solid', iconShape: guild.iconShape || 'rounded', seasonalEffect: ['none','confetti','snow','embers','sparkles'].includes(guild.seasonalEffect) ? guild.seasonalEffect : 'none', customEmojis: guild.customEmojis || [], reactionSet: guild.reactionSet?.length ? guild.reactionSet : ['👍','🔥','😂','💀'], landingLayout: guild.landingLayout?.length ? guild.landingLayout : ['announcement','about','rules','featured','members','progress'], welcomeMessage: guild.welcomeMessage || '', onboardingQuestions: guild.onboardingQuestions || [], guildXp: Number(guild.guildXp || 0), level: Number(guild.level || 1), achievements: guild.achievements || [], settings: { allowJoinRequests: guild.settings?.allowJoinRequests !== false, showMemberList: guild.settings?.showMemberList !== false, allowPerGuildProfiles: guild.settings?.allowPerGuildProfiles !== false, showOnlineStatus: guild.settings?.showOnlineStatus !== false } } });
    for (const [key, name, rank, permissions] of roles) await GuildRole.updateOne({ guild: guild._id, key }, { $setOnInsert: { guild: guild._id, key, name, rank, builtIn: true, permissions } }, { upsert: true });
    for (const member of guild.members || []) await GuildMembership.updateOne({ guild: guild._id, user: member }, { $setOnInsert: { guild: guild._id, user: member, roleKey: String(member) === String(guild.creator) ? 'owner' : 'chatter', status: 'active', joinedAt: guild.createdAt || new Date() } }, { upsert: true });
  }
  await Post.updateMany({ draft: { $exists: false } }, { $set: { draft: false, visibility: 'public', contentType: 'text', topics: [], contentWarning: '', reactionSet: 'classic', embedUrl: '' } });
  await User.updateMany({}, [{ $set: { avatarFrame: { $ifNull: ['$avatarFrame', 'none'] }, featuredPosts: { $ifNull: ['$featuredPosts', []] }, pinnedGuilds: { $ifNull: ['$pinnedGuilds', []] }, profileEffect: { $ifNull: ['$profileEffect', 'none'] }, vibeAura: { $ifNull: ['$vibeAura', 'auto'] }, profileBackground: { $ifNull: ['$profileBackground', 'clean'] }, profileLayout: { $ifNull: ['$profileLayout', ['posts','about','guilds','achievements','media','trophies']] }, showcaseMode: { $ifNull: ['$showcaseMode', 'featured'] }, featuredBadges: { $ifNull: ['$featuredBadges', []] } } }]);
}
await mongoose.disconnect();
console.log(dryRun ? 'Dry run complete; no records changed.' : 'Creator feature migration complete.');
