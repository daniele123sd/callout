import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { User } from './models/User.mjs';
import { Post } from './models/Post.mjs';
import { Report } from './models/Report.mjs';

let connected = false;
const memoryUsers = new Map();
const memoryPosts = new Map();
const memoryReports = [];

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
  delete safe._id;
  delete safe.__v;
  return safe;
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
  const user = { id: crypto.randomUUID(), vibeScore: 0, avatarUrl: '', bio: '', bannerUrl: '', themeColor: '#ff4713', socialLinks: {}, pronouns: '', status: 'online', preferences: {}, createdAt: now, updatedAt: now, ...userValues };
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
  if (connected) return Post.create({ author: authorId, ...values });
  const post = { id: crypto.randomUUID(), author: String(authorId), alrightVotes: 0, cringeVotes: 0, createdAt: new Date(), updatedAt: new Date(), ...values };
  memoryPosts.set(post.id, post);
  return post;
}

export async function listPosts() {
  if (connected) {
    const posts = await Post.find().sort({ createdAt: -1 }).populate('author', 'displayName handle avatarUrl').lean().exec();
    return posts.map(post => ({
      ...post,
      id: String(post._id),
      _id: undefined,
      author: post.author ? { ...post.author, id: String(post.author._id), _id: undefined } : null
    }));
  }
  return [...memoryPosts.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(post => ({
    ...post,
    author: publicUser(memoryUsers.get(String(post.author)))
  }));
}

export async function updatePost(postId, authorId, values) {
  if (connected) return Post.findOneAndUpdate({ _id: postId, author: authorId }, values, { new: true, runValidators: true }).exec();
  const post = memoryPosts.get(String(postId));
  if (!post || post.author !== String(authorId)) return null;
  Object.assign(post, values, { updatedAt: new Date() });
  return post;
}

export async function deletePost(postId, authorId) {
  if (connected) return Post.findOneAndDelete({ _id: postId, author: authorId }).exec();
  const post = memoryPosts.get(String(postId));
  if (!post || post.author !== String(authorId)) return null;
  memoryPosts.delete(String(postId));
  return post;
}

export async function createReport(reporterId, postId, values) {
  if (connected) return Report.create({ reporter: reporterId, post: postId, ...values });
  const report = { id: crypto.randomUUID(), reporter: String(reporterId), post: String(postId), status: 'open', createdAt: new Date(), ...values };
  memoryReports.push(report);
  console.info('Report recorded in development store:', { id: report.id, post: report.post, reason: report.reason });
  return report;
}
