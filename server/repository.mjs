import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { User } from './models/User.mjs';
import { Post } from './models/Post.mjs';
import { Report } from './models/Report.mjs';
import { Comment } from './models/Comment.mjs';
import { Guild } from './models/Guild.mjs';
import { Notification } from './models/Notification.mjs';
import { Message } from './models/Message.mjs';
import { GuildMessage } from './models/GuildMessage.mjs';
import { Friendship } from './models/Friendship.mjs';
import { GuildRole } from './models/GuildRole.mjs';
import { GuildMembership } from './models/GuildMembership.mjs';
import { GuildAudit } from './models/GuildAudit.mjs';
import { NotificationMute } from './models/NotificationMute.mjs';

let connected = false;
const memoryUsers = new Map();
const memoryPosts = new Map();
const memoryReports = [];
const memoryComments = new Map();
const memoryGuilds = new Map();
const memoryNotifications = [];
const memoryMessages = [];
const memoryGuildMessages = [];
const memoryFriendships = [];
const memoryGuildRoles = new Map();
const memoryGuildMemberships = new Map();
const memoryGuildAudits = [];
const memoryNotificationMutes = [];

const DEFAULT_GUILD_ROLES = [
  { key: 'owner', name: 'Owner', color: '#ff4713', rank: 100, builtIn: true, permissions: { manageGuild: true, manageRoles: true, manageMembers: true, managePosts: true, createPosts: true, chat: true, viewAudit: true } },
  { key: 'moderator', name: 'Moderator', color: '#7444e8', rank: 80, builtIn: true, permissions: { manageMembers: true, managePosts: true, createPosts: true, chat: true, viewAudit: true } },
  { key: 'contributor', name: 'Contributor', color: '#0f9f78', rank: 60, builtIn: true, permissions: { createPosts: true, chat: true } },
  { key: 'chatter', name: 'Chatter', color: '#2979ff', rank: 40, builtIn: true, permissions: { chat: true } },
  { key: 'viewer', name: 'Viewer', color: '#6b7280', rank: 20, builtIn: true, permissions: { chat: false } }
];

const membershipKey = (guildId, userId) => `${guildId}:${userId}`;

export async function connectDatabase() {
  if (!process.env.DB_URI) {
    console.warn('DB_URI is not set; Callout is using the development in-memory store.');
    return false;
  }
  try {
    await mongoose.connect(process.env.DB_URI, { serverSelectionTimeoutMS: 3500 });
    connected = true;
    console.log('Connected to MongoDB.');
  } catch (error) {
    console.warn(`MongoDB unavailable (${error.message}); using the development in-memory store.`);
  }
  return connected;
}

export function databaseMode() {
  return connected ? 'mongodb' : 'memory';
}

const normalize = document => {
  if (!document) return null;
  return typeof document.toObject === 'function' ? document.toObject() : { ...document };
};

export function publicUser(user) {
  const value = normalize(user);
  if (!value) return null;
  const { password, refreshTokenHash, refreshTokenHashes, passwordResetHash, passwordResetExpiresAt, ...safe } = value;
  safe.id = String(safe._id || safe.id);
  safe.vibeScore = Number(safe.vibeScore || 0);
  safe.cringeScore = Number(safe.cringeScore || 0);
  safe.vibeBadges = vibeBadges(safe.vibeScore);
  safe.cosmeticUnlocks = cosmeticUnlocks(safe.vibeScore);
  delete safe._id;
  delete safe.__v;
  return safe;
}

export function vibeBadges(score = 0) {
  const badges = [{ key: 'new-voice', name: 'New Voice', icon: '✦', threshold: 0 }];
  if (score >= 25) badges.push({ key: 'good-energy', name: 'Good Energy', icon: '☀', threshold: 25 });
  if (score >= 100) badges.push({ key: 'conversation-starter', name: 'Conversation Starter', icon: '⚡', threshold: 100 });
  if (score >= 250) badges.push({ key: 'community-spark', name: 'Community Spark', icon: '🔥', threshold: 250 });
  if (score >= 1000) badges.push({ key: 'vibe-legend', name: 'Vibe Legend', icon: '♛', threshold: 1000 });
  return badges;
}

export function cosmeticUnlocks(score = 0) {
  const unlocks = { frames: ['none'], effects: ['none'], auras: ['auto', 'none', 'rookie'], backgrounds: ['clean'], palettes: ['callout'] };
  if (score >= 25) { unlocks.frames.push('spark'); unlocks.effects.push('glow'); unlocks.backgrounds.push('grid'); unlocks.palettes.push('mint'); }
  if (score >= 100) { unlocks.frames.push('violet'); unlocks.effects.push('bubbles'); unlocks.auras.push('star'); unlocks.backgrounds.push('waves'); unlocks.palettes.push('violet'); }
  if (score >= 250) { unlocks.frames.push('flame'); unlocks.effects.push('spotlight'); unlocks.backgrounds.push('stars'); unlocks.palettes.push('sunset'); }
  if (score >= 1000) { unlocks.frames.push('gold'); unlocks.effects.push('confetti'); unlocks.auras.push('legend'); unlocks.backgrounds.push('noise'); unlocks.palettes.push('midnight'); }
  return unlocks;
}

function publicIdentity(user) {
  const account = publicUser(user);
  if (!account) return null;
  return { id: account.id, displayName: account.displayName, handle: account.handle, avatarUrl: account.avatarUrl, isAutomated: Boolean(account.isAutomated), automationPersona: account.automationPersona || '', vibeScore: account.vibeScore, vibeBadges: account.vibeBadges, cringeScore: account.cringeScore, postCount: Number(account.postCount || 0), createdAt: account.createdAt };
}

async function incrementVibe(userId, amount) {
  if (connected) return User.findByIdAndUpdate(userId, { $inc: { vibeScore: amount } }, { new: true }).exec();
  const user = memoryUsers.get(String(userId));
  if (user) user.vibeScore = Math.max(0, Number(user.vibeScore || 0) + amount);
  return user || null;
}

export async function findUserByEmail(email, secrets = false) {
  if (connected) {
    let query = User.findOne({ email: email.toLowerCase() });
    if (secrets) query = query.select('+password +refreshTokenHash +refreshTokenHashes +passwordResetHash +passwordResetExpiresAt');
    return query.exec();
  }
  return [...memoryUsers.values()].find(user => user.email === email.toLowerCase()) || null;
}

export async function findUserByGoogleId(googleId) {
  if (connected) return User.findOne({ googleId }).exec();
  return [...memoryUsers.values()].find(user => user.googleId === googleId) || null;
}

export async function findUserById(id, secrets = false) {
  if (connected) {
    if (!mongoose.isValidObjectId(id)) return null;
    let query = User.findById(id);
    if (secrets) query = query.select('+password +refreshTokenHash +refreshTokenHashes +passwordResetHash +passwordResetExpiresAt');
    return query.exec();
  }
  return memoryUsers.get(String(id)) || null;
}

export async function createUser(values) {
  const userValues = { ...values };
  if (!userValues.handle) {
    const base = String(userValues.displayName || 'member').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 21) || 'member';
    userValues.handle = `@${base}_${crypto.randomBytes(3).toString('hex')}`;
  }
  if (connected) return User.create(userValues);
  const now = new Date();
  const user = { id: crypto.randomUUID(), vibeScore: 0, cringeScore: 0, points: 0, postCount: 0, savedPosts: [], avatarUrl: '', bio: '', bannerUrl: '', themeColor: '#ff4713', avatarFrame: 'none', profileEffect: 'none', vibeAura: 'auto', profileBackground: 'clean', profileLayout: ['posts', 'about', 'guilds', 'achievements', 'media', 'trophies'], showcaseMode: 'featured', featuredBadges: [], featuredPosts: [], pinnedGuilds: [], socialLinks: {}, pronouns: '', status: 'online', preferences: { palette: 'callout', reducedMotion: false, feedDensity: 'comfortable', voteEffect: 'pop', notificationSound: 'callout', widgetOrder: ['trending-guilds', 'activity', 'achievements'], hiddenTopics: [] }, createdAt: now, updatedAt: now, ...userValues };
  memoryUsers.set(user.id, user);
  return user;
}

