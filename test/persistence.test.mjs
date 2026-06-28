import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createComment, createGuild, createMessage, createPost, createUser,
  listComments, listGuilds, listLeaderboard, listMessages, listNotifications,
  listPosts, listSavedPostIds, searchCallout, toggleGuildMembership,
  toggleSavedPost, voteOnPost
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
});

test('guild membership, leaderboard points, search and messages use shared records', async () => {
  const { author, reader } = await accounts();
  const post = await createPost(author.id, { content: 'Find this callout', category: 'Games' });
  const guild = await createGuild(author.id, { name: `Guild ${post.id.slice(0, 6)}`, description: 'Persistent community' });
  await toggleGuildMembership(reader.id, guild.id);

  const publicGuild = (await listGuilds(reader.id)).find(item => item.id === guild.id);
  assert.equal(publicGuild.joined, true);
  assert.equal(publicGuild.memberCount, 2);

  const ranking = await listLeaderboard();
  assert.ok(ranking.find(user => user.id === author.id).points >= 10);
  assert.ok(ranking.some(user => user.id === reader.id));

  const search = await searchCallout('Find this');
  assert.ok(search.posts.some(item => item.id === post.id));

  await createMessage(author.id, reader.email, 'Account-linked message');
  assert.equal((await listMessages(reader.id))[0].text, 'Account-linked message');
});
