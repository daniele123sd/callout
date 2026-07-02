import test from 'node:test';
import assert from 'node:assert/strict';
import { botStatus, initializeBots, runBotCycle, setBotEnabled } from '../server/bots.mjs';
import { listGuilds, listPosts } from '../server/repository.mjs';

test('three transparent automated accounts seed original content and a customized guild', async () => {
  const initialized = await initializeBots();
  assert.equal(initialized.bots.length, 3);
  assert.ok(initialized.bots.every(bot => bot.isAutomated && bot.handle.endsWith('_bot')));
  assert.ok((await listPosts()).filter(post => post.author?.isAutomated).length >= 3);
  const guild = (await listGuilds()).find(item => item.name === 'Open Debate Club');
  assert.equal(guild.backgroundPattern, 'grid');
  assert.match(guild.pinnedAnnouncement, /automated Callout accounts/i);
});

test('bot controls pause accounts and forced cycles record one bounded action', async () => {
  const bots = await botStatus();
  await setBotEnabled(bots[0].id, false);
  assert.equal((await botStatus()).find(bot => bot.id === bots[0].id).enabled, false);
  const result = await runBotCycle({ force: true });
  assert.ok(['post', 'comment', 'vote'].includes(result.action));
  assert.ok(result.bot);
  await setBotEnabled(bots[0].id, true);
});
