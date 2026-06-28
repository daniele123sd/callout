import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptFriendRequest, canAccessPost, createComment, createFriendRequest, createGuild, createGuildMessage, createGuildPost, createMessage, createPost, createUser, findUserById, getGuild, getPublicProfile,
  listComments, listFriends, listGuildMessages, listGuildPosts, listGuilds, listLeaderboard, listMessages, listNotifications,
  listPosts, listSavedPostIds, searchCallout, toggleGuildMembership,
  toggleSavedPost, updateGuild, voteOnPost
} from '../server/repository.mjs';

async function accounts() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const author = await createUser({ email: `author-${suffix}@example.com`, displayName: 'Author' });
  const reader = await createUser({ email: `reader-${suffix}@example.com`, displayName: 'Reader' });
  return { author, reader };
}

test('votes, comments, saves and notifications persist per account', async () => {
  const { author, reader } = await accounts();
  const post = await createPost(author.id, { content: 'Persistence test', category: 'Life' });

  await voteOnPost(post.id, reader.id, 'alright');
  const readerFeed = await listPosts(reader.id);
  const stored = readerFeed.find(item => item.id === post.id);
  assert.equal(stored.userVote, 'alright');
  assert.equal(stored.alrightVotes, 1);

  await createComment(post.id, reader.id, { text: 'Visible to everyone' });
  assert.equal((await listComments(post.id, author.id))[0].text, 'Visible to everyone');

  await toggleSavedPost(reader.id, post.id);
  assert.deepEqual(await listSavedPostIds(reader.id), [post.id]);
  assert.ok((await listNotifications(author.id)).length >= 2);
  assert.equal((await findUserById(reader.id)).vibeScore, 5);
});

test('guild membership, Cringe ranking, search and messages use shared records', async () => {
  const { author, reader } = await accounts();
  const post = await createPost(author.id, { content: 'Find this callout', category: 'Games' });
  const guild = await createGuild(author.id, { name: `Guild ${post.id.slice(0, 6)}`, description: 'Persistent community' });
  await toggleGuildMembership(reader.id, guild.id);

  const publicGuild = (await listGuilds(reader.id)).find(item => item.id === guild.id);
  assert.equal(publicGuild.joined, true);
  assert.equal(publicGuild.memberCount, 2);

  assert.equal((await voteOnPost(post.id, author.id, 'cringe')).forbidden, true);
  await voteOnPost(post.id, reader.id, 'cringe');
  const ranking = await listLeaderboard();
  assert.equal(ranking.find(user => user.id === author.id).cringeScore, 1);
  assert.ok(ranking.find(user => user.id === author.id).rank >= 1);
  assert.ok(ranking.find(user => user.id === author.id).cringeBadge.name);
  assert.ok(ranking.some(user => user.id === reader.id));

  const search = await searchCallout('Find this');
  assert.ok(search.posts.some(item => item.id === post.id));

  await createMessage(author.id, reader.email, 'Account-linked message');
  assert.equal((await listMessages(reader.id))[0].text, 'Account-linked message');
});

test('guild content stays private while profiles, settings, feed and chat work', async () => {
  const { author, reader } = await accounts();
  const guild = await createGuild(author.id, { name: `Private ${Date.now()}`, description: 'Visible outside' });
  assert.equal((await getGuild(guild.id, reader.id)).canViewContent, false);
  assert.equal(await listGuildPosts(guild.id, reader.id), null);

  await toggleGuildMembership(reader.id, guild.id);
  const guildPost = await createGuildPost(guild.id, reader.id, { content: 'Members only', category: 'Life', media: [] });
  assert.equal(await canAccessPost(guildPost.id, author.id), true);
  assert.equal((await listGuildPosts(guild.id, reader.id))[0].content, 'Members only');
  await createGuildMessage(guild.id, reader.id, 'Guild chat persists');
  assert.equal((await listGuildMessages(guild.id, author.id))[0].text, 'Guild chat persists');

  const customized = await updateGuild(guild.id, author.id, { name: guild.name, description: 'Visible outside', tagline: 'Customized', rules: 'Be decent', iconUrl: '', bannerUrl: '', themeColor: '#7444e8', accentColor: '#ff4713', contentPrivacy: 'members' });
  assert.equal(customized.tagline, 'Customized');
});

test('friend requests and full DM histories persist between accounts', async () => {
  const { author, reader } = await accounts();
  const pending = await createFriendRequest(author.id, reader.id);
  assert.equal(pending.status, 'pending');
  assert.equal((await listFriends(reader.id))[0].status, 'pending');
  await acceptFriendRequest(pending.id, reader.id);
  const publicProfile = await getPublicProfile(author.id, reader.id);
  assert.equal(publicProfile.friendship, 'accepted');
  assert.equal(publicProfile.email, undefined);

  await createMessage(author.id, reader.id, 'First message');
  await createMessage(author.id, reader.id, 'Second message');
  const history = await listMessages(reader.id);
  assert.ok(history.some(message => message.text === 'First message'));
  assert.ok(history.some(message => message.text === 'Second message'));
  assert.ok((await listNotifications(reader.id)).some(item => item.type === 'message'));
});