export async function updateUser(id, values) {
  if (connected) return User.findByIdAndUpdate(id, values, { new: true, runValidators: true }).exec();
  const user = memoryUsers.get(String(id));
  if (!user) return null;
  Object.assign(user, values, { updatedAt: new Date() });
  return user;
}

export async function createPost(authorId, values) {
  const publishedNow = !values.draft && (!values.scheduledPublishedAt || new Date(values.scheduledPublishedAt) <= new Date());
  if (connected) {
    const post = await Post.create({ author: authorId, ...values });
    if (publishedNow) await User.findByIdAndUpdate(authorId, { $inc: { points: 10, vibeScore: 10, postCount: 1 } });
    return post;
  }
  const prepared = { ...values, poll: values.poll ? { ...values.poll, options: values.poll.options.map(option => ({ id: crypto.randomUUID(), text: option.text, voters: [] })) } : null };
  const post = { id: crypto.randomUUID(), author: String(authorId), alrightVotes: 0, cringeVotes: 0, impressions: 0, votes: [], createdAt: new Date(), updatedAt: new Date(), ...prepared };
  memoryPosts.set(post.id, post);
  const user = memoryUsers.get(String(authorId));
  if (user && publishedNow) { user.points = (user.points || 0) + 10; user.vibeScore = (user.vibeScore || 0) + 10; user.postCount = (user.postCount || 0) + 1; }
  return post;
}

const serializePost = (post, userId = '') => {
  const value = normalize(post);
  const votes = value.votes || [];
  const userVote = votes.find(vote => String(vote.user?._id || vote.user) === String(userId))?.value || null;
  const poll = value.poll?.options?.length ? { ...value.poll, options: value.poll.options.map(option => ({ id: String(option._id || option.id), text: option.text, votes: option.voters?.length || 0, voted: (option.voters || []).some(voter => String(voter) === String(userId)), voters: undefined })) } : null;
  return { ...value, id: String(value._id || value.id), _id: undefined, votes: undefined, userVote, poll };
};

export async function listPosts(userId = '', { trending = false } = {}) {
  if (connected) {
    const sort = trending ? { impressions: -1, alrightVotes: -1, cringeVotes: -1, createdAt: -1 } : { createdAt: -1 };
    const posts = await Post.find({ guild: null, draft: { $ne: true }, visibility: { $in: ['public', null] }, $or: [{ scheduledPublishedAt: null }, { scheduledPublishedAt: { $lte: new Date() } }] }).sort(sort).populate('author', 'displayName handle avatarUrl isAutomated automationPersona').lean().exec();
    const counts = await Comment.aggregate([{ $match: { post: { $in: posts.map(post => post._id) } } }, { $group: { _id: '$post', count: { $sum: 1 } } }]);
    const countMap = new Map(counts.map(item => [String(item._id), item.count]));
    return posts.map(post => ({
      ...serializePost(post, userId),
      commentCount: countMap.get(String(post._id)) || 0,
      author: post.author ? { ...post.author, id: String(post.author._id), _id: undefined } : null
    }));
  }
  return [...memoryPosts.values()].filter(post => !post.guild && !post.draft && (post.visibility || 'public') === 'public' && (!post.scheduledPublishedAt || new Date(post.scheduledPublishedAt) <= new Date())).sort((a, b) => trending ? ((b.impressions || 0) - (a.impressions || 0) || new Date(b.createdAt) - new Date(a.createdAt)) : new Date(b.createdAt) - new Date(a.createdAt)).map(post => ({
    ...serializePost(post, userId), commentCount: [...memoryComments.values()].filter(comment => comment.post === post.id).length,
    author: publicIdentity(memoryUsers.get(String(post.author)))
  }));
}

export async function listDrafts(userId) {
  if (connected) return (await Post.find({ author: userId, draft: true }).sort({ updatedAt: -1 }).lean()).map(post => serializePost(post, userId));
  return [...memoryPosts.values()].filter(post => post.author === String(userId) && post.draft).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(post => serializePost(post, userId));
}

export async function voteOnPoll(postId, userId, optionId) {
  if (connected) {
    const post = await Post.findById(postId);
    if (!post?.poll?.options?.length || post.poll.closesAt && post.poll.closesAt <= new Date()) return null;
    const option = post.poll.options.id(optionId);
    if (!option) return null;
    post.poll.options.forEach(item => item.voters.pull(userId));
    option.voters.addToSet(userId);
    post.impressions += 1;
    await post.save();
    await incrementVibe(userId, 1);
    return serializePost(post, userId);
  }
  const post = memoryPosts.get(String(postId));
  if (!post?.poll?.options?.length || post.poll.closesAt && new Date(post.poll.closesAt) <= new Date()) return null;
  const option = post.poll.options.find(item => String(item.id) === String(optionId));
  if (!option) return null;
  post.poll.options.forEach(item => { item.voters = (item.voters || []).filter(id => id !== String(userId)); });
  option.voters ||= []; option.voters.push(String(userId)); post.impressions = (post.impressions || 0) + 1;
  await incrementVibe(userId, 1);
  return serializePost(post, userId);
}

export async function recordPostView(postId) {
  if (connected) return Post.findByIdAndUpdate(postId, { $inc: { impressions: 1 } }, { new: true }).exec();
  const post = memoryPosts.get(String(postId));
  if (post) post.impressions = (post.impressions || 0) + 1;
  return post || null;
}

export async function canAccessPost(postId, userId = '') {
  if (connected) {
    const post = await Post.findById(postId).select('guild').lean();
    if (!post) return false;
    return !post.guild || Boolean(userId && await Guild.exists({ _id: post.guild, members: userId }));
  }
  const post = memoryPosts.get(String(postId));
  if (!post) return false;
  return !post.guild || Boolean(userId && memoryGuilds.get(String(post.guild))?.members.includes(String(userId)));
}

export async function voteOnPost(postId, userId, value) {
  if (connected) {
    const post = await Post.findById(postId);
    if (!post) return null;
    if (String(post.author) === String(userId)) return { forbidden: true };
    const existing = post.votes.find(vote => String(vote.user) === String(userId));
    const previousValue = existing?.value;
    if (existing?.value === value) post.votes = post.votes.filter(vote => String(vote.user) !== String(userId));
    else if (existing) existing.value = value;
    else post.votes.push({ user: userId, value });
    post.alrightVotes = post.votes.filter(vote => vote.value === 'alright').length;
    post.cringeVotes = post.votes.filter(vote => vote.value === 'cringe').length;
    post.impressions += 1;
    await post.save();
    if (!previousValue) await incrementVibe(userId, 1);
    if (String(post.author) !== String(userId) && previousValue !== value) {
      await Notification.create({ recipient: post.author, actor: userId, type: 'vote', post: post._id, text: `Someone voted ${value === 'alright' ? 'Alright' : 'Cringe'} on your take.` });
    }
    return serializePost(post, userId);
  }
  const post = memoryPosts.get(String(postId));
  if (!post) return null;
  if (post.author === String(userId)) return { forbidden: true };
  const existingIndex = post.votes.findIndex(vote => vote.user === String(userId));
  const previousValue = existingIndex >= 0 ? post.votes[existingIndex].value : null;
  if (existingIndex >= 0 && post.votes[existingIndex].value === value) post.votes.splice(existingIndex, 1);
  else if (existingIndex >= 0) post.votes[existingIndex].value = value;
  else post.votes.push({ user: String(userId), value, createdAt: new Date() });
  post.alrightVotes = post.votes.filter(vote => vote.value === 'alright').length;
  post.cringeVotes = post.votes.filter(vote => vote.value === 'cringe').length;
  post.impressions += 1;
  if (!previousValue) await incrementVibe(userId, 1);
  if (post.author !== String(userId) && previousValue !== value) memoryNotifications.push({ id: crypto.randomUUID(), recipient: post.author, actor: publicUser(memoryUsers.get(String(userId))), type: 'vote', post: post.id, text: `Someone voted ${value === 'alright' ? 'Alright' : 'Cringe'} on your take.`, read: false, createdAt: new Date() });
  return serializePost(post, userId);
}

