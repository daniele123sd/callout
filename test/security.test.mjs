import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { BCRYPT_ROUNDS, hashPassword, sanitizePlainText, schemas, signAccessToken, signRefreshToken, verifyRefreshToken } from '../server/security.mjs';
import { createPost, createUser, listPosts } from '../server/repository.mjs';
import { User } from '../server/models/User.mjs';

test('plain-text sanitizer removes executable markup and control characters', () => {
  assert.equal(sanitizePlainText('<script>alert(1)</script><b>Safe</b>\u0000'), 'Safe');
});

test('signup validation enforces the 13+ confirmation', () => {
  const result = schemas.signup.validate({ email: 'person@example.com', password: 'SecurePass123!', displayName: 'Person', ageConfirmed: false });
  assert.ok(result.error);
});

test('comment validation supports MongoDB and local fallback record ids', () => {
  assert.equal(schemas.comment.validate({ postId: '507f1f77bcf86cd799439011', parent: null, text: 'Mongo comment' }).error, undefined);
  assert.equal(schemas.comment.validate({ postId: '123e4567-e89b-42d3-a456-426614174000', parent: '', text: 'Local comment' }).error, undefined);
  assert.equal(schemas.comment.validate({ postId: '507f1f77bcf86cd799439011', parent: null, text: 'GIF Take', gifUrl: 'data:image/gif;base64,AA==' }).error, undefined);
});

test('media validation accepts five mixed attachments and enforces short video rules', () => {
  const image = { type: 'image', url: 'data:image/webp;base64,AA==', alt: 'image', duration: 0, aspectRatio: 1.8 };
  assert.equal(schemas.post.validate({ content: 'Image take', category: 'Life', media: [image, image] }).error, undefined);
  assert.equal(schemas.post.validate({ content: 'Flexible layout', category: 'Life', media: [image, image, image, image, image] }).error, undefined);
  assert.ok(schemas.post.validate({ content: 'Too many', category: 'Life', media: [image, image, image, image, image, image] }).error);
  assert.equal(schemas.post.validate({ content: 'Video take', category: 'Life', media: [{ type: 'video', url: 'data:video/mp4;base64,AA==', alt: '', duration: 25, aspectRatio: 1 }] }).error, undefined);
  assert.ok(schemas.post.validate({ content: 'Long video', category: 'Life', media: [{ type: 'video', url: 'data:video/mp4;base64,AA==', alt: '', duration: 26, aspectRatio: 1 }] }).error);
  assert.ok(schemas.post.validate({ content: 'Wide video', category: 'Life', media: [{ type: 'video', url: 'data:video/mp4;base64,AA==', alt: '', duration: 10, aspectRatio: 1.8 }] }).error);
});

test('post text rejects hashtags and links while GIF attachment links stay valid', () => {
  assert.ok(schemas.post.validate({ content: 'No #hashtags here', category: 'Life', media: [] }).error);
  assert.ok(schemas.post.validate({ content: 'Visit https://example.com', category: 'Life', media: [] }).error);
  assert.equal(schemas.post.validate({ content: 'A plain take', category: 'Life', media: [{ type: 'gif', url: 'https://example.com/reaction.gif', alt: '', duration: 0, aspectRatio: 1 }] }).error, undefined);
});

test('passwords use bcrypt with twelve salt rounds', async () => {
  const hash = await hashPassword('SecurePass123!');
  assert.equal(BCRYPT_ROUNDS, 12);
  assert.equal(bcrypt.getRounds(hash), 12);
  assert.equal(await bcrypt.compare('SecurePass123!', hash), true);
});

test('access and refresh JWTs use distinct token types', () => {
  const access = signAccessToken('test-user');
  const refresh = signRefreshToken('test-user');
  assert.notEqual(access, refresh);
  assert.equal(verifyRefreshToken(refresh).type, 'refresh');
  const refreshPayload = jwt.decode(refresh);
  assert.ok(refreshPayload.exp - refreshPayload.iat >= 364 * 24 * 60 * 60);
});

test('accounts retain independent trusted-device refresh sessions', async () => {
  const firstDevice = signRefreshToken('multi-device-user');
  const secondDevice = signRefreshToken('multi-device-user');
  const user = new User({ email: 'devices@example.com', displayName: 'Devices' });
  user.refreshTokenHashes = [await hashPassword(firstDevice), await hashPassword(secondDevice)];
  assert.equal(await bcrypt.compare(firstDevice, user.refreshTokenHashes[0]), true);
  assert.equal(await bcrypt.compare(secondDevice, user.refreshTokenHashes[1]), true);
});

test('profile validation accepts persistent customization and preferences', () => {
  const { error } = schemas.profile.validate({
    displayName: 'Callout User', handle: '@callout_user', avatarUrl: '', bio: 'About me', bannerUrl: '',
    themeColor: '#ff4713', pronouns: 'they/them', status: 'online',
    socialLinks: { twitter: '', instagram: '', discord: '', youtube: '', twitch: '', custom: '' },
    preferences: { theme: 'dark', notifications: { likes: true, comments: false, guildInvites: true }, directMessages: 'guilds', textSize: 'large' }
  });
  assert.equal(error, undefined);
});

test('created posts can be loaded with their author', async () => {
  const user = await createUser({ email: `feed-${Date.now()}@example.com`, displayName: 'Feed Author', password: 'hashed' });
  await createPost(user.id, { content: 'Persistent take', category: 'Life' });
  const posts = await listPosts();
  assert.equal(posts[0].content, 'Persistent take');
  assert.equal(posts[0].author.handle, user.handle);
});

test('repeated post request ids create only one take', async () => {
  const user = await createUser({ email: `idempotent-${Date.now()}@example.com`, displayName: 'One Click', password: 'hashed' });
  const clientRequestId = crypto.randomUUID();
  const first = await createPost(user.id, { clientRequestId, content: 'Publish this once', category: 'Life' });
  const repeated = await createPost(user.id, { clientRequestId, content: 'Publish this once', category: 'Life' });
  assert.equal(repeated.id, first.id);
});
