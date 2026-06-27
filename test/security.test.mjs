import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { BCRYPT_ROUNDS, hashPassword, sanitizePlainText, schemas, signAccessToken, signRefreshToken, verifyRefreshToken } from '../server/security.mjs';
import { createPost, createUser, listPosts } from '../server/repository.mjs';

test('plain-text sanitizer removes executable markup and control characters', () => {
  assert.equal(sanitizePlainText('<script>alert(1)</script><b>Safe</b>\u0000'), 'Safe');
});

test('signup validation enforces the 13+ confirmation', () => {
  const result = schemas.signup.validate({ email: 'person@example.com', password: 'SecurePass123!', displayName: 'Person', ageConfirmed: false });
  assert.ok(result.error);
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