const serializeComment = (comment, userId = '') => {
  const value = normalize(comment);
  const author = value.author ? publicIdentity(value.author) : null;
  return { ...value, id: String(value._id || value.id), _id: undefined, post: String(value.post), parent: value.parent ? String(value.parent) : null, author, votes: value.upvotes?.length || 0, upvoted: (value.upvotes || []).some(id => String(id) === String(userId)), upvotes: undefined, replies: [] };
};

export async function listComments(postId, userId = '') {
  const flat = connected
    ? (await Comment.find({ post: postId }).sort({ createdAt: 1 }).populate('author', 'displayName handle avatarUrl isAutomated automationPersona').lean().exec()).map(comment => serializeComment(comment, userId))
    : [...memoryComments.values()].filter(comment => comment.post === String(postId)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).map(comment => serializeComment({ ...comment, author: publicUser(memoryUsers.get(comment.author)) }, userId));
  const map = new Map(flat.map(comment => [comment.id, comment]));
  const roots = [];
  flat.forEach(comment => { if (comment.parent && map.has(comment.parent)) map.get(comment.parent).replies.push(comment); else roots.push(comment); });
  return roots;
}

export async function createComment(postId, authorId, { text, parent = null, gifUrl = '' }) {
  if (connected) {
    const post = await Post.findByIdAndUpdate(postId, { $inc: { impressions: 1 } });
    if (!post) return null;
    if (parent && !(await Comment.exists({ _id: parent, post: postId }))) return null;
    const comment = await Comment.create({ post: postId, author: authorId, parent, text, gifUrl });
    await incrementVibe(authorId, 4);
    const parentComment = parent ? await Comment.findById(parent) : null;
    const recipient = parentComment?.author || post.author;
    if (String(recipient) !== String(authorId)) await Notification.create({ recipient, actor: authorId, type: parent ? 'reply' : 'comment', post: post._id, text: parent ? 'Someone replied to your Take.' : 'Someone added a Take to your post.' });
    return serializeComment(await comment.populate('author', 'displayName handle avatarUrl isAutomated automationPersona'), authorId);
  }
  if (!memoryPosts.has(String(postId))) return null;
  const comment = { id: crypto.randomUUID(), post: String(postId), author: String(authorId), parent, text, gifUrl, upvotes: [], createdAt: new Date(), updatedAt: new Date() };
  memoryComments.set(comment.id, comment);
  await incrementVibe(authorId, 4);
  const post = memoryPosts.get(String(postId)); post.impressions = (post.impressions || 0) + 1;
  const parentComment = parent ? memoryComments.get(String(parent)) : null;
  const recipient = parentComment?.author || post.author;
  if (recipient !== String(authorId)) memoryNotifications.push({ id: crypto.randomUUID(), recipient, actor: publicUser(memoryUsers.get(String(authorId))), type: parent ? 'reply' : 'comment', post: String(postId), text: parent ? 'Someone replied to your Take.' : 'Someone added a Take to your post.', read: false, createdAt: new Date() });
  return serializeComment({ ...comment, author: publicUser(memoryUsers.get(String(authorId))) }, authorId);
}

export async function voteOnComment(commentId, userId) {
  if (connected) {
    const comment = await Comment.findById(commentId).populate('author', 'displayName handle avatarUrl isAutomated automationPersona');
    if (!comment) return null;
    const index = comment.upvotes.findIndex(id => String(id) === String(userId));
    if (index >= 0) comment.upvotes.splice(index, 1); else comment.upvotes.push(userId);
    await comment.save();
    if (index < 0) await incrementVibe(userId, 1);
    return serializeComment(comment, userId);
  }
  const comment = memoryComments.get(String(commentId));
  if (!comment) return null;
  const index = comment.upvotes.indexOf(String(userId));
  if (index >= 0) comment.upvotes.splice(index, 1); else comment.upvotes.push(String(userId));
  if (index < 0) await incrementVibe(userId, 1);
  return serializeComment({ ...comment, author: publicUser(memoryUsers.get(comment.author)) }, userId);
}

export async function updatePost(postId, authorId, values) {
  if (connected) return Post.findOneAndUpdate({ _id: postId, author: authorId }, values, { new: true, runValidators: true }).exec();
  const post = memoryPosts.get(String(postId));
  if (!post || post.author !== String(authorId)) return null;
  Object.assign(post, values, { updatedAt: new Date() });
  return post;
}

export async function deletePost(postId, authorId) {
  if (connected) {
    const post = await Post.findOneAndDelete({ _id: postId, author: authorId }).exec();
    if (post) {
      await Promise.all([
        Comment.deleteMany({ post: postId }), Notification.deleteMany({ post: postId }),
        User.updateMany({}, { $pull: { savedPosts: postId } }),
        User.findByIdAndUpdate(authorId, { $inc: { points: -10, vibeScore: -10, postCount: -1 } })
      ]);
    }
    return post;
  }
  const post = memoryPosts.get(String(postId));
  if (!post || post.author !== String(authorId)) return null;
  memoryPosts.delete(String(postId));
  const user = memoryUsers.get(String(authorId)); if (user) { user.points = Math.max(0, (user.points || 0) - 10); user.vibeScore = Math.max(0, (user.vibeScore || 0) - 10); user.postCount = Math.max(0, (user.postCount || 0) - 1); }
  for (const [id, comment] of memoryComments) if (comment.post === String(postId)) memoryComments.delete(id);
  for (const account of memoryUsers.values()) account.savedPosts = (account.savedPosts || []).filter(id => id !== String(postId));
  return post;
}

export async function toggleSavedPost(userId, postId) {
  if (connected) {
    if (!(await Post.exists({ _id: postId }))) return null;
    const user = await User.findById(userId);
    if (!user) return null;
    const saved = user.savedPosts.some(id => String(id) === String(postId));
    if (saved) user.savedPosts.pull(postId); else user.savedPosts.push(postId);
    await user.save();
    return { saved: !saved, savedPostIds: user.savedPosts.map(String) };
  }
  const user = memoryUsers.get(String(userId));
  if (!user || !memoryPosts.has(String(postId))) return null;
  user.savedPosts ||= [];
  const index = user.savedPosts.indexOf(String(postId));
  if (index >= 0) user.savedPosts.splice(index, 1); else user.savedPosts.push(String(postId));
  return { saved: index < 0, savedPostIds: user.savedPosts };
}

export async function listSavedPostIds(userId) {
  if (connected) {
    const user = await User.findById(userId).select('savedPosts').lean();
    return (user?.savedPosts || []).map(String);
  }
  return memoryUsers.get(String(userId))?.savedPosts || [];
}

const serializeGuild = (guild, userId = '') => {
  const value = normalize(guild);
  const members = value.members || [];
  const creatorAccount = value.creator && typeof value.creator === 'object' ? publicIdentity(value.creator) : null;
  const creator = creatorAccount ? { id: creatorAccount.id, displayName: creatorAccount.displayName, handle: creatorAccount.handle, avatarUrl: creatorAccount.avatarUrl } : (value.creator ? { id: String(value.creator) } : null);
  const joined = members.some(member => String(member._id || member) === String(userId));
  const owner = String(creator?.id || creator?._id || value.creator) === String(userId);
  const result = { ...value, id: String(value._id || value.id), _id: undefined, creator, memberCount: members.length, joined, owner, canViewContent: joined, members: undefined };
  if (!owner) delete result.inviteCode;
  return result;
};

async function ensureGuildRoles(guildId) {
  if (connected) {
    const existing = new Set((await GuildRole.find({ guild: guildId }).select('key').lean()).map(role => role.key));
    const missing = DEFAULT_GUILD_ROLES.filter(role => !existing.has(role.key)).map(role => ({ ...role, guild: guildId }));
    if (missing.length) await GuildRole.insertMany(missing, { ordered: false }).catch(error => { if (error?.code !== 11000) throw error; });
    return GuildRole.find({ guild: guildId }).sort({ rank: -1 }).lean();
  }
  if (!memoryGuildRoles.has(String(guildId))) memoryGuildRoles.set(String(guildId), DEFAULT_GUILD_ROLES.map(role => ({ id: crypto.randomUUID(), guild: String(guildId), ...structuredClone(role) })));
  return memoryGuildRoles.get(String(guildId));
}

