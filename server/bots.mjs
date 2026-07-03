import {
  createComment, createGuild, createGuildPost, createPost, createUser, findUserByEmail, getGuild, listComments,
  listGuildPosts, listGuilds, listPosts, publicUser, toggleGuildMembership, updateGuild, updateGuildMember, updateUser, voteOnPost
} from './repository.mjs';

const BOT_DOMAIN = 'bots.callout.invalid';
const minimumIntervalMs = () => Math.max(60, Number(process.env.BOT_INTERVAL_MINUTES || 360)) * 60_000;

const avatar = (letter, background) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="34" fill="${background}"/><circle cx="64" cy="58" r="38" fill="#fff"/><circle cx="50" cy="55" r="5" fill="#111"/><circle cx="78" cy="55" r="5" fill="#111"/><path d="M46 76c10 8 26 8 36 0" fill="none" stroke="#111" stroke-width="6" stroke-linecap="round"/><text x="94" y="116" font-family="Arial" font-size="25" font-weight="700" fill="#111">${letter}</text></svg>`)}`;

export const BOT_PERSONAS = [
  {
    key: 'screencritic', email: `screencritic@${BOT_DOMAIN}`, displayName: 'Mara Frames', handle: '@screencritic_bot', persona: 'Movies and television',
    bio: 'Automated Callout account sharing original movie and television takes. Every post is generated from a curated topic bank.',
    themeColor: '#7444e8', avatarFrame: 'violet', profileEffect: 'spotlight', profileBackground: 'stars', avatarUrl: avatar('M', '#7444e8'),
    category: 'Movies', posts: [
      'A GREAT ENDING CAN RESCUE A MESSY MOVIE, BUT A BAD ENDING CAN RUIN A GREAT ONE.',
      'MOVIE TRAILERS SHOW FAR TOO MUCH. GIVE ME THE PREMISE AND LET THE FILM SURPRISE ME.',
      'A STRONG VILLAIN DOES NOT NEED A TRAGIC BACKSTORY TO BE INTERESTING.',
      'LIMITED SERIES ARE OFTEN BETTER THAN SHOWS DESIGNED TO RUN FOREVER.'
    ],
    comments: ['The execution matters more than the premise for me.', 'I can see the other side, but pacing would decide it.', 'This is exactly the kind of opinion that changes after a rewatch.']
  },
  {
    key: 'soundcheck', email: `soundcheck@${BOT_DOMAIN}`, displayName: 'Theo Tempo', handle: '@soundcheck_bot', persona: 'Music and pop culture',
    bio: 'Automated Callout account for original music takes. Curated by Callout and always labelled as automated.',
    themeColor: '#16a87b', avatarFrame: 'spark', profileEffect: 'glow', profileBackground: 'waves', avatarUrl: avatar('T', '#16a87b'),
    category: 'Music', posts: [
      'A SHORT ALBUM WITH NO SKIPS BEATS A TWO HOUR TRACKLIST EVERY TIME.',
      'THE BEST LIVE VERSION OF A SONG SHOULD GET AN OFFICIAL RELEASE.',
      'A MEMORABLE CHORUS CANNOT SAVE A SONG WITH BORING VERSES.',
      'ALBUM ART CHANGES HOW PEOPLE HEAR THE MUSIC MORE THAN THEY ADMIT.'
    ],
    comments: ['I would judge this completely differently live.', 'The production choice is probably doing most of the work here.', 'A shorter version might make the argument much stronger.']
  },
  {
    key: 'debateclub', email: `debateclub@${BOT_DOMAIN}`, displayName: 'Nia Neutral', handle: '@debateclub_bot', persona: 'Everyday debates and community prompts',
    bio: 'Automated Callout discussion host. I post original, low-stakes debates and invite real people to take the conversation over.',
    themeColor: '#ff6b35', avatarFrame: 'flame', profileEffect: 'bubbles', profileBackground: 'grid', avatarUrl: avatar('N', '#ff6b35'),
    category: 'Life', posts: [
      'BEING EARLY IS BETTER THAN ARRIVING EXACTLY ON TIME.',
      'WINDOW SEATS ARE OVERRATED ON ANY FLIGHT LONGER THAN THREE HOURS.',
      'A VOICE NOTE OVER TWO MINUTES SHOULD HAVE BEEN A PHONE CALL.',
      'THE BEST GROUP CHATS NEED AT LEAST ONE PERSON WHO NEVER STOPS TALKING.'
    ],
    comments: ['I disagree, but this is a fair line to draw.', 'The context changes this one more than people admit.', 'This deserves a proper Based versus Cringe split.']
  }
];

async function ensureBot(persona) {
  let user = await findUserByEmail(persona.email);
  const profile = {
    displayName: persona.displayName, handle: persona.handle, avatarUrl: persona.avatarUrl, bio: persona.bio, themeColor: persona.themeColor,
    avatarFrame: persona.avatarFrame, profileEffect: persona.profileEffect, profileBackground: persona.profileBackground, vibeAura: 'auto', status: 'online',
    isAutomated: true, automationEnabled: user?.automationEnabled !== false, automationPersona: persona.persona
  };
  if (!user) user = await createUser({ email: persona.email, ...profile });
  else user = await updateUser(String(user._id || user.id), profile);
  return publicUser(user);
}

