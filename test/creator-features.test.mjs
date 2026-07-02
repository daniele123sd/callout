import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGuild, createGuildPost, createPost, createUser, getGuild, getPublicProfile, joinGuildByInvite, listDrafts, listGuildAudit,
  listGuildMembers, listGuildPosts, listNotificationMutes, listPosts, setNotificationMute, toggleGuildMembership,
  updateGuild, updateGuildIdentity, updateGuildMember, updateGuildRole, voteOnPoll
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
  assert.ok((await getPublicProfile(owner.id, owner.id)).guilds.some(item => item.id === guild.id));
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

test('guild style studio, role cosmetics, and member identities persist', async () => {
  const { owner, member } = await users();
  const guild = await createGuild(owner.id, { name: `Styled ${Date.now()}-${Math.random()}`, description: '', privacy: 'public' });
  await toggleGuildMembership(member.id, guild.id);
  await updateGuild(guild.id, owner.id, {
    name: guild.name, description: 'A styled community', tagline: 'Distinct by design', rules: '', iconUrl: '', bannerUrl: '',
    themeColor: '#7444e8', accentColor: '#ff4713', backgroundPattern: 'stars', cardStyle: 'glass', iconShape: 'hex', seasonalEffect: 'sparkles',
    customEmojis: [{ name: 'callout', imageUrl: 'https://example.com/callout.png' }], reactionSet: ['🔥', '◇'],
    landingLayout: ['progress', 'announcement', 'about'], welcomeMessage: 'Welcome in.', onboardingQuestions: [{ prompt: 'Pick a side', options: ['Alright', 'Cringe'], required: true }],
    privacy: 'public', pinnedAnnouncement: '', settings: { allowJoinRequests: true, showMemberList: true, allowPerGuildProfiles: true, showOnlineStatus: true }, contentPrivacy: 'members'
  });
  await updateGuildIdentity(guild.id, member.id, { nickname: 'Guild Voice', avatarUrl: '', bannerUrl: '', bio: 'Only in this guild', themeColor: '#63e6be', avatarFrame: 'spark', onboardingAnswers: [{ question: 'Pick a side', answer: 'Alright' }] });
  await updateGuildRole(guild.id, owner.id, 'contributor', { name: 'Creators', icon: '✦', color: '#63e6be', permissions: { createPosts: true, chat: true } });
  const savedForMember = await getGuild(guild.id, member.id);
  const savedForOwner = await getGuild(guild.id, owner.id);
  assert.equal(savedForMember.backgroundPattern, 'stars');
  assert.equal(savedForMember.viewerMembership.guildProfile.nickname, 'Guild Voice');
  assert.equal(savedForOwner.roles.find(role => role.key === 'contributor').name, 'Creators');
});