async function guildAccess(guildId, userId) {
  if (!userId) return { joined: false, pending: false, roleKey: null, permissions: {} };
  if (connected) {
    const guild = await Guild.findById(guildId).select('creator members').lean();
    if (!guild) return null;
    if (String(guild.creator) === String(userId)) return { joined: true, pending: false, roleKey: 'owner', permissions: DEFAULT_GUILD_ROLES[0].permissions };
    const membership = await GuildMembership.findOne({ guild: guildId, user: userId }).lean();
    if (!membership) {
      const legacyMember = (guild.members || []).some(member => String(member) === String(userId));
      return legacyMember ? { joined: true, pending: false, roleKey: 'chatter', permissions: DEFAULT_GUILD_ROLES.find(role => role.key === 'chatter').permissions } : { joined: false, pending: false, roleKey: null, permissions: {} };
    }
    if (membership.status !== 'active') return { joined: false, pending: membership.status === 'pending', roleKey: membership.roleKey, permissions: {} };
    const role = await GuildRole.findOne({ guild: guildId, key: membership.roleKey }).lean();
    const fallback = DEFAULT_GUILD_ROLES.find(item => item.key === membership.roleKey);
    return { joined: true, pending: false, roleKey: membership.roleKey, permissions: role?.permissions || fallback?.permissions || {} };
  }
  const guild = memoryGuilds.get(String(guildId));
  if (!guild) return null;
  if (guild.creator === String(userId)) return { joined: true, pending: false, roleKey: 'owner', permissions: DEFAULT_GUILD_ROLES[0].permissions };
  const membership = memoryGuildMemberships.get(membershipKey(guildId, userId));
  if (!membership) return guild.members.includes(String(userId)) ? { joined: true, pending: false, roleKey: 'chatter', permissions: DEFAULT_GUILD_ROLES.find(role => role.key === 'chatter').permissions } : { joined: false, pending: false, roleKey: null, permissions: {} };
  const role = (await ensureGuildRoles(guildId)).find(item => item.key === membership.roleKey);
  return membership.status === 'active' ? { joined: true, pending: false, roleKey: membership.roleKey, permissions: role?.permissions || {} } : { joined: false, pending: membership.status === 'pending', roleKey: membership.roleKey, permissions: {} };
}

async function recordGuildAudit(guildId, actorId, action, details = {}, targetUser = null) {
  if (connected) return GuildAudit.create({ guild: guildId, actor: actorId, action, targetUser, details });
  memoryGuildAudits.push({ id: crypto.randomUUID(), guild: String(guildId), actor: String(actorId), action, targetUser: targetUser ? String(targetUser) : null, details, createdAt: new Date() });
}

export async function listGuilds(userId = '') {
  if (connected) return (await Guild.find().sort({ createdAt: -1 }).populate('creator', 'displayName handle avatarUrl').lean()).map(guild => serializeGuild(guild, userId));
  return [...memoryGuilds.values()].map(guild => serializeGuild({ ...guild, creator: memoryUsers.get(guild.creator) }, userId));
}

export async function createGuild(userId, values) {
  const inviteCode = crypto.randomBytes(9).toString('base64url');
  if (connected) {
    const guild = await Guild.create({ ...values, inviteCode, creator: userId, members: [userId] });
    await ensureGuildRoles(guild._id);
    await GuildMembership.create({ guild: guild._id, user: userId, roleKey: 'owner', status: 'active' });
    await recordGuildAudit(guild._id, userId, 'guild.created', { name: guild.name });
    return serializeGuild(await guild.populate('creator', 'displayName handle avatarUrl'), userId);
  }
  const guild = { id: crypto.randomUUID(), creator: String(userId), members: [String(userId)], inviteCode, privacy: 'public', backgroundPattern: 'clean', cardStyle: 'solid', iconShape: 'rounded', seasonalEffect: 'none', customEmojis: [], reactionSet: ['👍', '🔥', '😂', '💀'], landingLayout: ['announcement', 'about', 'rules', 'featured', 'members', 'progress'], welcomeMessage: '', onboardingQuestions: [], guildXp: 0, level: 1, achievements: [], settings: { allowJoinRequests: true, showMemberList: true, allowPerGuildProfiles: true, showOnlineStatus: true }, createdAt: new Date(), ...values };
  memoryGuilds.set(guild.id, guild);
  await ensureGuildRoles(guild.id);
  memoryGuildMemberships.set(membershipKey(guild.id, userId), { guild: guild.id, user: String(userId), roleKey: 'owner', status: 'active', joinedAt: new Date() });
  await recordGuildAudit(guild.id, userId, 'guild.created', { name: guild.name });
  return serializeGuild({ ...guild, creator: memoryUsers.get(String(userId)) }, userId);
}

export async function getGuild(guildId, userId = '') {
  if (connected) {
    if (!mongoose.isValidObjectId(guildId)) return null;
    const guild = await Guild.findById(guildId).populate('creator', 'displayName handle avatarUrl').lean();
    if (!guild) return null;
    const access = await guildAccess(guildId, userId);
    const roles = access?.permissions?.manageRoles ? await ensureGuildRoles(guildId) : [];
    const membership = userId ? await GuildMembership.findOne({ guild: guildId, user: userId }).lean() : null;
    return { ...serializeGuild(guild, userId), joined: access?.joined || false, joinPending: access?.pending || false, canViewContent: access?.joined || false, viewerRole: access?.roleKey || null, permissions: access?.permissions || {}, roles, viewerMembership: membership ? { guildProfile: membership.guildProfile || {}, contributionScore: Number(membership.contributionScore || 0), guildXp: Number(membership.guildXp || 0), streakDays: Number(membership.streakDays || 0), onboardingAnswers: membership.onboardingAnswers || [], onboardingCompletedAt: membership.onboardingCompletedAt } : null };
  }
  const guild = memoryGuilds.get(String(guildId));
  if (!guild) return null;
  const access = await guildAccess(guildId, userId);
  const membership = userId ? memoryGuildMemberships.get(membershipKey(guildId, userId)) : null;
  return { ...serializeGuild({ ...guild, creator: memoryUsers.get(guild.creator) }, userId), joined: access?.joined || false, joinPending: access?.pending || false, canViewContent: access?.joined || false, viewerRole: access?.roleKey || null, permissions: access?.permissions || {}, roles: access?.permissions?.manageRoles ? await ensureGuildRoles(guildId) : [], viewerMembership: membership ? { guildProfile: membership.guildProfile || {}, contributionScore: Number(membership.contributionScore || 0), guildXp: Number(membership.guildXp || 0), streakDays: Number(membership.streakDays || 0), onboardingAnswers: membership.onboardingAnswers || [], onboardingCompletedAt: membership.onboardingCompletedAt } : null };
}

async function isGuildMember(guildId, userId) {
  return Boolean((await guildAccess(guildId, userId))?.joined);
}

export async function updateGuild(guildId, userId, values) {
  const access = await guildAccess(guildId, userId);
  if (!access?.permissions?.manageGuild) return null;
  if (connected) {
    const guild = await Guild.findByIdAndUpdate(guildId, values, { new: true, runValidators: true }).populate('creator', 'displayName handle avatarUrl');
    if (guild) await recordGuildAudit(guildId, userId, 'guild.settings.updated', { fields: Object.keys(values) });
    return guild ? serializeGuild(guild, userId) : null;
  }
  const guild = memoryGuilds.get(String(guildId));
  if (!guild) return null;
  Object.assign(guild, values, { updatedAt: new Date() });
  await recordGuildAudit(guildId, userId, 'guild.settings.updated', { fields: Object.keys(values) });
  return serializeGuild({ ...guild, creator: memoryUsers.get(guild.creator) }, userId);
}