async function ensureBotGuild(bots) {
  const existing = (await listGuilds(bots[0].id)).find(guild => guild.name === 'Open Debate Club');
  let guild = existing || await createGuild(bots[0].id, { name: 'Open Debate Club', description: 'Automated prompts start the discussion. Real members decide where it goes.', privacy: 'public' });
  guild = await updateGuild(guild.id, bots[0].id, {
    name: 'Open Debate Club', description: 'Automated prompts start the discussion. Real members decide where it goes.', tagline: 'Low-stakes arguments, strong opinions.',
    rules: 'Respect people. Challenge ideas. Automated hosts are always labelled.', iconUrl: bots[2].avatarUrl, bannerUrl: '', themeColor: '#ff6b35', accentColor: '#7444e8',
    backgroundPattern: 'grid', cardStyle: 'glass', iconShape: 'circle', seasonalEffect: 'sparkles', customEmojis: [], reactionSet: ['👍', '🔥', '😂', '💀'],
    landingLayout: ['announcement', 'about', 'rules', 'members', 'progress'], welcomeMessage: 'Bring a strong opinion and stay open to changing it.', onboardingQuestions: [],
    privacy: 'public', pinnedAnnouncement: 'The hosts are automated Callout accounts. Human voices always come first.',
    settings: { allowJoinRequests: true, showMemberList: true, allowPerGuildProfiles: true, showOnlineStatus: true }, contentPrivacy: 'members'
  });
  for (const bot of bots.slice(1)) {
    const detail = await getGuild(guild.id, bot.id);
    if (!detail?.joined) await toggleGuildMembership(bot.id, guild.id);
    await updateGuildMember(guild.id, bots[0].id, bot.id, { roleKey: 'contributor' });
  }
  return guild;
}

async function seedEmptyAccounts(bots, guild) {
  const posts = await listPosts();
  const actions = [];
  for (let index = 0; index < bots.length; index += 1) {
    const bot = bots[index]; const persona = BOT_PERSONAS[index];
    if (!bot.automationEnabled || posts.some(post => String(post.author?.id) === String(bot.id))) continue;
    actions.push(await createPost(bot.id, { content: persona.posts[0], category: persona.category, media: [], draft: false, visibility: 'public', topics: [persona.key], contentType: 'text' }));
  }
  const guildPosts = await listGuildPosts(guild.id, bots[0].id);
  if (!guildPosts?.length) await createGuildPost(guild.id, bots[0].id, { content: 'WELCOME TO OPEN DEBATE CLUB. WHAT EVERYDAY OPINION WILL YOU DEFEND FOREVER?', category: 'Life', media: [] });
  return actions.length;
}

export async function initializeBots() {
  const bots = [];
  for (const persona of BOT_PERSONAS) bots.push(await ensureBot(persona));
  const guild = await ensureBotGuild(bots);
  const seededPosts = await seedEmptyAccounts(bots, guild);
  return { bots, guild, seededPosts };
}

export async function botStatus() {
  const bots = [];
  for (const persona of BOT_PERSONAS) {
    const user = await findUserByEmail(persona.email);
    if (user) bots.push(publicUser(user));
  }
  return bots.map(bot => ({ id: bot.id, displayName: bot.displayName, handle: bot.handle, persona: bot.automationPersona, enabled: bot.automationEnabled, lastRunAt: bot.automationLastRunAt, postCount: bot.postCount }));
}

export async function setBotEnabled(botId, enabled) {
  const bot = (await botStatus()).find(item => item.id === String(botId));
  if (!bot) return null;
  return publicUser(await updateUser(bot.id, { automationEnabled: Boolean(enabled) }));
}

export async function runBotCycle({ force = false } = {}) {
  const { bots, guild, seededPosts } = await initializeBots();
  const enabled = bots.filter(bot => bot.automationEnabled !== false);
  if (!enabled.length) return { action: 'idle', reason: 'All automated accounts are paused.', seededPosts };
  const due = enabled.filter(bot => force || !bot.automationLastRunAt || Date.now() - new Date(bot.automationLastRunAt).getTime() >= minimumIntervalMs());
  if (!due.length) return { action: 'idle', reason: 'Rate limit active.', seededPosts };
  const bot = due.sort((a, b) => new Date(a.automationLastRunAt || 0) - new Date(b.automationLastRunAt || 0))[0];
  const persona = BOT_PERSONAS.find(item => item.email === bot.email);
  const posts = await listPosts(bot.id);
  const humanPosts = posts.filter(post => post.author && !post.author.isAutomated && String(post.author.id) !== String(bot.id));
  const actionIndex = Math.floor(Date.now() / minimumIntervalMs()) % 3;
  let action = 'post'; let targetId = '';
  if (actionIndex === 1 && humanPosts.length) {
    const target = humanPosts[Math.floor(Date.now() / 3_600_000) % humanPosts.length];
    const existing = await listComments(target.id, bot.id);
    if (!existing.some(comment => String(comment.author?.id) === String(bot.id))) {
      const text = persona.comments[Math.floor(Date.now() / minimumIntervalMs()) % persona.comments.length];
      await createComment(target.id, bot.id, { text }); action = 'comment'; targetId = target.id;
    }
  } else if (actionIndex === 2 && humanPosts.length) {
    const target = humanPosts[Math.floor(Date.now() / 3_600_000) % humanPosts.length];
    await voteOnPost(target.id, bot.id, Math.floor(Date.now() / minimumIntervalMs()) % 2 ? 'alright' : 'cringe'); action = 'vote'; targetId = target.id;
  } else {
    const ownCount = posts.filter(post => String(post.author?.id) === String(bot.id)).length;
    const content = persona.posts[ownCount % persona.posts.length];
    const post = await createPost(bot.id, { content, category: persona.category, media: [], draft: false, visibility: 'public', topics: [persona.key], contentType: 'text' });
    targetId = String(post._id || post.id);
    if (persona.key === 'debateclub' && ownCount % 3 === 2) await createGuildPost(guild.id, bot.id, { content, category: persona.category, media: [] });
  }
  await updateUser(bot.id, { automationLastRunAt: new Date() });
  return { action, bot: bot.handle, targetId, seededPosts };
}
