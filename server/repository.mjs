import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { User } from './models/User.mjs';
import { Post } from './models/Post.mjs';
import { Report } from './models/Report.mjs';
import { Comment } from './models/Comment.mjs';
import { Guild } from './models/Guild.mjs';
import { Notification } from './models/Notification.mjs';
import { Message } from './models/Message.mjs';

let connected = false;
const memoryUsers = new Map();
const memoryPosts = new Map();
const memoryReports = [];
const memoryComments = new Map();
const memoryGuilds = new Map();
const memoryNotifications = [];
const memoryMessages = [];

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
  const { password, refreshTokenHash, passwordResetHash, passwordResetExpiresAt, ...safe } = value;
  safe.id = String(safe._id || safe.id);
  safe.vibeScore = Number(safe.vibeScore || 0);
  safe.cringeScore = Number(safe.cringeScore || 0);
  safe.vibeBadges = vibeBadges(safe.vibeScore);
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

async function incrementVibe(userId, amount) {
  if (connected) return User.findByIdAndUpdate(userId, { $inc: { vibeScore: amount } }, { new: true }).exec();
  const user = memoryUsers.get(String(userId));
  if (user) user.vibeScore = Math.max(0, Number(user.vibeScore || 0) + amount);
  return user || null;
}

export async function findUserByEmail(email, secrets = false) {
  if (connected) {
    let query = User.findOne({ email: email.toLowerCase() });
    if (secrets) query = query.select('+password +refreshTokenHash +passwordResetHash +passwordResetExpiresAt');
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
    if (secrets) query = query.select('+password +refreshTokenHash +passwordResetHash +passwordResetExpiresAt');
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
  const user = { id: crypto.randomUUID(), vibeScore: 0, cringeScore: 0, points: 0, postCount: 0, savedPosts: [], avatarUrl: '', bio: '', bannerUrl: '', themeColor: '#ff4713', socialLinks: {}, pronouns: '', status: 'online', preferences: {}, createdAt: now, updatedAt: now, ...userValues };
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
  if (connected) {
    const post = await Post.create({ author: authorId, ...values });
    await User.findByIdAndUpdate(authorId, { $inc: { points: 10, vibeScore: 10, postCount: 1 } });
    return post;
  }
  const post = { id: crypto.randomUUID(), author: String(authorId), alrightVotes: 0, cringeVotes: 0, impressions: 0, votes: [], createdAt: new Date(), updatedAt: new Date(), ...values };
  memoryPosts.set(post.id, post);
  const user = memoryUsers.get(String(authorId));
  if (user) { user.points = (user.points || 0) + 10; user.vibeScore = (user.vibeScore || 0) + 10; user.postCount = (user.postCount || 0) + 1; }
  return post;
}

const serializePost = (post, userId = '') => {
  const value = normalize(post);
  const votes = value.votes || [];
  const userVote = votes.find(vote => String(vote.user?._id || vote.user) === String(userId))?.value || null;
  return { ...value, id: String(value._id || value.id), _id: undefined, votes: undefined, userVote };
};

export async function listPosts(userId = '', { trending = false } = {}) {
  if (connected) {
    const sort = trending ? { impressions: -1, alrightVotes: -1, cringeVotes: -1, createdAt: -1 } : { createdAt: -1 };
    const posts = await Post.find().sort(sort).populate('author', 'displayName handle avatarUrl').lean().exec();
    const counts = await Comment.aggregate([{ $group: { _id: '$post', count: { $sum: 1 } } }]);
    const countMap = new Map(counts.map(item => [String(item._id), item.count]));
    return posts.map(post => ({
      ...serializePost(post, userId),
      commentCount: countMap.get(String(post._id)) || 0,
      author: post.author ? { ...post.author, id: String(post.author._id), _id: undefined } : null
    }));
  }
  return [...memoryPosts.values()].sort((a, b) => trending ? ((b.impressions || 0) - (a.impressions || 0) || new Date(b.createdAt) - new Date(a.createdAt)) : new Date(b.createdAt) - new Date(a.createdAt)).map(post => ({
    ...serializePost(post, userId), commentCount: [...memoryComments.values()].filter(comment => comment.post === post.id).length,
    author: publicUser(memoryUsers.get(String(post.author)))
  }));
}

export async function recordPostView(postId) {
  if (connected) return Post.findByIdAndUpdate(postId, { $inc: { impressions: 1 } }, { new: true }).exec();
  const post = memoryPosts.get(String(postId));
  if (post) post.impressions = (post.impressions || 0) + 1;
  return post || null;
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
  else post.votes.push({ user: String(userId), value });
  post.alrightVotes = post.votes.filter(vote => vote.value === 'alright').length;
  post.cringeVotes = post.votes.filter(vote => vote.value === 'cringe').length;
  post.impressions += 1;
  if (!previousValue) await incrementVibe(userId, 1);
  if (post.author !== String(userId) && previousValue !== value) memoryNotifications.push({ id: crypto.randomUUID(), recipient: post.author, actor: publicUser(memoryUsers.get(String(userId))), type: 'vote', post: post.id, text: `Someone voted ${value === 'alright' ? 'Alright' : 'Cringe'} on your take.`, read: false, createdAt: new Date() });
  return serializePost(post, userId);
}

const serializeComment = (comment, userId = '') => {
  const value = normalize(comment);
  const author = value.author ? { ...value.author, id: String(value.author._id || value.author.id), _id: undefined } : null;
  return { ...value, id: String(value._id || value.id), _id: undefined, post: String(value.post), parent: value.parent ? String(value.parent) : null, author, votes: value.upvotes?.length || 0, upvoted: (value.upvotes || []).some(id => String(id) === String(userId)), upvotes: undefined, replies: [] };
};

export async function listComments(postId, userId = '') {
  const flat = connected
    ? (await Comment.find({ post: postId }).sort({ createdAt: 1 }).populate('author', 'displayName handle avatarUrl').lean().exec()).map(comment => serializeComment(comment, userId))
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
    return serializeComment(await comment.populate('author', 'displayName handle avatarUrl'), authorId);
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
    const comment = await Comment.findById(commentId).populate('author', 'displayName handle avatarUrl');
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
  const creator = value.creator && typeof value.creator === 'object' ? publicUser(value.creator) : (value.creator ? { id: String(value.creator) } : null);
  return { ...value, id: String(value._id || value.id), _id: undefined, creator, memberCount: members.length, joined: members.some(member => String(member._id || member) === String(userId)), members: undefined };
};

export async function listGuilds(userId = '') {
  if (connected) return (await Guild.find().sort({ createdAt: -1 }).populate('creator', 'displayName handle avatarUrl').lean()).map(guild => serializeGuild(guild, userId));
  return [...memoryGuilds.values()].map(guild => serializeGuild({ ...guild, creator: memoryUsers.get(guild.creator) }, userId));
}

export async function createGuild(userId, values) {
  if (connected) return serializeGuild(await (await Guild.create({ ...values, creator: userId, members: [userId] })).populate('creator', 'displayName handle avatarUrl'), userId);
  const guild = { id: crypto.randomUUID(), creator: String(userId), members: [String(userId)], createdAt: new Date(), ...values };
  memoryGuilds.set(guild.id, guild);
  return serializeGuild({ ...guild, creator: memoryUsers.get(String(userId)) }, userId);
}

export async function toggleGuildMembership(userId, guildId) {
  if (connected) {
    const guild = await Guild.findById(guildId).populate('creator', 'displayName handle avatarUrl');
    if (!guild) return null;
    const joined = guild.members.some(member => String(member) === String(userId));
    if (joined && String(guild.creator?._id || guild.creator) === String(userId)) return { guild: serializeGuild(guild, userId), owner: true };
    if (joined) guild.members.pull(userId); else guild.members.push(userId);
    await guild.save();
    if (!joined) await Notification.create({ recipient: userId, type: 'guild', guild: guild._id, text: `You joined ${guild.name}.` });
    return { guild: serializeGuild(guild, userId), owner: false };
  }
  const guild = memoryGuilds.get(String(guildId));
  if (!guild) return null;
  const index = guild.members.indexOf(String(userId));
  if (index >= 0 && guild.creator === String(userId)) return { guild: serializeGuild({ ...guild, creator: memoryUsers.get(guild.creator) }, userId), owner: true };
  if (index >= 0) guild.members.splice(index, 1); else guild.members.push(String(userId));
  return { guild: serializeGuild({ ...guild, creator: memoryUsers.get(guild.creator) }, userId), owner: false };
}

export async function listLeaderboard() {
  if (connected) {
    const [users, scores] = await Promise.all([
      User.find().select('displayName handle avatarUrl vibeScore postCount createdAt').lean(),
      Post.aggregate([
        { $project: { author: 1, cringeScore: { $size: { $filter: { input: { $ifNull: ['$votes', []] }, as: 'vote', cond: { $and: [{ $eq: ['$$vote.value', 'cringe'] }, { $ne: ['$$vote.user', '$author'] }] } } } } } },
        { $group: { _id: '$author', cringeScore: { $sum: '$cringeScore' } } }
      ])
    ]);
    const scoreMap = new Map(scores.map(item => [String(item._id), Number(item.cringeScore || 0)]));
    return users.map(user => ({ ...publicUser(user), cringeScore: scoreMap.get(String(user._id)) || 0 }))
      .sort((a, b) => b.cringeScore - a.cringeScore || b.vibeScore - a.vibeScore || new Date(a.createdAt) - new Date(b.createdAt))
      .map((user, index) => ({ ...user, rank: index + 1, cringeBadge: cringeBadge(index + 1, user.cringeScore) }));
  }
  const scoreMap = new Map();
  for (const post of memoryPosts.values()) scoreMap.set(post.author, (scoreMap.get(post.author) || 0) + (post.votes || []).filter(vote => vote.value === 'cringe' && vote.user !== post.author).length);
  return [...memoryUsers.values()].map(user => ({ ...publicUser(user), cringeScore: scoreMap.get(user.id) || 0 }))
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
      User.find({ $or: [{ displayName: regex }, { handle: regex }] }).select('displayName handle avatarUrl vibeScore points').limit(8).lean(),
      Post.find({ content: regex }).populate('author', 'displayName handle avatarUrl').sort({ createdAt: -1 }).limit(8).lean(),
      Guild.find({ $or: [{ name: regex }, { description: regex }] }).limit(8).lean()
    ]);
    return { users: users.map(publicUser), posts: posts.map(post => ({ ...serializePost(post), author: post.author ? publicUser(post.author) : null })), guilds: guilds.map(serializeGuild) };
  }
  return {
    users: [...memoryUsers.values()].filter(user => regex.test(user.displayName) || regex.test(user.handle)).slice(0, 8).map(publicUser),
    posts: [...memoryPosts.values()].filter(post => regex.test(post.content)).slice(0, 8).map(post => serializePost(post)),
    guilds: [...memoryGuilds.values()].filter(guild => regex.test(guild.name) || regex.test(guild.description)).slice(0, 8).map(serializeGuild)
  };
}