export async function listGuildPosts(guildId, userId) {
  if (!(await isGuildMember(guildId, userId))) return null;
  if (connected) {
    const posts = await Post.find({ guild: guildId, draft: { $ne: true }, $or: [{ scheduledPublishedAt: null }, { scheduledPublishedAt: { $lte: new Date() } }] }).sort({ createdAt: -1 }).populate('author', 'displayName handle avatarUrl isAutomated automationPersona').lean();
    const counts = await Comment.aggregate([{ $match: { post: { $in: posts.map(post => post._id) } } }, { $group: { _id: '$post', count: { $sum: 1 } } }]);
    const countMap = new Map(counts.map(item => [String(item._id), item.count]));
    return posts.map(post => ({ ...serializePost(post, userId), commentCount: countMap.get(String(post._id)) || 0, author: post.author ? publicIdentity(post.author) : null }));
  }
  return [...memoryPosts.values()].filter(post => post.guild === String(guildId) && !post.draft && (!post.scheduledPublishedAt || new Date(post.scheduledPublishedAt) <= new Date())).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(post => ({ ...serializePost(post, userId), author: publicIdentity(memoryUsers.get(post.author)), commentCount: [...memoryComments.values()].filter(comment => comment.post === post.id).length }));
}

export async function createGuildPost(guildId, userId, values) {
  if (!(await guildAccess(guildId, userId))?.permissions?.createPosts) return null;
  const post = await createPost(userId, { ...values, guild: guildId });
  await addGuildProgress(guildId, userId, 10);
  return post;
}

async function addGuildProgress(guildId, userId, amount) {
  const today = new Date();
  if (connected) {
    const membership = await GuildMembership.findOne({ guild: guildId, user: userId });
    if (!membership) return;
    const previous = membership.lastActiveAt ? new Date(membership.lastActiveAt) : null;
    const dayGap = previous ? Math.floor((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - Date.UTC(previous.getUTCFullYear(), previous.getUTCMonth(), previous.getUTCDate())) / 86400000) : null;
    membership.streakDays = dayGap === 1 ? Number(membership.streakDays || 0) + 1 : dayGap === 0 ? Number(membership.streakDays || 0) : 1;
    membership.guildXp = Number(membership.guildXp || 0) + amount;
    membership.contributionScore = Number(membership.contributionScore || 0) + amount;
    membership.lastActiveAt = today;
    await membership.save();
    const guild = await Guild.findByIdAndUpdate(guildId, { $inc: { guildXp: amount } }, { new: true });
    if (guild) { guild.level = Math.max(1, Math.floor(Number(guild.guildXp || 0) / 250) + 1); await guild.save(); }
    return;
  }
  const membership = memoryGuildMemberships.get(membershipKey(guildId, userId));
  const guild = memoryGuilds.get(String(guildId));
  if (!membership || !guild) return;
  membership.guildXp = Number(membership.guildXp || 0) + amount; membership.contributionScore = Number(membership.contributionScore || 0) + amount; membership.streakDays = Math.max(1, Number(membership.streakDays || 0)); membership.lastActiveAt = today;
  guild.guildXp = Number(guild.guildXp || 0) + amount; guild.level = Math.max(1, Math.floor(guild.guildXp / 250) + 1);
}

const serializeGuildMessage = message => {
  const value = normalize(message);
  return { ...value, id: String(value._id || value.id), _id: undefined, guild: String(value.guild), sender: publicIdentity(value.sender) };
};

export async function listGuildMessages(guildId, userId) {
  if (!(await isGuildMember(guildId, userId))) return null;
  if (connected) return (await GuildMessage.find({ guild: guildId }).sort({ createdAt: 1 }).limit(250).populate('sender', 'displayName handle avatarUrl').lean()).map(serializeGuildMessage);
  return memoryGuildMessages.filter(item => item.guild === String(guildId)).map(item => serializeGuildMessage({ ...item, sender: memoryUsers.get(item.sender) }));
}

export async function createGuildMessage(guildId, userId, text) {
  if (!(await guildAccess(guildId, userId))?.permissions?.chat) return null;
  if (connected) { const message = serializeGuildMessage(await (await GuildMessage.create({ guild: guildId, sender: userId, text })).populate('sender', 'displayName handle avatarUrl')); await addGuildProgress(guildId, userId, 1); return message; }
  const message = { id: crypto.randomUUID(), guild: String(guildId), sender: String(userId), text, createdAt: new Date() };
  memoryGuildMessages.push(message);
  await addGuildProgress(guildId, userId, 1);
  return serializeGuildMessage({ ...message, sender: memoryUsers.get(String(userId)) });
}

export async function toggleGuildMembership(userId, guildId) {
  if (connected) {
    const guild = await Guild.findById(guildId).populate('creator', 'displayName handle avatarUrl');
    if (!guild) return null;
    const access = await guildAccess(guildId, userId);
    const joined = access?.joined;
    if (joined && String(guild.creator?._id || guild.creator) === String(userId)) return { guild: serializeGuild(guild, userId), owner: true };
    if (joined) {
      guild.members.pull(userId);
      await GuildMembership.deleteOne({ guild: guildId, user: userId });
      await recordGuildAudit(guildId, userId, 'member.left', {}, userId);
    } else {
      const pending = guild.privacy === 'private';
      await GuildMembership.findOneAndUpdate({ guild: guildId, user: userId }, { roleKey: 'chatter', status: pending ? 'pending' : 'active', joinedAt: new Date() }, { upsert: true, new: true });
      if (!pending) guild.members.push(userId);
      await recordGuildAudit(guildId, userId, pending ? 'member.join_requested' : 'member.joined', {}, userId);
    }
    await guild.save();
    if (!joined) await Notification.create({ recipient: userId, type: 'guild', guild: guild._id, text: guild.privacy === 'private' ? `Your request to join ${guild.name} was sent.` : `You joined ${guild.name}.` });
    return { guild: { ...serializeGuild(guild, userId), joinPending: !joined && guild.privacy === 'private' }, owner: false };
  }
  const guild = memoryGuilds.get(String(guildId));
  if (!guild) return null;
  const index = guild.members.indexOf(String(userId));
  if (index >= 0 && guild.creator === String(userId)) return { guild: serializeGuild({ ...guild, creator: memoryUsers.get(guild.creator) }, userId), owner: true };
  if (index >= 0) {
    guild.members.splice(index, 1);
    memoryGuildMemberships.delete(membershipKey(guildId, userId));
    await recordGuildAudit(guildId, userId, 'member.left', {}, userId);
  } else {
    const pending = guild.privacy === 'private';
    memoryGuildMemberships.set(membershipKey(guildId, userId), { guild: String(guildId), user: String(userId), roleKey: 'chatter', status: pending ? 'pending' : 'active', joinedAt: new Date() });
    if (!pending) guild.members.push(String(userId));
    await recordGuildAudit(guildId, userId, pending ? 'member.join_requested' : 'member.joined', {}, userId);
  }
  return { guild: { ...serializeGuild({ ...guild, creator: memoryUsers.get(guild.creator) }, userId), joinPending: index < 0 && guild.privacy === 'private' }, owner: false };
}

export async function joinGuildByInvite(userId, inviteCode) {
  const guild = connected ? await Guild.findOne({ inviteCode }) : [...memoryGuilds.values()].find(item => item.inviteCode === inviteCode);
  if (!guild) return null;
  const guildId = String(guild._id || guild.id);
  const existing = await guildAccess(guildId, userId);
  if (!existing?.joined) {
    if (connected) {
      await GuildMembership.findOneAndUpdate({ guild: guildId, user: userId }, { roleKey: 'chatter', status: 'active', joinedAt: new Date() }, { upsert: true });
      await Guild.findByIdAndUpdate(guildId, { $addToSet: { members: userId } });
    } else {
      memoryGuildMemberships.set(membershipKey(guildId, userId), { guild: guildId, user: String(userId), roleKey: 'chatter', status: 'active', joinedAt: new Date() });
      if (!guild.members.includes(String(userId))) guild.members.push(String(userId));
    }
    await recordGuildAudit(guildId, userId, 'member.joined_by_invite', {}, userId);
  }
  return getGuild(guildId, userId);
}

