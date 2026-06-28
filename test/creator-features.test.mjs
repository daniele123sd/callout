import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGuild, createGuildPost, createPost, createUser, getGuild, joinGuildByInvite, listDrafts, listGuildAudit,
  listGuildMembers, listGuildPosts, listNotificationMutes, listPosts, setNotificationMute, toggleGuildMembership,
  updateGuildMember, voteOnPoll
} from '../server/repository.mjs';

async function users() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const owner = await createUser({ email: `owner-${suffix}@example.com`, displayName: 'Owner' });
  const member = await createUser({ email: `member-${suffix}@example.com`, displayName: 'Member' });
  return { owner, member };
}

test('guild roles enforce owner-only posting and record audited role changes', async () => {
  const { owner, member } = await users();
  const guild = await createGuild(owner.id, { name: `Roles ${Date.now()}-${Math.random()}`, description: '', privacy: 'public' });
  await toggleGuildMembership(member.id, guild.id);
  assert.equal(await createGuildPost(guild.id, member.id, { content: 'Not yet', category: 'Life', media: [] }), null);
  await updateGuildMember(guild.id, owner.id, member.id, { roleKey: 'contributor' });
  assert.ok(await createGuildPost(guild.id, member.id, { content: 'Permitted', category: 'Life', media: [] }));
  assert.equal((await listGuildMembers(guild.id, owner.id)).find(item => item.user.id === member.id).roleKey, 'contributor');
  assert.ok((await listGuildAudit(guild.id, owner.id)).some(item => item.action === 'member.role_changed'));
});

test('private guilds queue join requests while invite codes grant access', async () => {
  const { owner, member } = await users();
  const guild = await createGuild(owner.id, { name: `Private ${Date.now()}-${Math.random()}`, description: '', privacy: 'private' });
  await toggleGuildMembership(member.id, guild.id);
  assert.equal((await getGuild(guild.id, member.id)).joinPending, true);
  assert.equal(await listGuildPosts(guild.id, member.id), null);
  await joinGuildByInvite(member.id, guild.inviteCode);
  assert.equal((await getGuild(guild.id, member.id)).joined, true);
});

test('rich composer persists drafts and poll votes without leaking voter ids', async () => {
  const { owner, member } = await users();
  const draft = await createPost(owner.id, { content: '', category: 'Life', media: [], draft: true, visibility: 'public' });
  assert.equal((await listDrafts(owner.id))[0].id, draft.id);
  assert.ok(!(await listPosts(owner.id)).some(post => post.id === draft.id));
  const poll = await createPost(owner.id, { content: 'Choose', category: 'Life', media: [], draft: false, visibility: 'public', contentType: 'poll', poll: { question: 'Choose one', options: [{ text: 'A' }, { text: 'B' }] } });
  const optionId = poll.poll.options[0].id;
  const voted = await voteOnPoll(poll.id, member.id, optionId);
  assert.equal(voted.poll.options[0].votes, 1);
  assert.equal(voted.poll.options[0].voters, undefined);
});

test('notification mute rules persist per user', async () => {
  const { owner } = await users();
  await setNotificationMute(owner.id, { scopeType: 'category', scopeId: 'likes', snoozedUntil: null });
  assert.equal((await listNotificationMutes(owner.id))[0].scopeId, 'likes');
});