export async function listNotifications(userId) {
  if (connected) return (await Notification.find({ recipient: userId }).sort({ createdAt: -1 }).limit(100).populate('actor', 'displayName handle avatarUrl').lean()).map(item => ({ ...item, id: String(item._id), _id: undefined, actor: item.actor ? publicUser(item.actor) : null, post: item.post ? String(item.post) : null, guild: item.guild ? String(item.guild) : null }));
  return memoryNotifications.filter(item => item.recipient === String(userId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function markNotificationsRead(userId) {
  if (connected) await Notification.updateMany({ recipient: userId, read: false }, { read: true });
  else memoryNotifications.filter(item => item.recipient === String(userId)).forEach(item => { item.read = true; });
}

export async function createMessage(senderId, recipientQuery, text) {
  const recipient = recipientQuery.startsWith('@')
    ? (connected ? await User.findOne({ handle: recipientQuery.toLowerCase() }) : [...memoryUsers.values()].find(user => user.handle === recipientQuery.toLowerCase()))
    : await findUserByEmail(recipientQuery);
  if (!recipient) return null;
  const recipientId = String(recipient._id || recipient.id);
  if (connected) return serializeMessage(await (await Message.create({ sender: senderId, recipient: recipientId, text })).populate([{ path: 'sender', select: 'displayName handle avatarUrl' }, { path: 'recipient', select: 'displayName handle avatarUrl' }]));
  const message = { id: crypto.randomUUID(), sender: String(senderId), recipient: recipientId, text, read: false, createdAt: new Date() };
  memoryMessages.push(message);
  return serializeMessage({ ...message, sender: memoryUsers.get(String(senderId)), recipient: memoryUsers.get(recipientId) });
}

const serializeMessage = message => {
  const value = normalize(message);
  return { ...value, id: String(value._id || value.id), _id: undefined, sender: publicUser(value.sender), recipient: publicUser(value.recipient) };
};

export async function listMessages(userId) {
  if (connected) return (await Message.find({ $or: [{ sender: userId }, { recipient: userId }] }).sort({ createdAt: -1 }).limit(100).populate([{ path: 'sender', select: 'displayName handle avatarUrl' }, { path: 'recipient', select: 'displayName handle avatarUrl' }]).lean()).map(serializeMessage);
  return memoryMessages.filter(message => message.sender === String(userId) || message.recipient === String(userId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(message => serializeMessage({ ...message, sender: memoryUsers.get(message.sender), recipient: memoryUsers.get(message.recipient) }));
}

export async function createReport(reporterId, postId, values) {
  if (connected) return Report.create({ reporter: reporterId, post: postId, ...values });
  const report = { id: crypto.randomUUID(), reporter: String(reporterId), post: String(postId), status: 'open', createdAt: new Date(), ...values };
  memoryReports.push(report);
  console.info('Report recorded in development store:', { id: report.id, post: report.post, reason: report.reason });
  return report;
}