export async function listGuildMembers(guildId, userId) {
  const access = await guildAccess(guildId, userId);
  if (!access?.joined) return null;
  if (connected) {
    const guild = await Guild.findById(guildId).select('creator members createdAt').lean();
    if (guild) {
      await ensureGuildRoles(guildId);
      await Promise.all((guild.members || []).map(member => GuildMembership.updateOne({ guild: guildId, user: member }, { $setOnInsert: { guild: guildId, user: member, roleKey: String(member) === String(guild.creator) ? 'owner' : 'chatter', status: 'active', joinedAt: guild.createdAt || new Date() } }, { upsert: true })));
    }
    const memberships = await GuildMembership.find({ guild: guildId, ...(access.permissions.manageMembers ? {} : { status: 'active' }) }).populate('user', 'displayName handle avatarUrl status').sort({ status: 1, joinedAt: 1 }).lean();
    return memberships.map(item => ({ id: String(item._id), user: publicIdentity(item.user), roleKey: item.roleKey, status: item.status, joinedAt: item.joinedAt, guildProfile: item.guildProfile || {}, contributionScore: Number(item.contributionScore || 0), guildXp: Number(item.guildXp || 0), streakDays: Number(item.streakDays || 0) }));
  }
  return [...memoryGuildMemberships.values()].filter(item => item.guild === String(guildId) && (access.permissions.manageMembers || item.status === 'active')).map(item => ({ ...item, user: publicIdentity(memoryUsers.get(item.user)) }));
}

export async function updateGuildMember(guildId, actorId, targetUserId, values) {
  const access = await guildAccess(guildId, actorId);
  if (!access?.permissions?.manageMembers || String(targetUserId) === String(actorId)) return null;
  const roles = await ensureGuildRoles(guildId);
  if (values.roleKey && !roles.some(role => role.key === values.roleKey && role.key !== 'owner')) return null;
  if (connected) {
    const membership = await GuildMembership.findOneAndUpdate({ guild: guildId, user: targetUserId }, values, { new: true, runValidators: true });
    if (!membership) return null;
    if (values.status === 'active') await Guild.findByIdAndUpdate(guildId, { $addToSet: { members: targetUserId } });
    if (values.status === 'suspended') await Guild.findByIdAndUpdate(guildId, { $pull: { members: targetUserId } });
    await recordGuildAudit(guildId, actorId, values.roleKey ? 'member.role_changed' : 'member.status_changed', values, targetUserId);
    return membership.toObject();
  }
  const membership = memoryGuildMemberships.get(membershipKey(guildId, targetUserId));
  if (!membership) return null;
  Object.assign(membership, values);
  const guild = memoryGuilds.get(String(guildId));
  if (values.status === 'active' && !guild.members.includes(String(targetUserId))) guild.members.push(String(targetUserId));
  if (values.status === 'suspended') guild.members = guild.members.filter(id => id !== String(targetUserId));
  await recordGuildAudit(guildId, actorId, values.roleKey ? 'member.role_changed' : 'member.status_changed', values, targetUserId);
  return membership;
}

export async function updateGuildIdentity(guildId, userId, values) {
  const access = await guildAccess(guildId, userId);
  if (!access?.joined) return null;
  const guildProfile = { nickname: values.nickname, avatarUrl: values.avatarUrl, bannerUrl: values.bannerUrl, bio: values.bio, themeColor: values.themeColor, avatarFrame: values.avatarFrame };
  const update = { guildProfile, onboardingAnswers: values.onboardingAnswers || [], onboardingCompletedAt: values.onboardingAnswers?.length ? new Date() : null };
  if (connected) {
    const membership = await GuildMembership.findOneAndUpdate({ guild: guildId, user: userId }, update, { new: true, runValidators: true }).lean();
    if (membership) await recordGuildAudit(guildId, userId, 'member.guild_profile_updated', { fields: Object.keys(guildProfile) }, userId);
    return membership ? { ...membership, id: String(membership._id), _id: undefined } : null;
  }
  const membership = memoryGuildMemberships.get(membershipKey(guildId, userId));
  if (!membership) return null;
  Object.assign(membership, update, { updatedAt: new Date() });
  await recordGuildAudit(guildId, userId, 'member.guild_profile_updated', { fields: Object.keys(guildProfile) }, userId);
  return membership;
}

export async function updateGuildRole(guildId, userId, roleKey, values) {
  const access = await guildAccess(guildId, userId);
  if (!access?.permissions?.manageRoles || roleKey === 'owner') return null;
  const allowed = ['manageGuild', 'manageRoles', 'manageMembers', 'managePosts', 'createPosts', 'chat', 'viewAudit'];
  const safePermissions = Object.fromEntries(Object.entries(values.permissions || {}).filter(([key]) => allowed.includes(key)));
  const cosmetics = Object.fromEntries(Object.entries({ name: values.name, color: values.color, icon: values.icon }).filter(([, value]) => value !== undefined));
  let role;
  if (connected) role = await GuildRole.findOneAndUpdate({ guild: guildId, key: roleKey }, { permissions: safePermissions, ...cosmetics }, { new: true, runValidators: true }).lean();
  else {
    role = (await ensureGuildRoles(guildId)).find(item => item.key === roleKey);
    if (role) Object.assign(role, cosmetics, { permissions: { ...role.permissions, ...safePermissions } });
  }
  if (role) await recordGuildAudit(guildId, userId, 'role.updated', { roleKey, permissions: safePermissions, ...cosmetics });
  return role;
}

export async function listGuildAudit(guildId, userId) {
  const access = await guildAccess(guildId, userId);
  if (!access?.permissions?.viewAudit) return null;
  if (connected) return (await GuildAudit.find({ guild: guildId }).sort({ createdAt: -1 }).limit(200).populate('actor targetUser', 'displayName handle avatarUrl').lean()).map(item => ({ ...item, id: String(item._id), actor: publicIdentity(item.actor), targetUser: publicIdentity(item.targetUser), _id: undefined }));
  return memoryGuildAudits.filter(item => item.guild === String(guildId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(item => ({ ...item, actor: publicIdentity(memoryUsers.get(item.actor)), targetUser: publicIdentity(memoryUsers.get(item.targetUser)) }));
}

export async function listLeaderboard(period = 'all') {
  const cutoff = period === 'weekly' ? new Date(Date.now() - 7 * 86400000) : period === 'monthly' ? new Date(Date.now() - 30 * 86400000) : null;
  if (connected) {
    const [users, scores] = await Promise.all([
      User.find({ isAutomated: { $ne: true } }).select('displayName handle avatarUrl isAutomated automationPersona vibeScore postCount createdAt').lean(),
      Post.aggregate([
        { $project: { author: 1, cringeScore: { $size: { $filter: { input: { $ifNull: ['$votes', []] }, as: 'vote', cond: { $and: [{ $eq: ['$$vote.value', 'cringe'] }, { $ne: ['$$vote.user', '$author'] }, ...(cutoff ? [{ $gte: ['$$vote.createdAt', cutoff] }] : [])] } } } } } },
        { $group: { _id: '$author', cringeScore: { $sum: '$cringeScore' } } }
      ])
    ]);
    const scoreMap = new Map(scores.map(item => [String(item._id), Number(item.cringeScore || 0)]));
    return users.map(user => ({ ...publicIdentity(user), cringeScore: scoreMap.get(String(user._id)) || 0 }))
      .sort((a, b) => b.cringeScore - a.cringeScore || b.vibeScore - a.vibeScore || new Date(a.createdAt) - new Date(b.createdAt))
      .map((user, index) => ({ ...user, rank: index + 1, cringeBadge: cringeBadge(index + 1, user.cringeScore) }));
  }
  const scoreMap = new Map();
  for (const post of memoryPosts.values()) scoreMap.set(post.author, (scoreMap.get(post.author) || 0) + (post.votes || []).filter(vote => vote.value === 'cringe' && vote.user !== post.author && (!cutoff || vote.createdAt && new Date(vote.createdAt) >= cutoff)).length);
  return [...memoryUsers.values()].filter(user => !user.isAutomated).map(user => ({ ...publicIdentity(user), cringeScore: scoreMap.get(user.id) || 0 }))
    .sort((a, b) => b.cringeScore - a.cringeScore || b.vibeScore - a.vibeScore || new Date(a.createdAt) - new Date(b.createdAt))
    .map((user, index) => ({ ...user, rank: index + 1, cringeBadge: cringeBadge(index + 1, user.cringeScore) }));
}

function cringeBadge(rank, score) {
  if (rank === 1 && score > 0) return { name: 'Cringe Crown', icon: '♛' };
  if (rank <= 3 && score > 0) return { name: 'Podium Menace', icon: '🔥' };
  if (rank <= 10 && score > 0) return { name: 'Top Ten Take', icon: '⚡' };
  if (score > 0) return { name: 'Cringe Contender', icon: '◆' };
  return { name: 'Fresh Face', icon: '◇' };
}

export async function searchCallout(query) {
  const escaped = String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');
  if (connected) {
    const [users, posts, guilds] = await Promise.all([
      User.find({ $or: [{ displayName: regex }, { handle: regex }] }).select('displayName handle avatarUrl isAutomated automationPersona vibeScore points').limit(8).lean(),
      Post.find({ content: regex, guild: null }).populate('author', 'displayName handle avatarUrl isAutomated automationPersona').sort({ createdAt: -1 }).limit(8).lean(),
      Guild.find({ $or: [{ name: regex }, { description: regex }] }).limit(8).lean()
    ]);
    return { users: users.map(publicIdentity), posts: posts.map(post => ({ ...serializePost(post), author: post.author ? publicIdentity(post.author) : null })), guilds: guilds.map(serializeGuild) };
  }
  return {
    users: [...memoryUsers.values()].filter(user => regex.test(user.displayName) || regex.test(user.handle)).slice(0, 8).map(publicIdentity),
    posts: [...memoryPosts.values()].filter(post => !post.guild && regex.test(post.content)).slice(0, 8).map(post => serializePost(post)),
    guilds: [...memoryGuilds.values()].filter(guild => regex.test(guild.name) || regex.test(guild.description)).slice(0, 8).map(serializeGuild)
  };
}

export async function listNotifications(userId) {
  const categoryFor = type => ({ vote: 'likes', comment: 'comments', reply: 'comments', guild: 'guild_activity', guild_invite: 'guild_activity', friend_request: 'follows', friend_accept: 'follows', message: 'dms', system: 'system' }[type] || 'system');
  const now = new Date();
  const mutes = connected ? await NotificationMute.find({ user: userId }).lean() : memoryNotificationMutes.filter(item => item.user === String(userId));
  const hidden = item => mutes.some(mute => {
    if (mute.snoozedUntil && new Date(mute.snoozedUntil) <= now) return false;
    if (mute.scopeType === 'category') return mute.scopeId === categoryFor(item.type);
    if (mute.scopeType === 'user') return mute.scopeId === String(item.actor?._id || item.actor?.id || item.actor || '');
    if (mute.scopeType === 'guild') return mute.scopeId === String(item.guild?._id || item.guild || '');
    return false;
  });
  if (connected) return (await Notification.find({ recipient: userId }).sort({ createdAt: -1 }).limit(100).populate('actor', 'displayName handle avatarUrl isAutomated automationPersona').lean()).filter(item => !hidden(item)).map(item => ({ ...item, id: String(item._id), _id: undefined, category: categoryFor(item.type), actor: item.actor ? publicIdentity(item.actor) : null, post: item.post ? String(item.post) : null, guild: item.guild ? String(item.guild) : null }));
  return memoryNotifications.filter(item => item.recipient === String(userId) && !hidden(item)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(item => ({ ...item, category: categoryFor(item.type), actor: publicIdentity(item.actor) }));
}

export async function markNotificationsRead(userId) {
  if (connected) await Notification.updateMany({ recipient: userId, read: false }, { read: true });
  else memoryNotifications.filter(item => item.recipient === String(userId)).forEach(item => { item.read = true; });
}

export async function listNotificationMutes(userId) {
  if (connected) return (await NotificationMute.find({ user: userId }).sort({ createdAt: -1 }).lean()).map(item => ({ ...item, id: String(item._id), _id: undefined, user: undefined }));
  return memoryNotificationMutes.filter(item => item.user === String(userId)).map(({ user, ...item }) => item);
}

export async function setNotificationMute(userId, values) {
  if (connected) {
    const mute = await NotificationMute.findOneAndUpdate({ user: userId, scopeType: values.scopeType, scopeId: values.scopeId }, { ...values, user: userId }, { upsert: true, new: true, runValidators: true }).lean();
    return { ...mute, id: String(mute._id), _id: undefined, user: undefined };
  }
  const index = memoryNotificationMutes.findIndex(item => item.user === String(userId) && item.scopeType === values.scopeType && item.scopeId === values.scopeId);
  const mute = { id: index >= 0 ? memoryNotificationMutes[index].id : crypto.randomUUID(), user: String(userId), ...values, createdAt: index >= 0 ? memoryNotificationMutes[index].createdAt : new Date(), updatedAt: new Date() };
  if (index >= 0) memoryNotificationMutes[index] = mute; else memoryNotificationMutes.push(mute);
  const { user, ...safe } = mute;
  return safe;
}

export async function deleteNotificationMute(userId, muteId) {
  if (connected) return Boolean(await NotificationMute.findOneAndDelete({ _id: muteId, user: userId }));
  const index = memoryNotificationMutes.findIndex(item => item.id === String(muteId) && item.user === String(userId));
  if (index < 0) return false;
  memoryNotificationMutes.splice(index, 1);
  return true;
}

export async function createMessage(senderId, recipientQuery, text) {
  const query = String(recipientQuery);
  const recipient = query.startsWith('@')
    ? (connected ? await User.findOne({ handle: query.toLowerCase() }) : [...memoryUsers.values()].find(user => user.handle === query.toLowerCase()))
    : (/^(?:[a-f\d]{24}|[a-f\d-]{36})$/i.test(query) ? await findUserById(query) : await findUserByEmail(query));
  if (!recipient) return null;
  const recipientId = String(recipient._id || recipient.id);
  if (recipientId === String(senderId)) return { forbidden: true, reason: 'You cannot message yourself.' };
  if (recipient.preferences?.directMessages === 'nobody') return { forbidden: true, reason: 'This user is not accepting direct messages.' };
  if (recipient.preferences?.directMessages === 'guilds') {
    const shared = connected
      ? await Guild.exists({ members: { $all: [senderId, recipientId] } })
      : [...memoryGuilds.values()].some(guild => guild.members.includes(String(senderId)) && guild.members.includes(recipientId));
    if (!shared) return { forbidden: true, reason: 'Direct messages are limited to shared guild members.' };
  }
  if (connected) {
    const message = await Message.create({ sender: senderId, recipient: recipientId, text });
    await Notification.create({ recipient: recipientId, actor: senderId, type: 'message', text: 'You received a new direct message.' });
    return serializeMessage(await message.populate([{ path: 'sender', select: 'displayName handle avatarUrl' }, { path: 'recipient', select: 'displayName handle avatarUrl' }]));
  }
  const message = { id: crypto.randomUUID(), sender: String(senderId), recipient: recipientId, text, read: false, createdAt: new Date() };
  memoryMessages.push(message);
  memoryNotifications.push({ id: crypto.randomUUID(), recipient: recipientId, actor: publicUser(memoryUsers.get(String(senderId))), type: 'message', text: 'You received a new direct message.', read: false, createdAt: new Date() });
  return serializeMessage({ ...message, sender: memoryUsers.get(String(senderId)), recipient: memoryUsers.get(recipientId) });
}

const serializeMessage = message => {
  const value = normalize(message);
  return { ...value, id: String(value._id || value.id), _id: undefined, sender: publicIdentity(value.sender), recipient: publicIdentity(value.recipient) };
};

export async function listMessages(userId) {
  if (connected) return (await Message.find({ $or: [{ sender: userId }, { recipient: userId }] }).sort({ createdAt: 1 }).limit(500).populate([{ path: 'sender', select: 'displayName handle avatarUrl' }, { path: 'recipient', select: 'displayName handle avatarUrl' }]).lean()).map(serializeMessage);
  return memoryMessages.filter(message => message.sender === String(userId) || message.recipient === String(userId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(message => serializeMessage({ ...message, sender: memoryUsers.get(message.sender), recipient: memoryUsers.get(message.recipient) }));
}

const pairKey = (a, b) => [String(a), String(b)].sort().join(':');
const serializeFriendship = friendship => {
  const value = normalize(friendship);
  return { ...value, id: String(value._id || value.id), _id: undefined, requester: publicIdentity(value.requester), recipient: publicIdentity(value.recipient) };
};

export async function createFriendRequest(requesterId, recipientId) {
  if (String(requesterId) === String(recipientId) || !(await findUserById(recipientId))) return null;
  const key = pairKey(requesterId, recipientId);
  if (connected) {
    const existing = await Friendship.findOne({ pairKey: key });
    if (existing) {
      if (existing.status === 'pending' && String(existing.requester) === String(recipientId)) { existing.status = 'accepted'; await existing.save(); await Notification.create({ recipient: recipientId, actor: requesterId, type: 'friend_accept', text: 'Your friend request was accepted.' }); }
      return serializeFriendship(await existing.populate([{ path: 'requester', select: 'displayName handle avatarUrl' }, { path: 'recipient', select: 'displayName handle avatarUrl' }]));
    }
    const friendship = await Friendship.create({ requester: requesterId, recipient: recipientId, pairKey: key });
    await Notification.create({ recipient: recipientId, actor: requesterId, type: 'friend_request', text: 'You received a friend request.' });
    return serializeFriendship(await friendship.populate([{ path: 'requester', select: 'displayName handle avatarUrl' }, { path: 'recipient', select: 'displayName handle avatarUrl' }]));
  }
  let existing = memoryFriendships.find(item => item.pairKey === key);
  if (!existing) { existing = { id: crypto.randomUUID(), requester: String(requesterId), recipient: String(recipientId), pairKey: key, status: 'pending', createdAt: new Date() }; memoryFriendships.push(existing); memoryNotifications.push({ id: crypto.randomUUID(), recipient: String(recipientId), actor: publicUser(memoryUsers.get(String(requesterId))), type: 'friend_request', text: 'You received a friend request.', read: false, createdAt: new Date() }); }
  else if (existing.status === 'pending' && existing.requester === String(recipientId)) existing.status = 'accepted';
  return serializeFriendship({ ...existing, requester: memoryUsers.get(existing.requester), recipient: memoryUsers.get(existing.recipient) });
}

export async function acceptFriendRequest(friendshipId, userId) {
  if (connected) {
    const friendship = await Friendship.findOneAndUpdate({ _id: friendshipId, recipient: userId, status: 'pending' }, { status: 'accepted' }, { new: true }).populate([{ path: 'requester', select: 'displayName handle avatarUrl' }, { path: 'recipient', select: 'displayName handle avatarUrl' }]);
    if (friendship) await Notification.create({ recipient: friendship.requester._id, actor: userId, type: 'friend_accept', text: 'Your friend request was accepted.' });
    return friendship ? serializeFriendship(friendship) : null;
  }
  const friendship = memoryFriendships.find(item => item.id === String(friendshipId) && item.recipient === String(userId) && item.status === 'pending');
  if (!friendship) return null; friendship.status = 'accepted';
  return serializeFriendship({ ...friendship, requester: memoryUsers.get(friendship.requester), recipient: memoryUsers.get(friendship.recipient) });
}

export async function listFriends(userId) {
  if (connected) {
    const rows = await Friendship.find({ $or: [{ requester: userId }, { recipient: userId }] }).sort({ updatedAt: -1 }).populate([{ path: 'requester', select: 'displayName handle avatarUrl' }, { path: 'recipient', select: 'displayName handle avatarUrl' }]).lean();
    return rows.map(serializeFriendship);
  }
  return memoryFriendships.filter(item => item.requester === String(userId) || item.recipient === String(userId)).map(item => serializeFriendship({ ...item, requester: memoryUsers.get(item.requester), recipient: memoryUsers.get(item.recipient) }));
}

export async function getPublicProfile(profileId, viewerId = '') {
  const user = await findUserById(profileId);
  if (!user) return null;
  const account = publicUser(user);
  let posts;
  let guilds;
  let commentCount;
  if (connected) {
    [posts, guilds, commentCount] = await Promise.all([
      Post.find({ author: profileId, guild: null, draft: { $ne: true }, visibility: { $in: ['public', null] } }).sort({ createdAt: -1 }).limit(50).lean(),
      Guild.find({ members: profileId }).sort({ createdAt: -1 }).limit(20).lean(),
      Comment.countDocuments({ author: profileId })
    ]);
  } else {
    posts = [...memoryPosts.values()].filter(post => post.author === String(profileId) && !post.guild && !post.draft && (post.visibility || 'public') === 'public').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
    guilds = [...memoryGuilds.values()].filter(guild => guild.members.includes(String(profileId))).slice(0, 20);
    commentCount = [...memoryComments.values()].filter(comment => comment.author === String(profileId)).length;
  }
  const serializedPosts = posts.map(post => serializePost(post, viewerId));
  const featuredIds = new Set((account.featuredPosts || []).map(String));
  const profile = {
    id: account.id, displayName: account.displayName, handle: account.handle, avatarUrl: account.avatarUrl, bannerUrl: account.bannerUrl, isAutomated: Boolean(account.isAutomated), automationPersona: account.automationPersona || '',
    themeColor: account.themeColor, avatarFrame: account.avatarFrame || 'none', profileEffect: account.profileEffect || 'none', vibeAura: account.vibeAura || 'auto', profileBackground: account.profileBackground || 'clean', profileLayout: account.profileLayout?.length ? account.profileLayout : ['posts', 'about', 'guilds', 'achievements', 'media', 'trophies'], showcaseMode: account.showcaseMode || 'featured', featuredBadges: account.featuredBadges || [], cosmeticUnlocks: account.cosmeticUnlocks, bio: account.bio, socialLinks: account.socialLinks, pronouns: account.pronouns,
    status: account.status, vibeScore: account.vibeScore, vibeBadges: account.vibeBadges, createdAt: account.createdAt,
    stats: { posts: serializedPosts.length, comments: commentCount, guilds: guilds.length },
    posts: serializedPosts, media: serializedPosts.filter(post => post.media?.length),
    featuredPosts: serializedPosts.filter(post => featuredIds.has(post.id)),
    guilds: guilds.map(guild => serializeGuild(guild, viewerId)),
    pinnedGuilds: guilds.filter(guild => (account.pinnedGuilds || []).some(id => String(id) === String(guild._id || guild.id))).map(guild => serializeGuild(guild, viewerId))
  };
  if (!viewerId || String(profileId) === String(viewerId)) return { ...profile, friendship: String(profileId) === String(viewerId) ? 'self' : 'none' };
  const key = pairKey(profileId, viewerId);
  const friendship = connected ? await Friendship.findOne({ pairKey: key }).lean() : memoryFriendships.find(item => item.pairKey === key);
  return { ...profile, friendship: friendship?.status || 'none', friendshipId: friendship ? String(friendship._id || friendship.id) : null, requestIncoming: friendship?.status === 'pending' && String(friendship.recipient) === String(viewerId) };
}

export async function createReport(reporterId, postId, values) {
  if (connected) return Report.create({ reporter: reporterId, post: postId, ...values });
  const report = { id: crypto.randomUUID(), reporter: String(reporterId), post: String(postId), status: 'open', createdAt: new Date(), ...values };
  memoryReports.push(report);
  console.info('Report recorded in development store:', { id: report.id, post: report.post, reason: report.reason });
  return report;
}
