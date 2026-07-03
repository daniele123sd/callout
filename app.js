const storageKey = 'callout-product-state-v2';

const defaultState = {
  posts: [],
  guilds: [],
  savedPostIds: [],
  profile: {
    displayName: 'Guest',
    handle: '@guest',
    bio: '',
    avatarUrl: '',
    bannerUrl: '',
    themeColor: '#ff4713',
    avatarFrame: 'none',
    profileEffect: 'none',
    vibeAura: 'auto',
    profileBackground: 'clean',
    profileLayout: ['posts', 'about', 'guilds', 'achievements', 'media', 'trophies'],
    showcaseMode: 'featured',
    featuredBadges: [],
    cosmeticUnlocks: { frames: ['none'], effects: ['none'], auras: ['auto', 'none', 'rookie'], backgrounds: ['clean'], palettes: ['callout'] },
    featuredPosts: [],
    pinnedGuilds: [],
    socialLinks: { twitter: '', instagram: '', discord: '', youtube: '', twitch: '', custom: '' },
    pronouns: '',
    status: 'online',
    vibeScore: 0,
    vibeBadges: []
  },
  settings: {
    appearanceVersion: 2,
    theme: 'light',
    palette: 'callout',
    reducedMotion: false,
    feedDensity: 'comfortable',
    voteEffect: 'pop',
    notificationSound: 'callout',
    notifications: { likes: true, comments: true, guildInvites: true, mentions: true, follows: true, guildActivity: true, directMessages: true },
    notificationDelivery: { inApp: true, push: false, email: false },
    directMessages: 'everyone',
    textSize: 'medium',
    blockedUsers: [],
    widgetOrder: ['trending-guilds', 'activity', 'achievements'],
    hiddenTopics: [],
    leaderboardPeriod: 'all'
  }
};

const storedState = (() => {
  try { return JSON.parse(localStorage.getItem(storageKey)); } catch { return null; }
})();

const state = {
  ...defaultState,
  ...(storedState || {}),
  profile: {
    ...defaultState.profile,
    ...(storedState?.profile || {}),
    socialLinks: {
      ...defaultState.profile.socialLinks,
      ...(storedState?.profile?.socialLinks || {}),
      twitter: storedState?.profile?.socialLinks?.twitter || storedState?.profile?.twitter || '',
      instagram: storedState?.profile?.socialLinks?.instagram || storedState?.profile?.instagram || '',
      discord: storedState?.profile?.socialLinks?.discord || storedState?.profile?.discord || ''
    }
  },
  settings: {
    ...defaultState.settings,
    ...(storedState?.settings || {}),
    notifications: { ...defaultState.settings.notifications, ...(storedState?.settings?.notifications || {}) },
    blockedUsers: Array.isArray(storedState?.settings?.blockedUsers) ? storedState.settings.blockedUsers : []
  },
  posts: Array.isArray(storedState?.posts) ? storedState.posts.map(post => ({ ...post, id: String(post.id), authorId: String(post.authorId || 'local-user'), comments: Array.isArray(post.comments) ? post.comments : [] })) : [],
  guilds: Array.isArray(storedState?.guilds) ? storedState.guilds : [],
  savedPostIds: Array.isArray(storedState?.savedPostIds) ? storedState.savedPostIds.map(String) : [],
  trendingPosts: [],
  leaderboard: [],
  userStanding: null,
  notifications: [],
  messages: [],
  friendships: [],
  activeGuild: null,
  guildPosts: [],
  guildMessages: [],
  guildMembers: [],
  guildAudit: [],
  publicProfile: null,
  ownProfileData: null,
  profileTab: 'posts',
  analytics: null,
  botAutomation: null,
  analyticsError: '',
  analyticsDays: 28,
  notificationFilter: 'all'
};

if (storedState?.settings?.appearanceVersion !== 2) {
  state.settings.appearanceVersion = 2;
  state.settings.theme = 'light';
}

const routes = new Set(['home', 'trending', 'guilds', 'guild', 'leaderboards', 'vibe-progress', 'notifications', 'messages', 'saved', 'profile', 'user', 'settings', 'analytics', 'take', 'auth']);
const mainContent = document.querySelector('#mainContent');
const composer = document.querySelector('#composer');
const guildComposer = document.querySelector('#guildComposer');
const actionDialog = document.querySelector('#actionDialog');
let sessionUser = null;
let pendingMedia = [];
let messageStream = null;
let sessionRefreshRequest = null;
let composerSubmissionInFlight = false;
let composerRequestId = '';
let publishingTimer = null;

function sanitizeInput(value) {
  const source = String(value || '');
  return window.DOMPurify ? window.DOMPurify.sanitize(source, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim() : source.replace(/<[^>]*>/g, '').trim();
}

function metaContent(name) {
  return document.querySelector(`meta[name="${name}"]`)?.content?.trim() || '';
}

function adConfiguration() {
  return {
    client: metaContent('adsense-client'),
    slots: {
      header: metaContent('adsense-slot-header'), sidebar: metaContent('adsense-slot-sidebar'),
      'right-rail': metaContent('adsense-slot-right-rail'), 'in-feed': metaContent('adsense-slot-in-feed'), footer: metaContent('adsense-slot-footer')
    }
  };
}

function initializeAds(root = document) {
  const { client } = adConfiguration();
  if (!/^ca-pub-\d{10,}$/.test(client) || location.protocol === 'file:') return;
  root.querySelectorAll('.adsbygoogle:not([data-callout-ad-ready])').forEach(unit => {
    const slot = unit.dataset.adSlot || '';
    if (!/^\d+$/.test(slot)) return;
    unit.dataset.adClient = client;
    unit.dataset.calloutAdReady = 'true';
    const container = unit.closest('.ad-slot');
    container?.classList.add('is-ad-requested');
    const syncAdStatus = () => {
      const filled = unit.dataset.adStatus === 'filled';
      container?.classList.toggle('is-ad-live', filled);
      container?.classList.toggle('is-ad-unfilled', unit.dataset.adStatus === 'unfilled');
    };
    new MutationObserver(syncAdStatus).observe(unit, { attributes: true, attributeFilter: ['data-ad-status'] });
    syncAdStatus();
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (error) { console.warn('AdSense unit deferred:', error.message); }
  });
}

function loadProductionAds() {
  const { client } = adConfiguration();
  if (!/^ca-pub-\d{10,}$/.test(client) || location.protocol === 'file:') return;
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  script.addEventListener('load', () => initializeAds());
  document.head.appendChild(script);
  initializeAds();
}

let lastTrackedPath = '';
function loadGoogleAnalytics() {
  const measurementId = metaContent('ga-measurement-id');
  if (!/^G-[A-Z0-9]+$/i.test(measurementId) || location.protocol === 'file:') return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
  window.gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 });
  window.gtag('js', new Date());
  window.gtag('config', measurementId, { send_page_view: false, anonymize_ip: true });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
}

function trackPageView() {
  if (!window.gtag || lastTrackedPath === location.hash) return;
  lastTrackedPath = location.hash;
  window.gtag('event', 'page_view', { page_title: document.title, page_location: location.href, page_path: `/${currentRoute()}` });
}

function trackEvent(name, parameters = {}) {
  window.gtag?.('event', name, parameters);
}

function persist() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function playNotificationSound() {
  if (state.settings.notificationSound === 'none') return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext; if (!AudioContext) return;
    const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.frequency.value = state.settings.notificationSound === 'spark' ? 880 : state.settings.notificationSound === 'soft' ? 440 : 660;
    gain.gain.setValueAtTime(.035, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .16);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .16);
  } catch { /* sound is optional */ }
}

function runVoteEffect(button, value) {
  if (state.settings.voteEffect === 'none' || state.settings.reducedMotion) return;
  button.classList.remove('vote-confirmed');
  void button.offsetWidth;
  button.classList.add('vote-confirmed');
  setTimeout(() => button.classList.remove('vote-confirmed'), 320);
  return;
  const effect = state.settings.voteEffect || 'pop'; if (effect === 'none' || state.settings.reducedMotion) return;
  const burst = document.createElement('span'); burst.className = `vote-feedback vote-feedback-${effect} ${value}`; burst.textContent = value === 'alright' ? '✓' : '🔥';
  button.appendChild(burst); setTimeout(() => burst.remove(), 850);
}

async function apiFetch(url, options = {}, retry = true) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  if (response.status === 401 && retry && url !== '/api/auth/refresh') {
    // Only one refresh may rotate the device token at a time. Without this lock,
    // concurrent page requests can invalidate each other and clear a valid login.
    if (!sessionRefreshRequest) {
      sessionRefreshRequest = fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
        .then(async refreshed => {
          if (!refreshed.ok) return false;
          const payload = await refreshed.json().catch(() => null);
          if (payload?.user) applySessionUser(payload.user);
          return true;
        })
        .finally(() => { sessionRefreshRequest = null; });
    }
    if (await sessionRefreshRequest) return apiFetch(url, options, false);
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function applySessionUser(user) {
  sessionUser = user;
  document.querySelector('#analyticsNav').hidden = !user?.isAdmin;
  if (!user) { updateHeaderProfile(); return; }
  state.profile = {
    ...state.profile,
    displayName: user.displayName || state.profile.displayName,
    handle: user.handle || state.profile.handle,
    avatarUrl: user.avatarUrl || state.profile.avatarUrl,
    vibeScore: Number(user.vibeScore ?? state.profile.vibeScore),
    postCount: Number(user.postCount ?? state.profile.postCount ?? 0),
    vibeBadges: user.vibeBadges || state.profile.vibeBadges,
    bio: user.bio ?? state.profile.bio,
    bannerUrl: user.bannerUrl ?? state.profile.bannerUrl,
    themeColor: user.themeColor || state.profile.themeColor,
    avatarFrame: user.avatarFrame || state.profile.avatarFrame,
    profileEffect: user.profileEffect || state.profile.profileEffect,
    vibeAura: user.vibeAura || state.profile.vibeAura,
    profileBackground: user.profileBackground || state.profile.profileBackground,
    profileLayout: user.profileLayout?.length ? user.profileLayout : state.profile.profileLayout,
    showcaseMode: user.showcaseMode || state.profile.showcaseMode,
    featuredBadges: user.featuredBadges || state.profile.featuredBadges,
    cosmeticUnlocks: user.cosmeticUnlocks || state.profile.cosmeticUnlocks,
    featuredPosts: user.featuredPosts || state.profile.featuredPosts,
    pinnedGuilds: user.pinnedGuilds || state.profile.pinnedGuilds,
    socialLinks: { ...state.profile.socialLinks, ...(user.socialLinks || {}) },
    pronouns: user.pronouns ?? state.profile.pronouns,
    status: user.status || state.profile.status
  };
  if (user.preferences) {
    state.settings = {
      ...state.settings,
      ...user.preferences,
      notifications: { ...state.settings.notifications, ...(user.preferences.notifications || {}) }
      , notificationDelivery: { ...state.settings.notificationDelivery, ...(user.preferences.notificationDelivery || {}) }
    };
  }
  persist();
  updateHeaderProfile();
  startMessageStream();
}

function startMessageStream() {
  if (!sessionUser || messageStream) return;
  messageStream = new EventSource('/api/messages/stream');
  messageStream.addEventListener('messages', async () => {
    if (document.activeElement?.matches('textarea,input')) return;
    await hydrateAccountData();
    playNotificationSound();
    if (currentRoute() === 'messages' || currentRoute() === 'notifications') renderRoute();
  });
}

function updateHeaderProfile() {
  const profile = sessionUser ? state.profile : defaultState.profile;
  document.querySelector('#headerName').textContent = profile.displayName;
  document.querySelector('#headerHandle').textContent = profile.handle;
  const avatar = document.querySelector('#headerAvatar');
  avatar.innerHTML = profile.avatarUrl
    ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="${escapeHtml(profile.displayName)}" />`
    : escapeHtml((profile.displayName || 'C').charAt(0).toUpperCase());
  updateAccountChrome();
}

function vibeMilestone(score = 0) {
  const levels = [
    { name: 'New Voice', icon: '✦', threshold: 0, next: 25 },
    { name: 'Good Energy', icon: '☀', threshold: 25, next: 100 },
    { name: 'Conversation Starter', icon: '⚡', threshold: 100, next: 250 },
    { name: 'Community Spark', icon: '🔥', threshold: 250, next: 1000 },
    { name: 'Vibe Legend', icon: '♛', threshold: 1000, next: 2000 }
  ];
  return [...levels].reverse().find(level => score >= level.threshold) || levels[0];
}

function updateAccountChrome() {
  const score = sessionUser ? Number(state.profile.vibeScore || 0) : 0;
  const standing = state.userStanding;
  const milestone = vibeMilestone(score);
  const progress = Math.max(0, Math.min(100, ((score - milestone.threshold) / (milestone.next - milestone.threshold)) * 100));
  document.querySelector('#headerVibe').textContent = `✦ ${score.toLocaleString()}`;
  document.querySelector('#sidebarVibeScore').textContent = score.toLocaleString();
  document.querySelector('#vibeBadgeIcon').textContent = milestone.icon;
  document.querySelector('#vibeBadgeName').textContent = milestone.name;
  document.querySelector('#vibeProgressText').textContent = `${score.toLocaleString()} / ${milestone.next.toLocaleString()}`;
  const track = document.querySelector('#vibeProgress');
  track.setAttribute('aria-valuenow', String(score)); track.setAttribute('aria-valuemax', String(milestone.next)); track.querySelector('span').style.width = `${progress}%`; track.querySelector('i').style.left = `${Math.max(2, progress - 3)}%`;
  document.querySelector('#railRankNote').textContent = standing ? `${standing.cringeScore.toLocaleString()} Cringe ${standing.cringeScore === 1 ? 'vote' : 'votes'} received.` : 'Sign in to claim your place.';
  const mini = document.querySelector('#railLeaderboardRows');
  mini.innerHTML = state.leaderboard.slice(0, 5).map(user => `<button type="button" data-rail-user="${user.id}"><b>${user.rank}</b><span class="avatar">${user.avatarUrl ? `<img src="${escapeHtml(user.avatarUrl)}" alt="" />` : escapeHtml((user.displayName || 'C').charAt(0))}</span><span><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.handle || '')}</small></span><em>${Number(user.cringeScore || 0).toLocaleString()}</em></button>`).join('') || '<p>No ranked users yet.</p>';
  mini.querySelectorAll('[data-rail-user]').forEach(button => button.addEventListener('click', () => navigate(`user/${button.dataset.railUser}`)));
  renderSidebarWidgets();
}

function renderSidebarWidgets() {
  const container = document.querySelector('#sidebarWidgets');
  if (!container) return;
  const order = Array.isArray(state.settings.widgetOrder) ? state.settings.widgetOrder : defaultState.settings.widgetOrder;
  const joined = state.guilds.filter(guild => guild.joined).slice(0, 3);
  const definitions = {
    'trending-guilds': { title: 'Trending guilds', body: joined.length ? joined.map(guild => `<button type="button" data-widget-guild="${guild.id}"><span>${guild.iconUrl ? `<img src="${escapeHtml(guild.iconUrl)}" alt="" />` : escapeHtml(guild.name.charAt(0))}</span><b>${escapeHtml(guild.name)}</b><small>${Number(guild.memberCount || 0)} members</small></button>`).join('') : '<p>Guild activity will appear as communities grow.</p>' },
    activity: { title: 'Your activity', body: `<div class="widget-stat"><strong>${Number(state.profile.vibeScore || 0).toLocaleString()}</strong><span>Vibe</span></div><div class="widget-stat"><strong>${Number(state.profile.postCount || 0).toLocaleString()}</strong><span>Posts</span></div>` },
    achievements: { title: 'Streaks & achievements', body: `<p>${state.profile.vibeBadges?.length ? `${state.profile.vibeBadges.length} Vibe badge${state.profile.vibeBadges.length === 1 ? '' : 's'} earned.` : 'Interact with Callout to begin your first streak.'}</p><button type="button" data-widget-progress>View progress</button>` }
  };
  container.innerHTML = order.map((key, index) => `<section class="sidebar-widget" data-widget="${key}"><header><strong>${definitions[key].title}</strong><span><button type="button" data-widget-move="${index}" data-direction="-1" aria-label="Move up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-widget-move="${index}" data-direction="1" aria-label="Move down" ${index === order.length - 1 ? 'disabled' : ''}>↓</button></span></header><div>${definitions[key].body}</div></section>`).join('');
  container.querySelectorAll('[data-widget-move]').forEach(button => button.addEventListener('click', () => { const from = Number(button.dataset.widgetMove); const to = from + Number(button.dataset.direction); [order[from], order[to]] = [order[to], order[from]]; state.settings.widgetOrder = order; persist(); renderSidebarWidgets(); }));
  container.querySelectorAll('[data-widget-guild]').forEach(button => button.addEventListener('click', () => navigate(`guild/${button.dataset.widgetGuild}/public`)));
  container.querySelector('[data-widget-progress]')?.addEventListener('click', () => navigate('vibe-progress'));
}

function updateGuildChrome() {
  const guild = state.guilds.find(item => item.joined);
  const art = document.querySelector('#railGuildArt');
  const name = document.querySelector('#railGuildName');
  const description = document.querySelector('#railGuildDescription');
  const actions = document.querySelector('#railGuildActions');
  if (!guild) {
    art.innerHTML = '⚔'; art.style.backgroundImage = '';
    name.textContent = 'Find your people'; description.textContent = 'Join communities built around shared interests and stronger takes.';
    actions.innerHTML = '<button type="button" data-quick-guilds>View Guilds</button>';
    actions.querySelector('button').addEventListener('click', () => navigate('guilds'));
    return;
  }
  art.innerHTML = guild.iconUrl ? `<img src="${escapeHtml(guild.iconUrl)}" alt="" />` : escapeHtml(guild.name.charAt(0).toUpperCase());
  name.textContent = guild.name; description.textContent = guild.tagline || guild.description || 'Your current guild.';
  actions.innerHTML = `<button type="button" data-guild-quick="feed">Feed</button><button type="button" data-guild-quick="public">Profile</button><button type="button" data-guild-quick="chat">GC</button>`;
  actions.querySelectorAll('[data-guild-quick]').forEach(button => button.addEventListener('click', () => navigate(`guild/${guild.id}/${button.dataset.guildQuick}`)));
}

async function hydrateSession() {
  try {
    const payload = await apiFetch('/api/auth/me');
    applySessionUser(payload.user);
  } catch (error) {
    // A temporary network/server failure is not proof that the user signed out.
    if (error?.status === 401 || error?.status === 403 || error?.status === 404) {
      sessionUser = null;
      updateHeaderProfile();
    }
  }
}

function mapPost(post) {
  const id = String(post.id || post._id);
  return {
    id, databaseId: id,
    authorId: String(post.author?.id || post.author?._id || post.author || ''),
    authorHandle: post.author?.handle || '@member', authorName: post.author?.displayName || 'Callout member',
    authorAvatarUrl: post.author?.avatarUrl || '', authorAutomated: Boolean(post.author?.isAutomated), authorPersona: post.author?.automationPersona || '', text: String(post.content || ''), category: post.category, media: Array.isArray(post.media) ? post.media : [],
    poll: post.poll || null, topics: post.topics || [], contentWarning: post.contentWarning || '', embedUrl: post.embedUrl || '', reactionSet: post.reactionSet || 'classic', visibility: post.visibility || 'public',
    alrightVotes: Number(post.alrightVotes || 0), cringeVotes: Number(post.cringeVotes || 0), impressions: Number(post.impressions || 0),
    userVote: post.userVote || null, commentCount: Number(post.commentCount || 0), comments: Array.isArray(post.comments) ? post.comments : [],
    createdAt: new Date(post.createdAt || Date.now()).getTime(), publishing: Boolean(post.publishing)
  };
}

async function hydratePosts() {
  try {
    const payload = await apiFetch('/api/posts', {}, false);
    state.posts = (payload.posts || []).map(mapPost);
    persist();
    renderRoute();
  } catch (error) { console.error('Unable to load posts:', error); }
}

async function hydrateApp() {
  await hydrateSession();
  await Promise.all([hydratePosts(), hydrateGuilds(), hydrateLeaderboard(), hydrateTrending(), hydrateAccountData()]);
  if (currentRoute() === 'take') await hydrateTake(activeTake());
  if (currentRoute() === 'guild') await hydrateGuildDetail();
  if (currentRoute() === 'user') await hydratePublicProfile();
  if (currentRoute() === 'profile') await hydrateOwnProfile();
  if (currentRoute() === 'analytics') await hydrateAnalytics();
  renderRoute();
}

async function hydrateGuilds() { try { state.guilds = (await apiFetch('/api/guilds', {}, false)).guilds || []; updateGuildChrome(); } catch (error) { console.error(error); } }
async function hydrateLeaderboard() { try { state.leaderboard = (await apiFetch(`/api/leaderboard?period=${encodeURIComponent(state.settings.leaderboardPeriod || 'all')}`, {}, false)).users || []; state.userStanding = sessionUser ? state.leaderboard.find(user => String(user.id) === String(sessionUser.id)) || null : null; updateAccountChrome(); } catch (error) { console.error(error); } }
async function hydrateTrending() { try { state.trendingPosts = ((await apiFetch('/api/posts/trending', {}, false)).posts || []).map(mapPost); } catch (error) { console.error(error); } }
async function hydrateGuildDetail() {
  const id = decodeURIComponent(location.hash.split('/')[1] || '');
  if (!id) return;
  try {
    state.activeGuild = (await apiFetch(`/api/guilds/${id}`, {}, false)).guild;
    if (state.activeGuild.canViewContent && sessionUser) {
      const requests = [apiFetch(`/api/guilds/${id}/posts`), state.activeGuild.permissions?.chat ? apiFetch(`/api/guilds/${id}/messages`) : Promise.resolve({ messages: [] }), apiFetch(`/api/guilds/${id}/members`)];
      if (state.activeGuild.permissions?.viewAudit) requests.push(apiFetch(`/api/guilds/${id}/audit`));
      const [posts, messages, members, audit] = await Promise.all(requests);
      state.guildPosts = (posts.posts || []).map(mapPost); state.guildMessages = messages.messages || []; state.guildMembers = members.members || []; state.guildAudit = audit?.audit || [];
    } else { state.guildPosts = []; state.guildMessages = []; }
  } catch (error) { state.activeGuild = null; showToast(error.message); }
}
async function hydratePublicProfile() {
  const id = decodeURIComponent(location.hash.split('/')[1] || '');
  if (!id) return;
  try { state.publicProfile = (await apiFetch(`/api/users/${id}`, {}, false)).user; } catch (error) { state.publicProfile = null; showToast(error.message); }
}
async function hydrateOwnProfile() {
  if (!sessionUser?.id) { state.ownProfileData = null; return; }
  try { state.ownProfileData = (await apiFetch(`/api/users/${sessionUser.id}`, {}, false)).user; } catch (error) { state.ownProfileData = null; console.error(error); }
}
async function hydrateAnalytics() {
  if (!sessionUser?.isAdmin) { state.analytics = null; state.botAutomation = null; state.analyticsError = ''; return; }
  try {
    state.analyticsError = '';
    const [analytics, automation] = await Promise.all([apiFetch(`/api/analytics/summary?days=${state.analyticsDays}`), apiFetch('/api/admin/bots')]);
    state.analytics = analytics.analytics; state.botAutomation = automation;
  } catch (error) { state.analytics = null; state.analyticsError = error.message; }
}
async function hydrateAccountData() {
  if (!sessionUser) { state.savedPostIds = []; state.notifications = []; state.messages = []; state.friendships = []; return; }
  const [saved, notifications, messages, friends] = await Promise.allSettled([apiFetch('/api/saved'), apiFetch('/api/notifications'), apiFetch('/api/messages'), apiFetch('/api/friends')]);
  if (saved.status === 'fulfilled') state.savedPostIds = (saved.value.savedPostIds || []).map(String);
  if (notifications.status === 'fulfilled') state.notifications = notifications.value.notifications || [];
  if (messages.status === 'fulfilled') state.messages = messages.value.messages || [];
  if (friends.status === 'fulfilled') state.friendships = friends.value.friendships || [];
  try {
    const unread = state.notifications.filter(item => !item.read).length;
    const badge = document.querySelector('#notificationBadge'); badge.textContent = unread; badge.hidden = unread === 0;
  } catch (error) { console.error(error); }
}

async function hydrateSavedPosts() {
  if (!sessionUser) { state.savedPostIds = []; return; }
  try {
    const saved = await apiFetch('/api/saved');
    state.savedPostIds = (saved.savedPostIds || []).map(String); persist();
  } catch (error) { console.error('Unable to load saved posts:', error); }
}

function currentRoute() {
  const route = location.hash.replace('#', '').split('/')[0] || 'home';
  return routes.has(route) ? route : 'home';
}

function navigate(route) {
  location.hash = route;
  if (currentRoute() === route) renderRoute();
}

function currentUserId() {
  return sessionUser?.id || 'local-user';
}

function avatarMarkup(className = '') {
  const frame = `avatar-frame-${escapeHtml(state.profile.avatarFrame || 'none')}`;
  return state.profile.avatarUrl ? `<span class="avatar ${className} ${frame}"><img src="${escapeHtml(state.profile.avatarUrl)}" alt="" /></span>` : `<span class="avatar ${className} ${frame}">🦸🏻</span>`;
}

function postAvatarMarkup(post) {
  if (post.authorAvatarUrl) return `<span class="avatar take-avatar"><img src="${escapeHtml(post.authorAvatarUrl)}" alt="" /></span>`;
  return `<span class="avatar take-avatar">${escapeHtml((post.authorName || 'C').charAt(0).toUpperCase())}</span>`;
}

function pageHeader(kicker, title, description, action = '') {
  return `<header class="page-heading">
    <div><span class="section-kicker">${kicker}</span><h1>${title}</h1><p>${description}</p></div>
    ${action}
  </header>`;
}

function adUnit(placement, className, format, label) {
  const { client, slots } = adConfiguration();
  const slot = slots[placement] || '';
  return `<div class="ad-slot ${className}" data-ad-placement="${placement}"><ins class="adsbygoogle" data-ad-client="${escapeHtml(client)}" data-ad-slot="${escapeHtml(slot)}" data-ad-format="${format}" data-full-width-responsive="true"></ins><span class="ad-placeholder-copy">ADVERTISEMENT <small>${label}</small></span></div>`;
}

function adBanner() {
  return adUnit('header', 'ad-leaderboard', 'horizontal', 'Responsive banner');
}

function inFeedAd() {
  return adUnit('in-feed', 'ad-infeed', 'fluid', 'In-feed responsive unit').replace('data-ad-format="fluid"', 'data-ad-format="fluid" data-ad-layout-key="-gw-3+1f-3d+2z"');
}

function emptyState(icon, title, text, action = '') {
  return `<section class="empty-panel">
    <div class="empty-icon">${icon}</div>
    <h2>${title}</h2>
    <p>${text}</p>
    ${action}
  </section>`;
}

function postTemplate(post, detail = false) {
  const total = post.alrightVotes + post.cringeVotes;
  const alrightPercent = total ? Math.round((post.alrightVotes / total) * 100) : 50;
  const cringePercent = 100 - alrightPercent;
  const isSaved = state.savedPostIds.includes(post.id);
  const commentCount = post.comments?.length ? countComments(post.comments) : Number(post.commentCount || 0);
  return `<article class="take-card ${detail ? 'take-card-detail' : 'take-card-feed'} ${post.publishing ? 'take-publishing' : ''}" data-post-id="${post.id}">
    ${post.publishing ? '<div class="take-publishing-status"><span></span><strong>Publishing</strong><small>Your take is being securely saved in the background.</small></div>' : ''}
    <div class="take-top">
      ${postAvatarMarkup(post)}
      <div class="take-content" ${detail ? '' : `data-open-take="${post.id}" role="link" tabindex="0" aria-label="Open take: ${escapeHtml(post.text)}"`}>
        <div class="take-byline"><strong>${escapeHtml(post.authorHandle || '@member')}</strong>${post.authorAutomated ? '<span class="automation-label" title="This account is operated automatically by Callout">AUTOMATED</span>' : ''}<small>${timeLabel(post.createdAt || Date.now())} in ${escapeHtml(post.category)}</small></div>
        ${post.contentWarning ? `<details class="content-warning"><summary>Content warning: ${escapeHtml(post.contentWarning)}</summary><h2>${formatPostContent(post.text)}</h2></details>` : `<h2>${formatPostContent(post.text)}</h2>`}
        ${post.topics?.length ? `<div class="post-topics">${post.topics.map(topic => `<span>${escapeHtml(topic)}</span>`).join('')}</div>` : ''}
      </div>
      <button class="icon-button save-button ${isSaved ? 'saved' : ''}" type="button" data-save-post="${post.id}" aria-label="${isSaved ? 'Remove from saved' : 'Save take'}"><svg><use href="#i-bookmark"></use></svg></button>
      <button class="icon-button" type="button" data-post-menu="${post.id}" aria-label="Post options"><svg><use href="#i-more"></use></svg></button>
    </div>
    ${postMediaMarkup(post.media)}
    ${post.poll ? pollMarkup(post) : ''}
    ${post.embedUrl ? `<a class="link-embed" href="${escapeHtml(post.embedUrl)}" target="_blank" rel="noopener noreferrer"><strong>Open attached link</strong><small>${escapeHtml(new URL(post.embedUrl).hostname)}</small></a>` : ''}
    <div class="vote-row">
      <button class="vote-button alright ${post.userVote === 'alright' ? 'selected' : ''}" type="button" data-vote="alright"><span class="vote-face">☺</span><strong>ALRIGHT</strong></button>
      <b class="percent alright-percent">${alrightPercent}%</b>
      <div class="vote-progress" style="--alright:${alrightPercent}%" role="progressbar" aria-label="${alrightPercent}% Alright, ${cringePercent}% Cringe" aria-valuenow="${alrightPercent}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-divider"></div>
      </div>
      <b class="percent cringe-percent">${cringePercent}%</b>
      <button class="vote-button cringe ${post.userVote === 'cringe' ? 'selected' : ''}" type="button" data-vote="cringe"><span class="vote-face">☹</span><strong>CRINGE</strong></button>
    </div>
    <div class="take-footer"><span>${total} ${total === 1 ? 'vote' : 'votes'}　•　${commentCount} ${commentCount === 1 ? 'Take' : 'Takes'}</span>${detail ? '' : `<button class="comment-link" type="button" data-open-take="${post.id}">Open take →</button>`}</div>
  </article>`;
}

function formatPostContent(value = '') {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/\|\|([^|]+)\|\|/g, '<span class="spoiler-text" tabindex="0">$1</span>').replace(/\n/g, '<br>');
}

function pollMarkup(post) {
  const total = post.poll.options.reduce((sum, option) => sum + Number(option.votes || 0), 0);
  return `<section class="post-poll"><strong>${escapeHtml(post.poll.question || 'Poll')}</strong>${post.poll.options.map(option => { const percent = total ? Math.round(Number(option.votes || 0) / total * 100) : 0; return `<button type="button" data-poll-post="${post.id}" data-poll-option="${option.id}" class="${option.voted ? 'selected' : ''}" style="--poll:${percent}%"><span>${escapeHtml(option.text)}</span><b>${percent}%</b></button>`; }).join('')}<small>${total} vote${total === 1 ? '' : 's'}</small></section>`;
}

function postMediaMarkup(media = []) {
  if (!media.length) return '';
  const items = media.map(item => item.type === 'video'
    ? `<video controls playsinline preload="metadata" src="${escapeHtml(item.url)}" aria-label="Attached short video"></video>`
    : `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt || 'Attached media')}" loading="lazy" />`).join('');
  return `<div class="take-media media-count-${media.length}">${items}</div>`;
}

function countComments(comments = []) {
  return comments.reduce((total, comment) => total + 1 + countComments(comment.replies || []), 0);
}

function timeLabel(timestamp) {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function commentNode(comment, depth = 0) {
  const author = comment.author || {};
  const authorName = typeof author === 'string' ? author : (author.handle || author.displayName || '@member');
  const avatar = typeof author === 'object' && author.avatarUrl ? `<img src="${escapeHtml(author.avatarUrl)}" alt="" />` : escapeHtml(authorName.charAt(0).toUpperCase());
  return `<article class="reddit-comment" style="--depth:${Math.min(depth, 5)}" data-comment-id="${comment.id}">
    <div class="comment-rail"><span class="avatar comment-avatar">${avatar}</span><i></i></div>
    <div class="comment-content"><div class="comment-author"><strong>${escapeHtml(authorName)}</strong>${typeof author === 'object' && author.isAutomated ? '<span class="automation-label">AUTOMATED</span>' : ''}<span>•</span><time>${timeLabel(comment.createdAt)}</time></div>
      <p>${escapeHtml(comment.text)}</p>
      ${comment.gifUrl ? `<img class="comment-gif" src="${escapeHtml(comment.gifUrl)}" alt="GIF attached to Take" loading="lazy" />` : ''}
      <div class="reddit-actions"><button type="button" data-upvote-comment="${comment.id}" class="${comment.upvoted ? 'active' : ''}">↑ ${comment.votes || 0}</button><button type="button" data-reply-comment="${comment.id}">↩ Reply</button><button type="button">•••</button></div>
      <div class="reply-slot" id="reply-${comment.id}" hidden></div>
      ${(comment.replies || []).map(reply => commentNode(reply, depth + 1)).join('')}
    </div>
  </article>`;
}

function emptyThreadPreview() {
  return `<div class="empty-thread"><h3>No Takes yet</h3><p>Start the discussion. Replies will stack below their parent Take with a visible thread rail.</p>
    <div class="thread-blueprint" aria-label="Nested comment layout preview"><div><span></span><i></i><i></i></div><div class="blueprint-reply"><span></span><i></i></div></div>
  </div>`;
}

function commentThreadDetail(post) {
  const comments = post.comments || [];
  return `<section class="reddit-thread">
    <div class="comment-head"><div><span class="section-kicker">DISCUSSION</span><h2>Takes</h2></div><span class="comment-count">${countComments(comments)} Takes</span></div>
    <form class="comment-composer" id="commentForm"><span class="avatar comment-avatar">C</span><div class="comment-entry"><label class="sr-only" for="commentText">Add a Take</label><textarea id="commentText" name="comment" required maxlength="500" placeholder="Add your Take..."></textarea><span class="comment-tools"><button type="button" data-comment-emoji="🔥">🔥</button><button type="button" data-comment-emoji="😂">😂</button><button type="button" data-comment-emoji="💀">💀</button><label class="comment-gif-picker">GIF file<input type="file" name="gifFile" accept="image/gif" /></label><input type="url" name="gifUrl" aria-label="GIF URL" placeholder="or HTTPS GIF URL" /></span></div><button type="submit">Post Take</button></form>
    <div class="comment-sort"><strong>Best</strong><button type="button">Sort: Newest⌄</button></div>
    <div class="comment-stack">${comments.length ? comments.map(comment => commentNode(comment)).join('') : emptyThreadPreview()}</div>
  </section>`;
}

function takeDetailView() {
  const id = decodeURIComponent(location.hash.split('/')[1] || '');
  const post = findPostById(id);
  if (!post) return `${pageHeader('TAKE', 'Take not found', 'This take may have been removed.')}<button class="quiet-action" type="button" data-back-feed>← Back to feed</button>`;
  return `<div class="detail-back-row"><button type="button" data-back-feed>← Back to feed</button><span>TAKE DETAIL</span></div>${postTemplate(post, true)}${commentThreadDetail(post)}`;
}

function feedMarkup(posts) {
  return `<section class="take-list">${posts.map((post, index) => `${postTemplate(post)}${(index + 1) % 3 === 0 ? inFeedAd() : ''}`).join('')}</section>`;
}

function homeView() {
  const posts = state.posts.length
    ? feedMarkup(state.posts)
    : emptyState('✦', 'No takes to show yet', 'Your feed is ready for real community posts. Create the first take to see voting come alive.', '<button class="primary-action" type="button" data-open-composer>Post your first take</button>');

  return `${adBanner('top-leaderboard')}
    <div class="feed-tabs" role="tablist" aria-label="Feed views">
      <button class="tab active" type="button" data-feed-tab="For You">For You</button>
      <button class="tab" type="button" data-feed-tab="Following">Following</button>
      <button class="tab" type="button" data-feed-tab="Latest">Latest</button>
    </div>
    <div class="category-row" aria-label="Filter by category">
      <button class="chip active" type="button" data-category="All">All</button><button class="chip" type="button" data-category="Entertainment">Entertainment</button><button class="chip" type="button" data-category="Music">Music</button><button class="chip" type="button" data-category="Movies">Movies</button><button class="chip" type="button" data-category="Games">Games</button><button class="chip" type="button" data-category="Life">Life</button>
    </div>
    <div id="feedResults">${posts}</div>`;
}

function trendingView() {
  const posts = state.trendingPosts;
  const interactions = posts.reduce((sum, post) => sum + post.alrightVotes + post.cringeVotes + Number(post.commentCount || 0), 0);
  const closeCalls = posts.filter(post => { const total = post.alrightVotes + post.cringeVotes; return total && Math.abs((post.alrightVotes / total) - .5) <= .1; }).length;
  return `${pageHeader('DISCOVER', 'Trending', 'Fast-moving takes and conversations will surface here as community activity grows.')}
    ${adBanner('trending-banner')}
    <div class="segmented-control"><button class="active" type="button">Takes</button><button type="button">Topics</button><button type="button">Guilds</button></div>
    <section class="trend-stats"><div><span>LIVE SIGNAL</span><strong>${posts.length}</strong><small>Active debates</small></div><div><span>MOMENTUM</span><strong>${interactions}</strong><small>Total interactions</small></div><div><span>CLOSE CALLS</span><strong>${closeCalls}</strong><small>Near 50/50</small></div></section>
    ${posts.length ? feedMarkup(posts) : emptyState('↗', 'Nothing is trending yet', 'The first real post will appear here. Ranking is based on views and interactions.')}`;
}

function guildCard(guild) {
  return `<article class="created-guild"><div class="guild-monogram">${guild.iconUrl ? `<img src="${escapeHtml(guild.iconUrl)}" alt="" />` : escapeHtml(guild.name.charAt(0).toUpperCase())}</div><div><span class="section-kicker">${guild.joined ? 'YOUR GUILD' : 'PUBLIC PROFILE'}</span><h2>${escapeHtml(guild.name)}</h2><p>${escapeHtml(guild.tagline || guild.description)}</p><small>${Number(guild.memberCount || 0)} members</small></div><button type="button" data-open-guild="${guild.id}">Open</button></article>`;
}

function guildsView() {
  const content = state.guilds.length
    ? `<section class="guild-grid">${state.guilds.map(guildCard).join('')}</section>`
    : emptyState('⚔', 'No guilds available yet', 'Public guilds will appear here once they are created. Start a focused community without filling the directory with demo data.', '<button class="primary-action" type="button" data-create-guild>Create the first guild</button>');
  return `${pageHeader('COMMUNITIES', 'Guilds', 'Create or join public communities built around shared taste.', '<button class="primary-action" type="button" data-create-guild>＋ Create Guild</button>')}
    <div class="directory-tools"><label><svg><use href="#i-search"></use></svg><input type="search" placeholder="Search guilds" aria-label="Search guilds" /></label><button class="filter-button" type="button">All guilds⌄</button></div>
    ${content}`;
}

function leaderboardsView() {
  const rows = state.leaderboard.map(user => `<button type="button" data-leader-user="${user.id}" class="ranking-row ${String(user.id) === String(sessionUser?.id) ? 'is-you' : ''}"><strong>#${user.rank}</strong><span class="ranking-user">${user.avatarUrl ? `<span class="avatar"><img src="${escapeHtml(user.avatarUrl)}" alt="" /></span>` : `<span class="avatar">${escapeHtml((user.displayName || 'C').charAt(0))}</span>`}<span><b>${escapeHtml(user.displayName)}${String(user.id) === String(sessionUser?.id) ? ' (You)' : ''}</b><small>${escapeHtml(user.handle || '')}${user.isAutomated ? ' · AUTOMATED' : ''}</small></span></span><b>${Number(user.cringeScore || 0).toLocaleString()} cringe</b><small>${escapeHtml(user.cringeBadge?.icon || '◇')} ${escapeHtml(user.cringeBadge?.name || 'Fresh Face')}</small></button>`).join('');
  return `${pageHeader('GLOBAL CRINGE RANK', 'Leaderboard', 'A competitive ranking based only on Cringe votes received on your posts.')}
    <section class="ranking-card">
      <div class="ranking-head"><span>RANK</span><span>USER</span><span>CRINGE</span><span>BADGE</span></div>
      ${rows || '<div class="ranking-empty"><div class="podium-outline"><i></i><i></i><i></i></div><h2>No rankings yet</h2><p>New accounts are enrolled automatically.</p></div>'}
    </section>
    <aside class="info-callout"><strong>Cringe rank vs. Vibe</strong><p>Cringe votes determine this global rank. Your Vibe score is separate and rewards posting, adding Takes, and reacting across Callout.</p></aside>`;
}

function vibeProgressView() {
  const score = Number(state.profile.vibeScore || 0);
  const tiers = [{ name: 'Vibe Rookie', icon: '◆', minimum: 0, next: 100, color: '#c77a3d' }, { name: 'Vibe Star', icon: '✦', minimum: 100, next: 500, color: '#aeb8c6' }, { name: 'Vibe Legend', icon: '♛', minimum: 500, next: 1000, color: '#f3bd25' }];
  const current = [...tiers].reverse().find(tier => score >= tier.minimum) || tiers[0];
  const progress = Math.min(100, ((score - current.minimum) / (current.next - current.minimum)) * 100);
  return `${pageHeader('PERSONAL PROGRESS', 'Your Vibe journey', 'Vibe is a participation score, not a global competition. Post, react, and add Takes to progress.')}
    <section class="vibe-progress-hero"><div style="--tier:${current.color}"><span>${current.icon}</span><div><small>CURRENT RANK</small><h2>${current.name}</h2><strong>${score.toLocaleString()} Vibe</strong></div></div><div class="vibe-rank-track"><span style="width:${progress}%"></span></div><p>${score.toLocaleString()} / ${current.next.toLocaleString()} toward your next milestone</p></section>
    <section class="vibe-tier-grid">${tiers.map((tier, index) => `<article class="${score >= tier.minimum ? 'unlocked' : ''}" style="--tier:${tier.color}"><span>${tier.icon}</span><small>RANK ${index + 1}</small><h2>${tier.name}</h2><p>${tier.minimum.toLocaleString()}+ Vibe</p><b>${score >= tier.minimum ? 'Unlocked' : 'Locked'}</b></article>`).join('')}</section>
    <aside class="info-callout"><strong>How Vibe grows</strong><p>Post: +10 · Add a Take or reply: +4 · First reaction on a post or Take: +1. Repeated toggling does not generate extra Vibe.</p></aside>`;
}

const guildLandingSections = ['announcement', 'about', 'rules', 'featured', 'members', 'events', 'progress'];

function guildIdentityEditor(guild) {
  const identity = guild.viewerMembership?.guildProfile || {};
  const questions = guild.onboardingQuestions || [];
  return `<form class="guild-identity-form" id="guildIdentityForm"><div class="guild-studio-heading"><div><span class="section-kicker">MEMBER IDENTITY</span><h2>Your look inside ${escapeHtml(guild.name)}</h2><p>This identity is only shown in this guild.</p></div><span class="avatar avatar-frame-${escapeHtml(identity.avatarFrame || 'none')}" style="--identity:${escapeHtml(identity.themeColor || guild.themeColor || '#7444e8')}">${identity.avatarUrl ? `<img src="${escapeHtml(identity.avatarUrl)}" alt="" />` : escapeHtml((identity.nickname || state.profile.displayName || 'C').charAt(0))}</span></div><div class="form-grid"><label>Guild nickname<input name="nickname" maxlength="40" value="${escapeHtml(identity.nickname || '')}" placeholder="Use my Callout name" /></label><label>Identity color<input name="themeColor" type="color" value="${escapeHtml(identity.themeColor || guild.themeColor || '#7444e8')}" /></label><label>Avatar frame<select name="avatarFrame">${['none','spark','gold','violet','flame'].map(value => `<option value="${value}" ${identity.avatarFrame === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Guild avatar<input name="avatarFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label><label>Mini banner<input name="bannerFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label></div><label>Guild bio<textarea name="bio" maxlength="300" placeholder="What should this community know about you?">${escapeHtml(identity.bio || '')}</textarea></label>${questions.length ? `<fieldset><legend>Member onboarding</legend>${questions.map((question, index) => `<label>${escapeHtml(question.prompt)}<select name="onboarding_${index}" ${question.required ? 'required' : ''}><option value="">Choose an answer</option>${question.options.map(option => `<option>${escapeHtml(option)}</option>`).join('')}</select></label>`).join('')}</fieldset>` : ''}<input type="hidden" name="avatarUrl" value="${escapeHtml(identity.avatarUrl || '')}" /><input type="hidden" name="bannerUrl" value="${escapeHtml(identity.bannerUrl || '')}" /><button class="primary-action" type="submit">Save guild identity</button></form>`;
}

function guildSettingsEditor(guild) {
  const layout = guild.landingLayout?.length ? guild.landingLayout : ['announcement','about','rules','members','progress'];
  const emojiText = (guild.customEmojis || []).map(item => `${item.name}|${item.imageUrl}`).join('\n');
  const questions = (guild.onboardingQuestions || []).map(item => `${item.prompt}|${item.options.join(',')}|${item.required ? 'required' : 'optional'}`).join('\n');
  return `<form class="guild-settings-form guild-style-studio" id="guildSettingsForm"><div class="guild-studio-heading"><div><span class="section-kicker">GUILD STYLE STUDIO</span><h2>Build a community with its own identity</h2></div><div class="guild-template-actions">${['minimal','cinema','gaming','debate'].map(template => `<button type="button" data-guild-template="${template}">${template}</button>`).join('')}</div></div><div class="form-grid"><label>Guild name<input name="name" maxlength="60" value="${escapeHtml(guild.name)}" required /></label><label>Tagline<input name="tagline" maxlength="100" value="${escapeHtml(guild.tagline || '')}" /></label></div><label>Description<textarea name="description" maxlength="240">${escapeHtml(guild.description || '')}</textarea></label><label>Welcome message<textarea name="welcomeMessage" maxlength="500">${escapeHtml(guild.welcomeMessage || '')}</textarea></label><label>Pinned announcement<textarea name="pinnedAnnouncement" maxlength="500">${escapeHtml(guild.pinnedAnnouncement || '')}</textarea></label><label>Rules<textarea name="rules" maxlength="1200">${escapeHtml(guild.rules || '')}</textarea></label><div class="form-grid"><label>Privacy<select name="privacy"><option value="public" ${guild.privacy !== 'private' ? 'selected' : ''}>Public</option><option value="private" ${guild.privacy === 'private' ? 'selected' : ''}>Private</option></select></label><label>Invite code<input value="${escapeHtml(guild.inviteCode || '')}" readonly /></label><label>Icon image<input name="iconFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label><label>Banner image<input name="bannerFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label><label>Theme color<input name="themeColor" type="color" value="${escapeHtml(guild.themeColor || '#7444e8')}" /></label><label>Accent color<input name="accentColor" type="color" value="${escapeHtml(guild.accentColor || '#ff4713')}" /></label><label>Background<select name="backgroundPattern">${['clean','grid','waves','stars','noise'].map(value => `<option value="${value}" ${guild.backgroundPattern === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Card style<select name="cardStyle">${['solid','glass','outline','soft'].map(value => `<option value="${value}" ${guild.cardStyle === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Icon shape<select name="iconShape">${['circle','rounded','shield','hex'].map(value => `<option value="${value}" ${guild.iconShape === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Seasonal effect<select name="seasonalEffect">${['none','confetti','snow','embers','sparkles'].map(value => `<option value="${value}" ${guild.seasonalEffect === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label></div><div class="guild-settings-toggles"><label><input name="allowJoinRequests" type="checkbox" ${guild.settings?.allowJoinRequests !== false ? 'checked' : ''} /> Allow join requests</label><label><input name="showMemberList" type="checkbox" ${guild.settings?.showMemberList !== false ? 'checked' : ''} /> Show member list</label><label><input name="allowPerGuildProfiles" type="checkbox" ${guild.settings?.allowPerGuildProfiles !== false ? 'checked' : ''} /> Per-guild member profiles</label><label><input name="showOnlineStatus" type="checkbox" ${guild.settings?.showOnlineStatus !== false ? 'checked' : ''} /> Online status</label></div><div class="form-grid"><label>Reaction pack<input name="reactionSet" value="${escapeHtml((guild.reactionSet || []).join(' '))}" placeholder="👍 🔥 😂 💀" /><small>2–8 emoji separated by spaces.</small></label><label>Custom emoji library<textarea name="customEmojis" placeholder="name|https://image-url">${escapeHtml(emojiText)}</textarea><small>One name and image URL per line.</small></label><label>Onboarding builder<textarea name="onboardingQuestions" placeholder="Question|Option one,Option two|required">${escapeHtml(questions)}</textarea><small>One question per line.</small></label></div><fieldset class="layout-picker"><legend>Public landing page order</legend><div id="guildLayoutEditor">${layout.map((section, index) => `<span data-guild-layout-item="${section}"><strong>${section}</strong><button type="button" data-guild-layout-move="${index}" data-direction="-1" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-guild-layout-move="${index}" data-direction="1" ${index === layout.length - 1 ? 'disabled' : ''}>↓</button></span>`).join('')}</div></fieldset><input type="hidden" name="iconUrl" value="${escapeHtml(guild.iconUrl || '')}" /><input type="hidden" name="bannerUrl" value="${escapeHtml(guild.bannerUrl || '')}" /><input type="hidden" name="contentPrivacy" value="members" /><button class="primary-action" type="submit">Save guild studio</button></form>`;
}

function guildDetailView() {
  const id = decodeURIComponent(location.hash.split('/')[1] || '');
  const guild = state.activeGuild?.id === id ? state.activeGuild : null;
  if (!guild) return `${pageHeader('GUILD', 'Loading guild…', 'Opening the public guild profile.')}`;
  const tab = location.hash.split('/')[2] || (guild.joined ? 'feed' : 'public');
  const tabs = `<nav class="guild-tabs"><button data-guild-tab="public" class="${tab === 'public' ? 'active' : ''}">Public profile</button><button data-guild-tab="feed" class="${tab === 'feed' ? 'active' : ''}">Member feed</button><button data-guild-tab="chat" class="${tab === 'chat' ? 'active' : ''}">Group chat</button>${guild.joined ? `<button data-guild-tab="members" class="${tab === 'members' ? 'active' : ''}">Members</button><button data-guild-tab="identity" class="${tab === 'identity' ? 'active' : ''}">My identity</button>` : ''}${guild.permissions?.manageRoles ? `<button data-guild-tab="roles" class="${tab === 'roles' ? 'active' : ''}">Roles</button>` : ''}${guild.permissions?.viewAudit ? `<button data-guild-tab="audit" class="${tab === 'audit' ? 'active' : ''}">Audit</button>` : ''}${guild.permissions?.manageGuild ? `<button data-guild-tab="settings" class="${tab === 'settings' ? 'active' : ''}">Style studio</button>` : ''}</nav>`;
  const hero = `<section class="guild-hero guild-bg-${escapeHtml(guild.backgroundPattern || 'clean')} guild-cards-${escapeHtml(guild.cardStyle || 'solid')} guild-effect-${escapeHtml(guild.seasonalEffect || 'none')}" style="--guild-theme:${escapeHtml(guild.themeColor || '#7444e8')};--guild-accent:${escapeHtml(guild.accentColor || '#ff4713')}"><div class="guild-cover">${guild.bannerUrl ? `<img src="${escapeHtml(guild.bannerUrl)}" alt="" />` : ''}</div><div class="guild-hero-body"><span class="guild-profile-icon guild-icon-${escapeHtml(guild.iconShape || 'rounded')}">${guild.iconUrl ? `<img src="${escapeHtml(guild.iconUrl)}" alt="" />` : escapeHtml(guild.name.charAt(0))}</span><div><span class="section-kicker">LEVEL ${Number(guild.level || 1)} · ${guild.memberCount} MEMBERS</span><h1>${escapeHtml(guild.name)}</h1><p>${escapeHtml(guild.tagline || guild.description)}</p><div class="guild-xp-track"><i style="width:${Math.min(100, Number(guild.guildXp || 0) % 100)}%"></i></div></div><button class="${guild.joined ? 'quiet-action' : 'primary-action'}" type="button" data-toggle-guild="${guild.id}" ${guild.owner ? 'disabled' : ''}>${guild.owner ? 'Owner' : guild.joined ? 'Leave guild' : 'Join guild'}</button></div></section>`;
  let body = '';
  if (tab === 'public') body = `${guild.pinnedAnnouncement ? `<aside class="guild-announcement"><strong>Pinned announcement</strong><p>${escapeHtml(guild.pinnedAnnouncement)}</p></aside>` : ''}<section class="guild-public-grid"><article><span class="section-kicker">ABOUT</span><h2>${escapeHtml(guild.description || 'No description yet.')}</h2></article><article><span class="section-kicker">RULES</span><div class="formatted-copy">${escapeHtml(guild.rules || 'Guild rules have not been added yet.').replace(/\n/g, '<br>')}</div></article></section>`;
  else if (!guild.canViewContent) body = emptyState('🔒', 'Members-only area', 'This guild is public from the outside, but its feed and group chat are visible only to members.', `<button class="primary-action" type="button" data-toggle-guild="${guild.id}">Join guild</button>`);
  else if (tab === 'feed') body = `${guild.permissions?.createPosts ? `<form class="guild-post-composer" id="guildPostForm"><textarea name="content" maxlength="2000" required placeholder="Share something with ${escapeHtml(guild.name)}…"></textarea><select name="category"><option>Life</option><option>Entertainment</option><option>Movies</option><option>Music</option><option>Games</option></select><button class="primary-action" type="submit">Post to guild</button></form>` : '<aside class="info-callout"><strong>Read-only role</strong><p>The owner must grant Contributor posting permission before you can publish here.</p></aside>'}${state.guildPosts.length ? feedMarkup(state.guildPosts) : emptyState('✦', 'No guild posts yet', 'Permitted contributors can start the first conversation here.')}`;
  else if (tab === 'chat') body = guild.permissions?.chat ? `<section class="guild-chat"><div class="chat-stream">${state.guildMessages.length ? state.guildMessages.map(message => `<article><span class="avatar">${message.sender?.avatarUrl ? `<img src="${escapeHtml(message.sender.avatarUrl)}" alt="" />` : escapeHtml((message.sender?.displayName || 'C').charAt(0))}</span><div><strong>${escapeHtml(message.sender?.displayName || 'Member')}</strong><small>${timeLabel(new Date(message.createdAt).getTime())}</small><p>${escapeHtml(message.text)}</p></div></article>`).join('') : '<div class="stage-empty"><h2>No messages yet</h2><p>Start the guild group chat.</p></div>'}</div><form id="guildChatForm"><textarea name="text" maxlength="2000" required placeholder="Message the guild…"></textarea><button class="primary-action" type="submit">Send</button></form></section>` : emptyState('🔒', 'Chat permission required', 'Ask a guild moderator to grant a role with chat access.');
  else if (tab === 'members') body = `<section class="guild-member-list guild-identity-cards">${state.guildMembers.map(member => { const identity = member.guildProfile || {}; return `<article style="--member-accent:${escapeHtml(identity.themeColor || guild.themeColor || '#7444e8')}"><span class="avatar avatar-frame-${escapeHtml(identity.avatarFrame || 'none')}">${identity.avatarUrl || member.user?.avatarUrl ? `<img src="${escapeHtml(identity.avatarUrl || member.user.avatarUrl)}" alt="" />` : escapeHtml((identity.nickname || member.user?.displayName || 'C').charAt(0))}</span><div><strong>${escapeHtml(identity.nickname || member.user?.displayName || 'Member')}</strong><small><i class="status-dot ${escapeHtml(member.user?.status || 'invisible')}"></i> ${escapeHtml(member.roleKey)} · ${escapeHtml(member.status)}</small><span>${Number(member.contributionScore || 0)} contribution · ${Number(member.streakDays || 0)} day streak · ${Number(member.guildXp || 0)} XP</span></div>${guild.permissions?.manageMembers && member.roleKey !== 'owner' ? `<select data-member-role="${member.user.id}">${['moderator','contributor','chatter','viewer'].map(role => `<option value="${role}" ${member.roleKey === role ? 'selected' : ''}>${role}</option>`).join('')}</select>${member.status === 'pending' ? `<button data-approve-member="${member.user.id}">Approve</button>` : ''}` : ''}</article>`; }).join('') || '<p>No members yet.</p>'}</section>`;
  else if (tab === 'identity') body = guildIdentityEditor(guild);
  else if (tab === 'roles') body = `<section class="role-editor">${(guild.roles || []).filter(role => role.key !== 'owner').map(role => `<form data-role-form="${role.key}"><header><input name="icon" maxlength="12" value="${escapeHtml(role.icon || '◇')}" aria-label="Role icon" /><input name="name" maxlength="40" value="${escapeHtml(role.name)}" aria-label="Role name" /><input name="color" type="color" value="${escapeHtml(role.color)}" aria-label="Role color" /><small>${escapeHtml(role.key)}</small></header><div>${['manageGuild','manageRoles','manageMembers','managePosts','createPosts','chat','viewAudit'].map(permission => `<label><input type="checkbox" name="${permission}" ${role.permissions?.[permission] ? 'checked' : ''} />${permission.replace(/([A-Z])/g, ' $1')}</label>`).join('')}</div><button class="quiet-action" type="submit">Save role design</button></form>`).join('')}</section>`;
  else if (tab === 'audit') body = `<section class="audit-list">${state.guildAudit.map(item => `<article><strong>${escapeHtml(item.actor?.displayName || 'Member')}</strong><span>${escapeHtml(item.action)}</span><small>${new Date(item.createdAt).toLocaleString()}</small></article>`).join('') || '<p>No audited changes yet.</p>'}</section>`;
  else body = guildSettingsEditor(guild);
  return `${hero}${tabs}<div class="guild-workspace">${body}</div>`;
}

function notificationCategory(item) {
  if (['comment', 'reply', 'vote'].includes(item.type)) return 'takes';
  if (['guild', 'guild_invite'].includes(item.type)) return 'guilds';
  if (item.type === 'message') return 'messages';
  if (['friend_request', 'friend_accept'].includes(item.type)) return 'social';
  return 'system';
}

function notificationsView() {
  const filtered = state.notificationFilter === 'all' ? state.notifications : state.notifications.filter(item => notificationCategory(item) === state.notificationFilter);
  const grouped = Object.groupBy ? Object.groupBy(filtered, notificationCategory) : filtered.reduce((groups, item) => { (groups[notificationCategory(item)] ||= []).push(item); return groups; }, {});
  const row = item => `<article class="activity-item ${item.read ? '' : 'unread'}"><span class="avatar">${item.actor?.avatarUrl ? `<img src="${escapeHtml(item.actor.avatarUrl)}" alt="${escapeHtml(item.actor.displayName || 'Sender')}" />` : escapeHtml((item.actor?.displayName || 'C').charAt(0))}</span><div><span class="notification-kind">${notificationCategory(item).toUpperCase()}</span><strong>${escapeHtml(item.text)}</strong><small>${item.actor ? `${escapeHtml(item.actor.displayName)} · ` : ''}${timeLabel(new Date(item.createdAt).getTime())}</small></div><div class="notification-actions">${item.type === 'friend_request' ? `<button type="button" data-notification-user="${escapeHtml(item.actor?.id || '')}">View request</button>` : ''}${item.post ? `<button type="button" data-notification-post="${item.post}">Open</button>` : ''}${item.guild ? `<button type="button" data-notification-guild="${item.guild}">Open</button>` : ''}${item.type === 'message' && item.actor?.id ? `<button type="button" data-notification-message="${item.actor.id}">Chat</button>` : ''}${item.actor?.id ? `<button type="button" data-mute-notification="user" data-mute-id="${item.actor.id}">Mute</button>` : item.guild ? `<button type="button" data-mute-notification="guild" data-mute-id="${item.guild}">Mute</button>` : `<button type="button" data-mute-notification="category" data-mute-id="${item.category || notificationCategory(item)}">Mute</button>`}</div></article>`;
  const content = filtered.length ? `<section class="notification-groups">${Object.entries(grouped).map(([category, items]) => `<section><h2>${escapeHtml(category)}</h2><div class="activity-list">${items.map(row).join('')}</div></section>`).join('')}</section>` : emptyState('♢', 'Nothing in this category', 'Specific account activity will appear here when it happens.');
  return `${pageHeader('INBOX', 'Notifications', 'Votes, replies, guild activity, and system updates in one place.', '<button class="quiet-action" type="button" data-mark-read>Mark all as read</button>')}
    <div class="segmented-control notification-filters">${[['all','All'],['takes','Takes'],['messages','Messages'],['social','Friends'],['guilds','Guilds'],['system','System']].map(([key,label]) => `<button class="${state.notificationFilter === key ? 'active' : ''}" type="button" data-notification-filter="${key}">${label}</button>`).join('')}</div>
    ${content}`;
}

function conversationGroups() {
  const groups = new Map();
  for (const message of state.messages) {
    const other = String(message.sender?.id) === String(sessionUser?.id) ? message.recipient : message.sender;
    if (!other?.id) continue;
    if (!groups.has(String(other.id))) groups.set(String(other.id), { user: other, messages: [] });
    groups.get(String(other.id)).messages.push(message);
  }
  return [...groups.values()].sort((a, b) => new Date(b.messages.at(-1)?.createdAt || 0) - new Date(a.messages.at(-1)?.createdAt || 0));
}

function messagesView() {
  const groups = conversationGroups();
  const selectedId = decodeURIComponent(location.hash.split('/')[1] || '');
  const selected = groups.find(group => String(group.user.id) === selectedId) || (selectedId && String(state.publicProfile?.id) === selectedId ? { user: state.publicProfile, messages: [] } : null) || (selectedId && state.leaderboard.find(user => String(user.id) === selectedId) ? { user: state.leaderboard.find(user => String(user.id) === selectedId), messages: [] } : null);
  const items = groups.map(group => { const last = group.messages.at(-1); return `<button class="message-item ${String(group.user.id) === selectedId ? 'active' : ''}" type="button" data-conversation="${group.user.id}"><span class="avatar">${escapeHtml((group.user.displayName || 'C').charAt(0))}</span><div><strong>${escapeHtml(group.user.displayName || 'Member')}</strong><p>${escapeHtml(last?.text || '')}</p><small>${timeLabel(new Date(last?.createdAt).getTime())}</small></div></button>`; }).join('');
  const stage = selected ? `<section class="dm-chat"><header><span class="avatar">${escapeHtml((selected.user.displayName || 'C').charAt(0))}</span><div><strong>${escapeHtml(selected.user.displayName)}</strong><small>${escapeHtml(selected.user.handle || '')}</small></div><button type="button" data-open-user="${selected.user.id}">Profile</button></header><div class="chat-stream">${selected.messages.map(message => `<article class="dm-bubble ${String(message.sender?.id) === String(sessionUser?.id) ? 'sent' : 'received'}"><p>${escapeHtml(message.text)}</p><small>${timeLabel(new Date(message.createdAt).getTime())}</small></article>`).join('')}</div><form id="dmChatForm"><textarea name="message" maxlength="2000" required placeholder="Message ${escapeHtml(selected.user.displayName)}…"></textarea><input type="hidden" name="recipient" value="${selected.user.id}" /><button class="primary-action" type="submit">Send</button></form></section>` : '<div class="stage-empty"><div class="empty-icon">✉</div><h2>Select a conversation</h2><p>Choose an existing chat or start a new one.</p></div>';
  return `${pageHeader('DIRECT MESSAGES', 'Messages', 'Private conversations with people you connect with on Callout.', '<button class="primary-action" type="button" data-new-message>＋ New message</button>')}
    <section class="messages-layout">
      <aside class="conversation-list"><label><svg><use href="#i-search"></use></svg><input type="search" placeholder="Search messages" aria-label="Search messages" /></label>${items || '<div class="mini-empty"><span>✉</span><strong>No conversations</strong><p>Your message history will appear here.</p></div>'}</aside>
      <div class="conversation-stage" id="conversationStage">${stage}</div>
    </section>`;
}

function savedView() {
  const saved = state.posts.filter(post => state.savedPostIds.includes(post.id));
  return `${pageHeader('YOUR LIBRARY', 'Saved', 'Takes you want to revisit, kept private to your account.')}
    ${saved.length ? `<section class="take-list">${saved.map(postTemplate).join('')}</section>` : emptyState('◇', 'Nothing saved yet', 'Use the bookmark on a real take and it will be collected here.')}`;
}

function profileView() {
  const profile = state.profile;
  const data = { ...profile, ...(state.ownProfileData || {}), socialLinks: { ...profile.socialLinks, ...(state.ownProfileData?.socialLinks || {}) } };
  return `${pageHeader('ACCOUNT', 'Your profile', 'A customizable public identity with Discord-level detail.', '<button class="quiet-action" type="button" data-open-settings>Edit profile</button>')}
    <section class="profile-hero discord-profile profile-bg-${escapeHtml(profile.profileBackground)} profile-effect-${escapeHtml(profile.profileEffect)} aura-${escapeHtml(resolvedAura(profile))}" style="--profile-accent:${escapeHtml(profile.themeColor)}">
      <div class="profile-cover">${profile.bannerUrl ? `<img src="${escapeHtml(profile.bannerUrl)}" alt="Profile banner" />` : '<span>CALL IT LIKE YOU SEE IT.</span>'}</div>
      <div class="profile-identity">${avatarMarkup('profile-avatar')}<div><div class="identity-line"><h2>${escapeHtml(profile.displayName)}</h2><i class="status-dot ${escapeHtml(profile.status)}"></i></div><p>${escapeHtml(profile.handle)}${profile.pronouns ? ` · ${escapeHtml(profile.pronouns)}` : ''}</p></div><div class="vibe-stat-card"><span>✦</span><div><strong>${Number(profile.vibeScore || 0).toLocaleString()}</strong><small>VIBE SCORE</small></div></div></div>
    </section>
    ${profileTabs()}${profileTabPanel(data)}`;
}

function resolvedAura(user) {
  if (user.vibeAura && user.vibeAura !== 'auto') return user.vibeAura;
  const score = Number(user.vibeScore || 0);
  return score >= 1000 ? 'legend' : score >= 100 ? 'star' : 'rookie';
}

function formatBio(value) {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
}

const profileTabNames = ['posts', 'about', 'guilds', 'achievements', 'media', 'trophies'];
function profileTabs(user = state.profile) {
  const order = user.profileLayout?.length ? user.profileLayout : profileTabNames;
  return `<nav class="profile-tabs" aria-label="Profile sections">${order.filter(tab => profileTabNames.includes(tab)).map(tab => `<button type="button" data-profile-tab="${tab}" class="${state.profileTab === tab ? 'active' : ''}">${tab.charAt(0).toUpperCase()}${tab.slice(1)}</button>`).join('')}</nav>`;
}

function profileTabPanel(user) {
  const tab = state.profileTab;
  if (tab === 'trophies') {
    const score = Number(user.cringeScore || 0);
    const trophies = [{ icon: '◇', name: 'Fresh Voice', earned: true }, { icon: '⚡', name: 'Cringe Contender', earned: score >= 10 }, { icon: '🔥', name: 'Podium Menace', earned: score >= 50 }, { icon: '♛', name: 'Cringe Crown', earned: score >= 100 }];
    return `<section class="trophy-cabinet"><header><span class="section-kicker">CRINGE TROPHIES</span><h2>Your competitive cabinet</h2></header><div>${trophies.map(trophy => `<article class="${trophy.earned ? '' : 'locked'}"><span>${trophy.icon}</span><strong>${trophy.name}</strong><small>${trophy.earned ? 'Earned' : 'Locked'}</small></article>`).join('')}</div></section>`;
  }
  const allPosts = user.posts || [];
  const posts = user.showcaseMode === 'featured' && user.featuredPosts?.length ? user.featuredPosts : [...allPosts].sort((a, b) => user.showcaseMode === 'popular' ? (Number(b.alrightVotes || 0) + Number(b.cringeVotes || 0)) - (Number(a.alrightVotes || 0) + Number(a.cringeVotes || 0)) : user.showcaseMode === 'controversial' ? Math.abs(Number(a.alrightVotes || 0) - Number(a.cringeVotes || 0)) - Math.abs(Number(b.alrightVotes || 0) - Number(b.cringeVotes || 0)) : new Date(b.createdAt) - new Date(a.createdAt));
  if (tab === 'posts') return `<section class="profile-tab-panel">${posts.length ? `<div class="profile-post-list">${posts.map(post => `<article><small>${escapeHtml(post.category || 'Take')} · ${timeLabel(new Date(post.createdAt).getTime())}</small><strong>${formatPostContent(post.content || '')}</strong><span>${Number(post.alrightVotes || 0)} Alright · ${Number(post.cringeVotes || 0)} Cringe</span></article>`).join('')}</div>` : emptyState('✦', 'No posts yet', 'Published takes will appear on this profile.')}</section>`;
  if (tab === 'about') {
    const social = user.socialLinks || {};
    const links = [['𝕏', social.twitter], ['◎', social.instagram], ['◈', social.discord], ['▶', social.youtube], ['◉', social.twitch], ['↗', social.custom]].filter(([, value]) => value).map(([icon, value]) => `<span>${icon} ${escapeHtml(value)}</span>`);
    return `<section class="profile-summary"><div><span class="section-kicker">ABOUT ME</span><div class="formatted-copy">${formatBio(user.bio || 'No bio added yet.')}</div><p>Status: ${escapeHtml(String(user.status || 'offline').toUpperCase())}</p></div><div><span class="section-kicker">ACTIVITY</span><div class="profile-stats"><span><strong>${Number(user.stats?.posts ?? user.postCount ?? 0)}</strong> Posts</span><span><strong>${Number(user.stats?.comments || 0)}</strong> Takes</span><span><strong>${Number(user.stats?.guilds || 0)}</strong> Guilds</span></div><div class="profile-links">${links.length ? links.join('') : '<p>No social links added yet.</p>'}</div></div></section>`;
  }
  if (tab === 'guilds') return `<section class="profile-tab-panel">${user.guilds?.length ? `<div class="profile-guild-list">${user.guilds.map(guild => `<button type="button" data-open-guild="${guild.id}"><span class="guild-monogram">${guild.iconUrl ? `<img src="${escapeHtml(guild.iconUrl)}" alt="" />` : escapeHtml(guild.name.charAt(0))}</span><span><strong>${escapeHtml(guild.name)}</strong><small>${Number(guild.memberCount || 0)} members</small></span></button>`).join('')}</div>` : emptyState('⚔', 'No guilds to show', 'Guild memberships will appear here.')}</section>`;
  if (tab === 'achievements') return `<section class="badges-card"><div><span class="section-kicker">VIBE BADGES</span><h2>Earned through participation</h2></div><div class="badge-grid">${(user.vibeBadges?.length ? user.vibeBadges : [{ icon: '✦', name: 'New Voice' }]).map(badge => `<span title="${escapeHtml(badge.name)}">${escapeHtml(badge.icon)}<strong>${escapeHtml(badge.name)}</strong></span>`).join('')}<span class="locked" title="Keep building your Vibe">◇<strong>Next badge</strong></span></div></section>`;
  return `<section class="profile-tab-panel">${user.media?.length ? `<div class="profile-media-grid">${user.media.flatMap(post => post.media || []).map(item => item.type === 'video' ? `<video src="${escapeHtml(item.url)}" controls></video>` : `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt || 'Profile media')}" />`).join('')}</div>` : emptyState('▧', 'No media yet', 'Images, GIFs, and videos from published posts will appear here.')}</section>`;
}

function publicUserView() {
  const user = state.publicProfile;
  const id = decodeURIComponent(location.hash.split('/')[1] || '');
  if (!user || String(user.id) !== id) return `${pageHeader('PROFILE', 'Loading profile…', 'Fetching the latest public account details.')}`;
  const badges = user.vibeBadges || [];
  const friendButton = user.requestIncoming ? `<button class="quiet-action" type="button" data-accept-friend="${user.friendshipId}">Accept friend</button>` : `<button class="quiet-action" type="button" data-friend-user="${user.id}" ${['accepted','pending'].includes(user.friendship) ? 'disabled' : ''}>${user.friendship === 'accepted' ? 'Friends ✓' : user.friendship === 'pending' ? 'Request pending' : 'Add friend'}</button>`;
  return `<section class="public-user-card profile-bg-${escapeHtml(user.profileBackground || 'clean')} profile-effect-${escapeHtml(user.profileEffect || 'none')} aura-${escapeHtml(resolvedAura(user))}" style="--profile-accent:${escapeHtml(user.themeColor || '#ff4713')}"><div class="public-user-banner">${user.bannerUrl ? `<img src="${escapeHtml(user.bannerUrl)}" alt="" />` : ''}</div><div class="public-user-main"><span class="avatar avatar-frame-${escapeHtml(user.avatarFrame || 'none')}">${user.avatarUrl ? `<img src="${escapeHtml(user.avatarUrl)}" alt="" />` : escapeHtml((user.displayName || 'C').charAt(0))}</span><div><h1>${escapeHtml(user.displayName)}${user.isAutomated ? ' <span class="automation-label">AUTOMATED</span>' : ''}</h1><p>${escapeHtml(user.handle || '')}${user.pronouns ? ` · ${escapeHtml(user.pronouns)}` : ''}</p><small>${user.isAutomated ? `${escapeHtml(user.automationPersona || 'Callout automation')} · Clearly labelled automated account` : `✦ ${Number(user.vibeScore || 0).toLocaleString()} Vibe · ${badges.length} badges`}</small></div><div class="public-user-actions">${user.isAutomated ? '<span class="automation-notice">Operated by Callout</span>' : user.friendship === 'self' ? '<button class="quiet-action" data-open-settings>Edit profile</button>' : `${friendButton}<button class="primary-action" type="button" data-message-user="${user.id}">Message</button>`}</div></div>${profileTabs(user)}${profileTabPanel(user)}</section>`;
}

function settingsView() {
  const settings = state.settings;
  const checked = value => value ? 'checked' : '';
  return `${pageHeader('PREFERENCES', 'Settings', 'Manage appearance, notifications, privacy, and account details.')}
    <form class="settings-form" id="settingsForm">
      <section class="settings-section customization-studio"><div class="settings-section-head"><div><span class="settings-icon">✦</span><div><h2>Callout Style Studio</h2><p>Personalize your profile, feed, motion, and signature interactions.</p></div></div></div>
        <div class="customization-grid"><label>Color palette<select name="palette">${['callout','midnight','mint','violet','sunset'].map(value => `<option value="${value}" ${settings.palette === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Feed density<select name="feedDensity">${['compact','comfortable','spacious'].map(value => `<option value="${value}" ${settings.feedDensity === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Vote animation<select name="voteEffect">${['pop','confetti','pulse','none'].map(value => `<option value="${value}" ${settings.voteEffect === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Notification sound<select name="notificationSound">${['callout','spark','soft','none'].map(value => `<option value="${value}" ${settings.notificationSound === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Profile effect<select name="profileEffect">${['none','glow','bubbles','spotlight','confetti'].map(value => `<option value="${value}" ${state.profile.profileEffect === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Vibe aura<select name="vibeAura">${['auto','none','rookie','star','legend'].map(value => `<option value="${value}" ${state.profile.vibeAura === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Profile background<select name="profileBackground">${['clean','grid','waves','stars','noise'].map(value => `<option value="${value}" ${state.profile.profileBackground === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Take showcase<select name="showcaseMode">${['featured','popular','controversial','recent'].map(value => `<option value="${value}" ${state.profile.showcaseMode === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label></div>
        <label class="setting-row"><span><strong>Reduced motion</strong><small>Disable profile effects and animated feedback.</small></span><input class="switch-input" type="checkbox" name="reducedMotion" ${checked(settings.reducedMotion)} /><i></i></label>
        <label>Hidden feed topics<input name="hiddenTopics" value="${escapeHtml((settings.hiddenTopics || []).join(', '))}" placeholder="e.g. remakes, spoilers, celebrity news" /><small>Comma-separated topics you do not want in your feed.</small></label>
        <fieldset class="layout-picker"><legend>Profile section order</legend><div id="profileLayoutEditor">${(state.profile.profileLayout || profileTabNames).map((tab, index, list) => `<span data-layout-item="${tab}"><strong>${tab}</strong><button type="button" data-layout-move="${index}" data-direction="-1" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-layout-move="${index}" data-direction="1" ${index === list.length - 1 ? 'disabled' : ''}>↓</button></span>`).join('')}</div></fieldset>
        <fieldset class="cosmetic-collection"><legend>Unlocked cosmetic collection</legend><div>${Object.entries(state.profile.cosmeticUnlocks || {}).map(([kind, values]) => `<article><strong>${escapeHtml(kind)}</strong>${values.map(value => `<span>${escapeHtml(value)}</span>`).join('')}</article>`).join('')}</div></fieldset>
        <fieldset class="featured-badge-picker"><legend>Featured profile badges</legend><div>${(state.profile.vibeBadges || []).map(badge => `<label><input type="checkbox" name="featuredBadge" value="${escapeHtml(badge.name)}" ${(state.profile.featuredBadges || []).includes(badge.name) ? 'checked' : ''} /><span>${escapeHtml(badge.icon)} ${escapeHtml(badge.name)}</span></label>`).join('') || '<p>Earn Vibe badges to feature them on your profile.</p>'}</div><small>Select up to three.</small></fieldset>
      </section>
      <section class="settings-section"><div class="settings-section-head"><div><span class="settings-icon">◐</span><div><h2>Appearance</h2><p>Choose how Callout looks on this device.</p></div></div></div>
        <div class="theme-options" role="radiogroup" aria-label="Theme"><label><input type="radio" name="theme" value="light" ${checked(settings.theme === 'light')} /><span>☀<strong>Light</strong><small>Bright and crisp</small></span></label><label><input type="radio" name="theme" value="dark" ${checked(settings.theme === 'dark')} /><span>◐<strong>Dark</strong><small>Easy on the eyes</small></span></label><label><input type="radio" name="theme" value="system" ${checked(settings.theme === 'system')} /><span>◫<strong>System</strong><small>Match your device</small></span></label></div>
      </section>
      <section class="settings-section"><div class="settings-section-head"><div><span class="settings-icon">♢</span><div><h2>Notification preferences</h2><p>Choose what deserves your attention.</p></div></div></div>
        <div class="setting-rows"><label class="setting-row"><span><strong>Likes</strong><small>Votes on your posts</small></span><input class="switch-input" type="checkbox" name="notifyLikes" ${checked(settings.notifications.likes)} /><i></i></label><label class="setting-row"><span><strong>Takes</strong><small>Replies and comments</small></span><input class="switch-input" type="checkbox" name="notifyComments" ${checked(settings.notifications.comments)} /><i></i></label><label class="setting-row"><span><strong>Guild activity</strong><small>Invites and community updates</small></span><input class="switch-input" type="checkbox" name="notifyGuildInvites" ${checked(settings.notifications.guildInvites)} /><i></i></label><label class="setting-row"><span><strong>In-app delivery</strong></span><input class="switch-input" type="checkbox" name="deliveryInApp" ${checked(settings.notificationDelivery?.inApp)} /><i></i></label><label class="setting-row"><span><strong>Push delivery</strong></span><input class="switch-input" type="checkbox" name="deliveryPush" ${checked(settings.notificationDelivery?.push)} /><i></i></label><label class="setting-row"><span><strong>Email delivery</strong></span><input class="switch-input" type="checkbox" name="deliveryEmail" ${checked(settings.notificationDelivery?.email)} /><i></i></label></div>
      </section>
      <section class="settings-section"><div class="settings-section-head"><div><span class="settings-icon">⌁</span><div><h2>Privacy</h2><p>Control who can reach you directly.</p></div></div></div>
        <label class="select-setting">Who can send you Direct Messages?<select name="directMessages"><option value="everyone" ${settings.directMessages === 'everyone' ? 'selected' : ''}>Everyone</option><option value="guilds" ${settings.directMessages === 'guilds' ? 'selected' : ''}>Guild Members Only</option><option value="nobody" ${settings.directMessages === 'nobody' ? 'selected' : ''}>Nobody</option></select></label>
      </section>
      <section class="settings-section"><div class="settings-section-head"><div><span class="settings-icon">Aa</span><div><h2>Display options</h2><p>Set the text size used for feed content.</p></div></div></div>
        <div class="text-size-options" role="radiogroup" aria-label="Feed text size"><label><input type="radio" name="textSize" value="small" ${checked(settings.textSize === 'small')} /><span>Small</span></label><label><input type="radio" name="textSize" value="medium" ${checked(settings.textSize === 'medium')} /><span>Medium</span></label><label><input type="radio" name="textSize" value="large" ${checked(settings.textSize === 'large')} /><span>Large</span></label></div>
      </section>
      <section class="settings-section"><div class="settings-section-head"><div><span class="settings-icon">✎</span><div><h2>Profile customization</h2><p>Build a profile that feels distinctly yours.</p></div></div></div>
        <div class="profile-live-preview" id="profilePreview" style="--profile-accent:${escapeHtml(state.profile.themeColor)}"><div class="preview-banner" id="bannerPreview">${state.profile.bannerUrl ? `<img src="${escapeHtml(state.profile.bannerUrl)}" alt="Banner preview" />` : ''}</div><div>${avatarMarkup('preview-avatar')}<span><strong id="previewName">${escapeHtml(state.profile.displayName)}</strong><small id="previewStatus">${escapeHtml(state.profile.status)}</small></span><b>✦ ${Number(state.profile.vibeScore || 0).toLocaleString()}</b></div></div>
        <div class="form-grid"><label>Display name<input name="displayName" maxlength="40" value="${escapeHtml(state.profile.displayName)}" required /></label><label>Username<input name="handle" maxlength="30" value="${escapeHtml(state.profile.handle)}" required /></label><label>Pronouns<input name="pronouns" maxlength="40" value="${escapeHtml(state.profile.pronouns)}" placeholder="e.g. they/them" /></label><label>Online status<select name="status"><option value="online" ${state.profile.status === 'online' ? 'selected' : ''}>Online</option><option value="idle" ${state.profile.status === 'idle' ? 'selected' : ''}>Idle</option><option value="dnd" ${state.profile.status === 'dnd' ? 'selected' : ''}>Do Not Disturb</option><option value="invisible" ${state.profile.status === 'invisible' ? 'selected' : ''}>Invisible</option></select></label></div>
        <div class="form-grid"><label>Profile banner<input id="bannerUpload" type="file" accept="image/*" /><small>PNG, JPG, GIF, or WebP. Maximum 2 MB.</small></label><label>Avatar or animated GIF<input id="avatarUpload" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /><small>Animated GIF avatars are supported. Maximum 2 MB.</small></label><label>Theme color<div class="color-control"><input name="themeColor" type="color" value="${escapeHtml(state.profile.themeColor)}" /><output id="colorHex">${escapeHtml(state.profile.themeColor)}</output></div></label><label>Avatar frame<select name="avatarFrame">${['none','spark','gold','violet','flame'].map(frame => `<option value="${frame}" ${state.profile.avatarFrame === frame ? 'selected' : ''}>${frame}</option>`).join('')}</select></label></div>
        <input type="hidden" name="bannerUrl" value="${escapeHtml(state.profile.bannerUrl)}" /><input type="hidden" name="avatarUrl" value="${escapeHtml(state.profile.avatarUrl)}" />
        <label>About Me <span class="field-counter" id="bioCounter">${state.profile.bio.length} / 1000</span><textarea name="bio" maxlength="1000" placeholder="Use **bold**, *italic*, and line breaks to tell your story.">${escapeHtml(state.profile.bio)}</textarea></label>
        <div class="social-fields"><h3>Social media</h3><label><span>𝕏</span><input name="twitter" value="${escapeHtml(state.profile.socialLinks.twitter)}" placeholder="x.com/username" /></label><label><span>◎</span><input name="instagram" value="${escapeHtml(state.profile.socialLinks.instagram)}" placeholder="instagram.com/username" /></label><label><span>◈</span><input name="discord" value="${escapeHtml(state.profile.socialLinks.discord)}" placeholder="Discord username" /></label><label><span>▶</span><input name="youtube" value="${escapeHtml(state.profile.socialLinks.youtube)}" placeholder="youtube.com/@channel" /></label><label><span>◉</span><input name="twitch" value="${escapeHtml(state.profile.socialLinks.twitch)}" placeholder="twitch.tv/username" /></label><label><span>↗</span><input name="custom" value="${escapeHtml(state.profile.socialLinks.custom)}" placeholder="https://your-site.example" /></label></div>
      </section>
      <section class="settings-section"><div class="settings-section-head"><div><span class="settings-icon">⊘</span><div><h2>Blocked & muted users</h2><p>Accounts you have restricted will be listed here.</p></div></div></div>
        <div class="blocked-list">${settings.blockedUsers.length ? settings.blockedUsers.map(user => `<div><span class="skeleton-avatar small"></span><strong>${escapeHtml(user)}</strong><button type="button" data-unblock="${escapeHtml(user)}">Unblock</button></div>`).join('') : '<div class="blocked-empty"><span class="skeleton-avatar small"></span><span><strong>No blocked accounts</strong><small>Blocked users will appear here.</small></span><button type="button" disabled>Unblock</button></div>'}</div>
      </section>
      <div class="settings-save"><span>Preferences are saved on this device.</span><button class="primary-action" type="submit">Save settings</button></div>
    </form>`;
}

function analyticsView() {
  if (!sessionUser) return emptyState('↗', 'Sign in required', 'The analytics dashboard is restricted to the Callout administrator.', '<button class="primary-action" type="button" data-go-auth>Sign in</button>');
  if (!sessionUser.isAdmin) return emptyState('🔒', 'Admin access required', 'Traffic and performance data is private and is not available to standard accounts.');
  if (state.analyticsError) return `${pageHeader('PRIVATE DASHBOARD', 'Analytics', 'Google Analytics traffic and performance reporting.')}<section class="analytics-setup"><strong>Analytics API unavailable</strong><p>${escapeHtml(state.analyticsError)}</p><button class="quiet-action" type="button" data-refresh-analytics>Try again</button></section>`;
  if (!state.analytics) return `${pageHeader('PRIVATE DASHBOARD', 'Analytics', 'Loading Google Analytics traffic and performance data.')}<section class="analytics-loading"><span></span><span></span><span></span></section>`;
  if (!state.analytics.configured) return `${pageHeader('PRIVATE DASHBOARD', 'Analytics', 'Google Analytics traffic and performance reporting.')}<section class="analytics-setup"><span class="settings-icon">GA</span><div><strong>Connect the Analytics Data API</strong><p>Tracking can run with a Measurement ID. Dashboard reporting additionally requires the property ID and a read-only service account.</p><code>GA_PROPERTY_ID · GA_CLIENT_EMAIL · GA_PRIVATE_KEY</code></div></section>`;

  const analytics = state.analytics;
  const adsense = analytics.adsense || {};
  const summary = analytics.summary || {};
  const maxViews = Math.max(1, ...(analytics.daily || []).map(item => item.screenPageViews));
  const cards = [
    ['Active users', summary.activeUsers, 'People who engaged'], ['Sessions', summary.sessions, 'Visits'],
    ['Page views', summary.screenPageViews, 'Pages viewed'], ['New users', summary.newUsers, 'First-time visitors'],
    ['Engagement', `${(Number(summary.engagementRate || 0) * 100).toFixed(1)}%`, 'Engaged sessions'],
    ['Avg. session', `${Math.round(Number(summary.averageSessionDuration || 0))}s`, 'Average duration']
  ];
  const table = (rows, kind) => rows.length ? rows.map((row, index) => kind === 'pages'
    ? `<tr><td>${index + 1}</td><td title="${escapeHtml(row.path)}">${escapeHtml(row.path)}</td><td>${Number(row.screenPageViews).toLocaleString()}</td><td>${Number(row.activeUsers).toLocaleString()}</td></tr>`
    : `<tr><td>${index + 1}</td><td>${escapeHtml(row.channel)}</td><td>${Number(row.sessions).toLocaleString()}</td><td>${Number(row.activeUsers).toLocaleString()}</td></tr>`).join('') : '<tr><td colspan="4">No data has been collected for this range yet.</td></tr>';
  const money = value => new Intl.NumberFormat(undefined, { style: 'currency', currency: adsense.currencyCode || 'EUR', maximumFractionDigits: 2 }).format(Number(value || 0));
  const siteStatus = String(adsense.siteStatus || 'GETTING_READY').replaceAll('_', ' ').toLowerCase();
  const adsenseSection = adsense.connected
    ? `<section class="adsense-analytics"><header><div><span class="section-kicker">MONETISATION</span><h2>AdSense earnings</h2></div><span class="adsense-status ${adsense.siteStatus === 'READY' ? 'ready' : 'pending'}">${escapeHtml(siteStatus)}</span></header><div class="adsense-metrics"><article><small>Estimated earnings</small><strong>${money(adsense.summary?.estimatedEarnings)}</strong><span>${state.analyticsDays}-day estimate</span></article><article><small>Ad impressions</small><strong>${Number(adsense.summary?.impressions || 0).toLocaleString()}</strong><span>Paid ad displays</span></article><article><small>Ad clicks</small><strong>${Number(adsense.summary?.clicks || 0).toLocaleString()}</strong><span>Valid clicks</span></article><article><small>Impression RPM</small><strong>${money(adsense.summary?.impressionsRpm)}</strong><span>Revenue per 1,000 impressions</span></article></div><p>Figures come directly from Google AdSense and may be adjusted after invalid-traffic checks.</p></section>`
    : `<section class="adsense-analytics adsense-connect"><header><div><span class="section-kicker">MONETISATION</span><h2>AdSense earnings</h2></div><span class="adsense-status pending">${escapeHtml(siteStatus)}</span></header><div><strong>${adsense.error ? 'AdSense needs to be reconnected' : 'Google is reviewing Callout'}</strong><p>${adsense.error ? escapeHtml(adsense.error) : 'Paid ads cannot appear until Google changes the site from Getting ready to Ready. Connect the read-only reporting API now so earnings will appear here automatically after approval.'}</p><a class="primary-action" href="/api/admin/reporting/connect">Connect AdSense reporting</a></div></section>`;
  const automation = state.botAutomation || { bots: [], intervalMinutes: 360 };
  const botsSection = `<section class="bot-admin"><header><div><span class="section-kicker">COMMUNITY AUTOMATION</span><h2>Automated hosts</h2><p>Clearly labelled accounts using original curated opinions. One action at most every ${Number(automation.intervalMinutes)} minutes.</p></div><button class="primary-action" type="button" data-run-bots>Run one action</button></header><div>${automation.bots.map(bot => `<article><span class="avatar">${escapeHtml((bot.displayName || 'B').charAt(0))}</span><div><strong>${escapeHtml(bot.displayName)}</strong><small>${escapeHtml(bot.handle)} · ${escapeHtml(bot.persona || '')}</small><span>${bot.lastRunAt ? `Last active ${timeLabel(new Date(bot.lastRunAt).getTime())}` : 'Ready for first activity'} · ${Number(bot.postCount || 0)} posts</span></div><label class="bot-toggle"><input type="checkbox" data-toggle-bot="${bot.id}" ${bot.enabled ? 'checked' : ''} /><i></i><span>${bot.enabled ? 'Active' : 'Paused'}</span></label></article>`).join('') || '<p>Automated accounts are being initialized.</p>'}</div></section>`;
  return `${pageHeader('PRIVATE DASHBOARD', 'Analytics', 'Traffic, acquisition, and performance data from Google Analytics and AdSense.', `<button class="quiet-action" type="button" data-refresh-analytics>Refresh</button>`)}
    <div class="analytics-toolbar"><div class="analytics-ranges">${[7,28,90].map(days => `<button type="button" data-analytics-days="${days}" class="${state.analyticsDays === days ? 'active' : ''}">${days} days</button>`).join('')}</div><span><i></i><strong>${Number(analytics.realtime?.activeUsers || 0)}</strong> active now</span></div>
    <section class="analytics-cards">${cards.map(([label,value,note]) => `<article><small>${label}</small><strong>${typeof value === 'number' ? value.toLocaleString() : value}</strong><span>${note}</span></article>`).join('')}</section>
    ${adsenseSection}${botsSection}
    <section class="analytics-chart"><header><div><span class="section-kicker">TRAFFIC TREND</span><h2>Daily page views</h2></div><small>Updated ${new Date(analytics.generatedAt).toLocaleString()}</small></header><div class="analytics-bars">${(analytics.daily || []).map(item => `<div title="${item.date}: ${item.screenPageViews} views"><span style="height:${Math.max(4, item.screenPageViews / maxViews * 100)}%"></span><small>${item.date.slice(5)}</small></div>`).join('') || '<p>No daily traffic yet.</p>'}</div></section>
    <section class="analytics-tables"><article><header><span class="section-kicker">CONTENT</span><h2>Top pages</h2></header><div class="analytics-table-scroll"><table><thead><tr><th>#</th><th>Path</th><th>Views</th><th>Users</th></tr></thead><tbody>${table(analytics.pages || [], 'pages')}</tbody></table></div></article><article><header><span class="section-kicker">ACQUISITION</span><h2>Traffic channels</h2></header><div class="analytics-table-scroll"><table><thead><tr><th>#</th><th>Channel</th><th>Sessions</th><th>Users</th></tr></thead><tbody>${table(analytics.channels || [], 'channels')}</tbody></table></div></article></section>`;
}

function authView() {
  if (sessionUser) return `${pageHeader('SECURITY', 'Account access', 'Your session is protected by short-lived HTTP-only cookies.')}<section class="auth-session-card">${sessionUser.avatarUrl ? `<span class="avatar"><img src="${escapeHtml(sessionUser.avatarUrl)}" alt="" /></span>` : '<span class="avatar">✓</span>'}<div><span class="section-kicker">SIGNED IN</span><h2>${escapeHtml(sessionUser.displayName)}</h2><p>${escapeHtml(sessionUser.email)}</p></div><button class="quiet-action" type="button" data-logout>Sign out</button></section>`;
  return `${pageHeader('SECURE ACCESS', 'Join Callout', 'Sign in with email or Google. Authentication tokens are never stored in localStorage.')}
    <section class="auth-grid"><form class="auth-card" id="loginForm"><span class="section-kicker">WELCOME BACK</span><h2>Sign in</h2><label>Email<input type="email" name="email" autocomplete="email" required /></label><label>Password<input type="password" name="password" autocomplete="current-password" required minlength="8" /></label><button class="primary-action" type="submit">Sign in</button><a class="google-auth" href="/api/auth/google">G&nbsp; Continue with Google</a></form>
    <form class="auth-card" id="signupForm"><span class="section-kicker">NEW ACCOUNT</span><h2>Create account</h2><label>Display name<input name="displayName" maxlength="40" required /></label><label>Email<input type="email" name="email" autocomplete="email" required /></label><label>Password<input type="password" name="password" autocomplete="new-password" required minlength="8" /></label><label class="age-check"><input type="checkbox" name="ageConfirmed" required /><span>I confirm I am 13 years or older.</span></label><button class="primary-action" type="submit">Create account</button><a class="google-auth" href="/api/auth/google">G&nbsp; Sign up with Google</a></form></section>
    <details class="reset-panel"><summary>Forgot your password?</summary><form id="resetRequestForm"><label>Email<input type="email" name="email" required /></label><button class="quiet-action" type="submit">Request reset</button></form><form id="resetConfirmForm" hidden><label>Email<input type="email" name="email" required /></label><label>Reset token<input name="token" required /></label><label>New password<input type="password" name="password" minlength="8" required /></label><button class="primary-action" type="submit">Update password</button></form></details>`;
}

const viewRenderers = { home: homeView, trending: trendingView, guilds: guildsView, guild: guildDetailView, leaderboards: leaderboardsView, 'vibe-progress': vibeProgressView, notifications: notificationsView, messages: messagesView, saved: savedView, profile: profileView, user: publicUserView, settings: settingsView, analytics: analyticsView, take: takeDetailView, auth: authView };

function renderRoute() {
  const route = currentRoute();
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route || (route === 'take' && item.dataset.route === 'home') || (route === 'guild' && item.dataset.route === 'guilds') || (route === 'vibe-progress' && item.dataset.route === 'profile')));
  document.querySelector('#sidebar').classList.remove('open');
  mainContent.innerHTML = viewRenderers[route]();
  mainContent.dataset.route = route;
  document.title = `${route === 'home' ? 'Callout' : `${route.charAt(0).toUpperCase()}${route.slice(1)} · Callout`}`;
  bindViewInteractions(route);
  initializeAds(mainContent);
  trackPageView();
  mainContent.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderFilteredPosts(category = 'All', search = '') {
  const filtered = state.posts.filter(post => (category === 'All' || post.category === category) && post.text.toLowerCase().includes(search.toLowerCase()));
  const results = document.querySelector('#feedResults');
  if (!results) return;
  results.innerHTML = filtered.length
    ? feedMarkup(filtered)
    : emptyState('✦', state.posts.length ? 'No matching takes' : 'No takes to show yet', state.posts.length ? 'Try a different category or search.' : 'Your feed is ready for real community posts. Create the first take to see voting come alive.', '<button class="primary-action" type="button" data-open-composer>Post a take</button>');
  bindPostInteractions();
}

function findPostById(id) {
  return [...state.posts, ...state.guildPosts].find(item => String(item.id) === String(id));
}

function bindPostInteractions() {
  document.querySelectorAll('[data-vote]').forEach(button => button.addEventListener('click', async () => {
    const card = button.closest('[data-post-id]');
    const post = findPostById(card.dataset.postId);
    if (!post) return;
    if (!sessionUser) { navigate('auth'); return showToast('Sign in to vote.'); }
    const nextVote = button.dataset.vote;
    try {
      const payload = await apiFetch(`/api/posts/${post.databaseId}/vote`, { method: 'POST', body: JSON.stringify({ value: nextVote }) });
      Object.assign(post, { alrightVotes: payload.post.alrightVotes, cringeVotes: payload.post.cringeVotes, userVote: payload.post.userVote, impressions: payload.post.impressions });
      runVoteEffect(button, nextVote);
      await Promise.all([hydrateTrending(), hydrateSession(), hydrateLeaderboard()]); renderRoute();
      trackEvent('rank_post', { rank_value: nextVote, post_category: post.category });
      showToast(payload.post.userVote ? `You called it ${nextVote === 'alright' ? 'Alright' : 'Cringe'}.` : 'Vote removed.');
    } catch (error) { showToast(error.message); }
  }));
  document.querySelectorAll('[data-save-post]').forEach(button => button.addEventListener('click', async () => {
    const id = button.dataset.savePost;
    if (!sessionUser) { navigate('auth'); return showToast('Sign in to save posts.'); }
    try { const payload = await apiFetch(`/api/posts/${id}/save`, { method: 'POST' }); state.savedPostIds = payload.savedPostIds.map(String); persist(); renderRoute(); showToast(payload.saved ? 'Saved for later.' : 'Removed from saved.'); }
    catch (error) { showToast(error.message); }
  }));
  document.querySelectorAll('[data-open-take]').forEach(element => {
    const open = () => navigate(`take/${element.dataset.openTake}`);
    element.addEventListener('click', open);
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
  document.querySelectorAll('[data-post-menu]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); openPostMenu(button.dataset.postMenu); }));
  document.querySelectorAll('[data-poll-option]').forEach(button => button.addEventListener('click', async () => {
    if (!sessionUser) { navigate('auth'); return showToast('Sign in to vote in polls.'); }
    try { const payload = await apiFetch(`/api/posts/${button.dataset.pollPost}/poll-vote`, { method: 'POST', body: JSON.stringify({ optionId: button.dataset.pollOption }) }); Object.assign(findPostById(button.dataset.pollPost), mapPost(payload.post)); renderRoute(); }
    catch (error) { showToast(error.message); }
  }));
}

function bindViewInteractions(route) {
  bindPostInteractions();
  document.querySelectorAll('[data-open-composer]').forEach(button => button.addEventListener('click', openComposerForUser));
  document.querySelectorAll('[data-create-guild]').forEach(button => button.addEventListener('click', () => guildComposer.showModal()));
  document.querySelectorAll('.segmented-control button').forEach(button => button.addEventListener('click', () => {
    button.parentElement.querySelectorAll('button').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
  }));
  document.querySelectorAll('[data-feed-tab]').forEach(button => button.addEventListener('click', () => {
    button.parentElement.querySelectorAll('button').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    if (button.dataset.feedTab === 'Following') document.querySelector('#feedResults').innerHTML = emptyState('◎', 'No followed accounts yet', 'Posts from people you follow will appear here.');
    else renderFilteredPosts();
  }));
  document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
    button.parentElement.querySelectorAll('button').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    renderFilteredPosts(button.dataset.category);
  }));
  document.querySelector('[data-mark-read]')?.addEventListener('click', async () => { try { await apiFetch('/api/notifications/read', { method: 'POST' }); state.notifications.forEach(item => { item.read = true; }); renderRoute(); showToast('Notifications marked as read.'); } catch (error) { showToast(error.message); } });
  document.querySelector('[data-new-message]')?.addEventListener('click', renderMessageComposer);
  document.querySelector('[data-open-settings]')?.addEventListener('click', () => navigate('settings'));
  document.querySelector('[data-go-auth]')?.addEventListener('click', () => navigate('auth'));
  document.querySelectorAll('[data-analytics-days]').forEach(button => button.addEventListener('click', async () => { state.analyticsDays = Number(button.dataset.analyticsDays); state.analytics = null; renderRoute(); await hydrateAnalytics(); renderRoute(); }));
  document.querySelector('[data-refresh-analytics]')?.addEventListener('click', async () => { state.analytics = null; state.analyticsError = ''; renderRoute(); await hydrateAnalytics(); renderRoute(); });
  document.querySelector('[data-run-bots]')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { const payload = await apiFetch('/api/admin/bots/run', { method: 'POST' }); state.botAutomation.bots = payload.bots; await Promise.all([hydratePosts(), hydrateTrending()]); renderRoute(); showToast(`${payload.result.bot || 'Automation'} completed a ${payload.result.action} action.`); }
    catch (error) { showToast(error.message); event.currentTarget.disabled = false; }
  });
  document.querySelectorAll('[data-toggle-bot]').forEach(input => input.addEventListener('change', async () => {
    try { await apiFetch(`/api/admin/bots/${input.dataset.toggleBot}`, { method: 'PATCH', body: JSON.stringify({ enabled: input.checked }) }); state.botAutomation = await apiFetch('/api/admin/bots'); renderRoute(); showToast(input.checked ? 'Automated account activated.' : 'Automated account paused.'); }
    catch (error) { input.checked = !input.checked; showToast(error.message); }
  }));
  document.querySelectorAll('[data-layout-move]').forEach(button => button.addEventListener('click', () => {
    const order = [...document.querySelectorAll('[data-layout-item]')].map(item => item.dataset.layoutItem);
    const index = Number(button.dataset.layoutMove); const next = index + Number(button.dataset.direction);
    if (next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]]; state.profile.profileLayout = order; renderRoute();
  }));
  document.querySelectorAll('[data-profile-tab]').forEach(button => button.addEventListener('click', () => { state.profileTab = button.dataset.profileTab; renderRoute(); }));
  document.querySelector('[data-back-feed]')?.addEventListener('click', () => navigate('home'));
  document.querySelector('#commentForm')?.addEventListener('submit', addComment);
  document.querySelectorAll('[data-comment-emoji]').forEach(button => button.addEventListener('click', () => { const textarea = button.closest('form').elements.comment; textarea.value += button.dataset.commentEmoji; textarea.focus(); }));
  document.querySelector('#settingsForm')?.addEventListener('submit', saveSettings);
  document.querySelectorAll('input[name="theme"], input[name="textSize"]').forEach(input => input.addEventListener('change', previewDisplaySettings));
  document.querySelector('#settingsForm')?.addEventListener('input', updateProfilePreview);
  document.querySelector('#bannerUpload')?.addEventListener('change', handleBannerUpload);
  document.querySelector('#avatarUpload')?.addEventListener('change', handleAvatarUpload);
  document.querySelectorAll('[data-reply-comment]').forEach(button => button.addEventListener('click', () => openReplyComposer(button.dataset.replyComment)));
  document.querySelectorAll('[data-upvote-comment]').forEach(button => button.addEventListener('click', () => toggleCommentVote(button.dataset.upvoteComment)));
  document.querySelectorAll('[data-unblock]').forEach(button => button.addEventListener('click', () => unblockUser(button.dataset.unblock)));
  document.querySelectorAll('[data-open-guild]').forEach(button => button.addEventListener('click', () => navigate(`guild/${button.dataset.openGuild}/public`)));
  document.querySelectorAll('[data-toggle-guild]').forEach(button => button.addEventListener('click', async () => {
    if (!sessionUser) { navigate('auth'); return showToast('Sign in to join a guild.'); }
    try { await apiFetch(`/api/guilds/${button.dataset.toggleGuild}/membership`, { method: 'POST' }); await Promise.all([hydrateGuilds(), hydrateGuildDetail()]); renderRoute(); showToast('Guild membership updated.'); } catch (error) { showToast(error.message); }
  }));
  document.querySelectorAll('[data-guild-tab]').forEach(button => button.addEventListener('click', () => navigate(`guild/${state.activeGuild.id}/${button.dataset.guildTab}`)));
  document.querySelector('#guildPostForm')?.addEventListener('submit', createGuildFeedPost);
  document.querySelector('#guildChatForm')?.addEventListener('submit', sendGuildChatMessage);
  document.querySelector('#guildSettingsForm')?.addEventListener('submit', saveGuildSettings);
  document.querySelector('#guildIdentityForm')?.addEventListener('submit', saveGuildIdentity);
  document.querySelectorAll('[data-guild-template]').forEach(button => button.addEventListener('click', applyGuildTemplate));
  document.querySelectorAll('[data-guild-layout-move]').forEach(button => button.addEventListener('click', moveGuildLayoutSection));
  document.querySelectorAll('[data-role-form]').forEach(form => form.addEventListener('submit', saveGuildRole));
  document.querySelectorAll('[data-member-role]').forEach(select => select.addEventListener('change', updateGuildMemberRole));
  document.querySelectorAll('[data-approve-member]').forEach(button => button.addEventListener('click', approveGuildMember));
  document.querySelectorAll('[data-notification-filter]').forEach(button => button.addEventListener('click', () => { state.notificationFilter = button.dataset.notificationFilter; renderRoute(); }));
  document.querySelectorAll('[data-notification-post]').forEach(button => button.addEventListener('click', () => navigate(`take/${button.dataset.notificationPost}`)));
  document.querySelectorAll('[data-notification-guild]').forEach(button => button.addEventListener('click', () => navigate(`guild/${button.dataset.notificationGuild}/public`)));
  document.querySelectorAll('[data-notification-message]').forEach(button => button.addEventListener('click', () => navigate(`messages/${button.dataset.notificationMessage}`)));
  document.querySelectorAll('[data-notification-user]').forEach(button => button.addEventListener('click', () => navigate(`user/${button.dataset.notificationUser}`)));
  document.querySelectorAll('[data-mute-notification]').forEach(button => button.addEventListener('click', () => openNotificationMute(button.dataset.muteNotification, button.dataset.muteId)));
  document.querySelectorAll('[data-conversation]').forEach(button => button.addEventListener('click', () => navigate(`messages/${button.dataset.conversation}`)));
  document.querySelector('#dmChatForm')?.addEventListener('submit', sendDirectMessage);
  document.querySelectorAll('[data-open-user]').forEach(button => button.addEventListener('click', () => navigate(`user/${button.dataset.openUser}`)));
  document.querySelectorAll('[data-leader-user]').forEach(button => button.addEventListener('click', () => navigate(`user/${button.dataset.leaderUser}`)));
  document.querySelector('[data-friend-user]')?.addEventListener('click', sendFriendRequest);
  document.querySelector('[data-accept-friend]')?.addEventListener('click', acceptFriendRequestFromProfile);
  document.querySelector('[data-message-user]')?.addEventListener('click', event => navigate(`messages/${event.currentTarget.dataset.messageUser}`));
  document.querySelector('#loginForm')?.addEventListener('submit', loginUser);
  document.querySelector('#signupForm')?.addEventListener('submit', signupUser);
  document.querySelector('#resetRequestForm')?.addEventListener('submit', requestPasswordReset);
  document.querySelector('#resetConfirmForm')?.addEventListener('submit', confirmPasswordReset);
  document.querySelector('[data-logout]')?.addEventListener('click', logoutUser);
}

function openNotificationMute(scopeType, scopeId) {
  showActionDialog(actionDialogShell('NOTIFICATION CONTROLS', 'Mute or snooze', `<p>Hide matching notifications until you change this rule.</p><div class="dialog-actions"><button class="quiet-action" type="button" data-mute-duration="day">Snooze 24 hours</button><button class="primary-action" type="button" data-mute-duration="forever">Mute</button></div>`));
  document.querySelectorAll('[data-mute-duration]').forEach(button => button.addEventListener('click', async () => {
    const snoozedUntil = button.dataset.muteDuration === 'day' ? new Date(Date.now() + 86400000).toISOString() : null;
    try { await apiFetch('/api/notifications/mutes', { method: 'POST', body: JSON.stringify({ scopeType, scopeId, snoozedUntil }) }); closeActionDialog(); await hydrateAccountData(); renderRoute(); showToast(snoozedUntil ? 'Notifications snoozed for 24 hours.' : 'Notifications muted.'); }
    catch (error) { showToast(error.message); }
  }));
}

function postTextError(text) {
  if (text.includes('#')) return 'Hashtags are not allowed in post text.';
  if (/(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|gg|me|tv)(?:\/|\b))/i.test(text)) return 'Links are not allowed in post text. Use the GIF attachment field for GIF links.';
  return '';
}

async function createGuildFeedPost(event) {
  event.preventDefault();
  const content = sanitizeInput(event.currentTarget.elements.content.value);
  const error = postTextError(content); if (error) return showToast(error);
  try { await apiFetch(`/api/guilds/${state.activeGuild.id}/posts`, { method: 'POST', body: JSON.stringify({ content, category: event.currentTarget.elements.category.value, media: [] }) }); trackEvent('create_post', { audience: 'guild' }); await Promise.all([hydrateGuildDetail(), hydrateSession()]); renderRoute(); showToast('Posted to the guild.'); }
  catch (requestError) { showToast(requestError.message); }
}

async function sendGuildChatMessage(event) {
  event.preventDefault(); const text = sanitizeInput(event.currentTarget.elements.text.value); if (!text) return;
  try { await apiFetch(`/api/guilds/${state.activeGuild.id}/messages`, { method: 'POST', body: JSON.stringify({ text }) }); await hydrateGuildDetail(); renderRoute(); }
  catch (error) { showToast(error.message); }
}

async function imageFieldValue(file, existing = '') {
  if (!file) return existing;
  if (file.size > 2 * 1024 * 1024) throw new Error('Guild images must be 2 MB or smaller.');
  return fileToDataUrl(file);
}

async function saveGuildSettings(event) {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
  try {
    const [iconUrl, bannerUrl] = await Promise.all([imageFieldValue(form.elements.iconFile.files[0], data.get('iconUrl')), imageFieldValue(form.elements.bannerFile.files[0], data.get('bannerUrl'))]);
    const customEmojis = String(data.get('customEmojis') || '').split(/\r?\n/).map(line => line.split('|')).filter(parts => parts.length >= 2 && parts[0].trim() && parts[1].trim()).map(([name, imageUrl]) => ({ name: sanitizeInput(name.trim()).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24), imageUrl: imageUrl.trim() })).filter(item => item.name.length >= 2);
    const onboardingQuestions = String(data.get('onboardingQuestions') || '').split(/\r?\n/).map(line => line.split('|')).filter(parts => parts.length >= 2).map(([prompt, options, required]) => ({ prompt: sanitizeInput(prompt.trim()), options: options.split(',').map(option => sanitizeInput(option.trim())).filter(Boolean), required: String(required).trim().toLowerCase() === 'required' })).filter(item => item.prompt && item.options.length >= 2);
    const reactionSet = [...new Set(String(data.get('reactionSet') || '').trim().split(/\s+/).filter(Boolean))].slice(0, 8);
    const landingLayout = [...document.querySelectorAll('[data-guild-layout-item]')].map(item => item.dataset.guildLayoutItem);
    await apiFetch(`/api/guilds/${state.activeGuild.id}`, { method: 'PATCH', body: JSON.stringify({ name: sanitizeInput(data.get('name')), description: sanitizeInput(data.get('description')), tagline: sanitizeInput(data.get('tagline')), welcomeMessage: sanitizeInput(data.get('welcomeMessage')), pinnedAnnouncement: sanitizeInput(data.get('pinnedAnnouncement')), rules: sanitizeInput(data.get('rules')), iconUrl, bannerUrl, themeColor: data.get('themeColor'), accentColor: data.get('accentColor'), backgroundPattern: data.get('backgroundPattern'), cardStyle: data.get('cardStyle'), iconShape: data.get('iconShape'), seasonalEffect: data.get('seasonalEffect'), customEmojis, reactionSet: reactionSet.length >= 2 ? reactionSet : ['👍','🔥'], landingLayout, onboardingQuestions, privacy: data.get('privacy'), settings: { allowJoinRequests: data.has('allowJoinRequests'), showMemberList: data.has('showMemberList'), allowPerGuildProfiles: data.has('allowPerGuildProfiles'), showOnlineStatus: data.has('showOnlineStatus') }, contentPrivacy: 'members' }) });
    await Promise.all([hydrateGuilds(), hydrateGuildDetail()]); renderRoute(); showToast('Guild settings saved.');
  } catch (error) { showToast(error.message); }
}

function moveGuildLayoutSection(event) {
  const items = [...document.querySelectorAll('[data-guild-layout-item]')];
  const index = Number(event.currentTarget.dataset.guildLayoutMove); const next = index + Number(event.currentTarget.dataset.direction);
  if (next < 0 || next >= items.length) return;
  const parent = items[index].parentElement;
  if (next > index) parent.insertBefore(items[next], items[index]); else parent.insertBefore(items[index], items[next]);
  [...parent.children].forEach((item, position, list) => { item.querySelectorAll('button').forEach(button => { button.dataset.guildLayoutMove = position; button.disabled = (button.dataset.direction === '-1' && position === 0) || (button.dataset.direction === '1' && position === list.length - 1); }); });
}

function applyGuildTemplate(event) {
  const form = document.querySelector('#guildSettingsForm');
  const templates = { minimal: ['#111111','#ff4713','clean','outline'], cinema: ['#38185f','#f3bd25','stars','glass'], gaming: ['#5d2fe6','#2ee6a6','grid','solid'], debate: ['#ba2818','#ffda45','waves','soft'] };
  const [theme, accent, background, cards] = templates[event.currentTarget.dataset.guildTemplate];
  form.elements.themeColor.value = theme; form.elements.accentColor.value = accent; form.elements.backgroundPattern.value = background; form.elements.cardStyle.value = cards;
  showToast(`${event.currentTarget.dataset.guildTemplate} template applied. Save to publish it.`);
}

async function saveGuildIdentity(event) {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
  try {
    const [avatarUrl, bannerUrl] = await Promise.all([imageFieldValue(form.elements.avatarFile.files[0], data.get('avatarUrl')), imageFieldValue(form.elements.bannerFile.files[0], data.get('bannerUrl'))]);
    const onboardingAnswers = (state.activeGuild.onboardingQuestions || []).map((question, index) => ({ question: question.prompt, answer: sanitizeInput(data.get(`onboarding_${index}`) || '') })).filter(item => item.answer);
    await apiFetch(`/api/guilds/${state.activeGuild.id}/identity`, { method: 'PATCH', body: JSON.stringify({ nickname: sanitizeInput(data.get('nickname')), avatarUrl, bannerUrl, bio: sanitizeInput(data.get('bio')), themeColor: data.get('themeColor'), avatarFrame: data.get('avatarFrame'), onboardingAnswers }) });
    await hydrateGuildDetail(); renderRoute(); showToast('Guild identity saved.');
  } catch (error) { showToast(error.message); }
}

async function saveGuildRole(event) {
  event.preventDefault(); const form = event.currentTarget;
  const permissions = Object.fromEntries(['manageGuild','manageRoles','manageMembers','managePosts','createPosts','chat','viewAudit'].map(key => [key, form.elements[key].checked]));
  try { await apiFetch(`/api/guilds/${state.activeGuild.id}/roles/${form.dataset.roleForm}`, { method: 'PATCH', body: JSON.stringify({ name: sanitizeInput(form.elements.name.value), icon: sanitizeInput(form.elements.icon.value), color: form.elements.color.value, permissions }) }); await hydrateGuildDetail(); renderRoute(); showToast('Role design saved.'); }
  catch (error) { showToast(error.message); }
}

async function updateGuildMemberRole(event) {
  try { await apiFetch(`/api/guilds/${state.activeGuild.id}/members/${event.currentTarget.dataset.memberRole}`, { method: 'PATCH', body: JSON.stringify({ roleKey: event.currentTarget.value }) }); await hydrateGuildDetail(); renderRoute(); showToast('Member role updated.'); }
  catch (error) { showToast(error.message); }
}

async function approveGuildMember(event) {
  try { await apiFetch(`/api/guilds/${state.activeGuild.id}/members/${event.currentTarget.dataset.approveMember}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }); await hydrateGuildDetail(); renderRoute(); showToast('Join request approved.'); }
  catch (error) { showToast(error.message); }
}

async function sendDirectMessage(event) {
  event.preventDefault(); const form = event.currentTarget; const message = sanitizeInput(form.elements.message.value); if (!message) return;
  try { await apiFetch('/api/messages', { method: 'POST', body: JSON.stringify({ recipient: form.elements.recipient.value, message }) }); await hydrateAccountData(); renderRoute(); }
  catch (error) { showToast(error.message); }
}

async function sendFriendRequest(event) {
  const userId = event.currentTarget.dataset.friendUser;
  if (!sessionUser) { navigate('auth'); return; }
  try { await apiFetch('/api/friends', { method: 'POST', body: JSON.stringify({ userId }) }); await Promise.all([hydrateAccountData(), hydratePublicProfile()]); renderRoute(); showToast('Friend request sent.'); }
  catch (error) { showToast(error.message); }
}

async function acceptFriendRequestFromProfile(event) {
  try { await apiFetch(`/api/friends/${event.currentTarget.dataset.acceptFriend}/accept`, { method: 'POST' }); await Promise.all([hydrateAccountData(), hydratePublicProfile()]); renderRoute(); showToast('Friend added.'); }
  catch (error) { showToast(error.message); }
}

function renderMessageComposer() {
  const stage = document.querySelector('#conversationStage');
  stage.innerHTML = `<form class="message-compose" id="messageForm"><div><span class="section-kicker">NEW MESSAGE</span><h2>Start a conversation</h2></div><label>To<input name="recipient" required placeholder="@username" /></label><label>Message<textarea name="message" required placeholder="Write a message..."></textarea></label><button class="primary-action" type="submit">Send message</button></form>`;
  document.querySelector('#messageForm').addEventListener('submit', async event => {
    event.preventDefault();
    const recipient = sanitizeInput(event.currentTarget.elements.recipient.value);
    const message = sanitizeInput(event.currentTarget.elements.message.value);
    if (!recipient || !message) return;
    if (!sessionUser) { navigate('auth'); return; }
    try { const payload = await apiFetch('/api/messages', { method: 'POST', body: JSON.stringify({ recipient, message }) }); await hydrateAccountData(); const other = String(payload.message.sender?.id) === String(sessionUser.id) ? payload.message.recipient : payload.message.sender; navigate(`messages/${other.id}`); showToast('Message sent.'); }
    catch (error) { showToast(error.message); }
  });
}

function closeActionDialog() {
  if (actionDialog.open) actionDialog.close();
  document.querySelector('#actionDialogContent').innerHTML = '';
}

function actionDialogShell(kicker, title, body) {
  return `<div class="dialog-title"><div><span class="section-kicker">${kicker}</span><h2>${title}</h2></div><button type="button" data-close-action aria-label="Close">×</button></div>${body}`;
}

function showActionDialog(content) {
  document.querySelector('#actionDialogContent').innerHTML = content;
  actionDialog.showModal();
  document.querySelector('[data-close-action]')?.addEventListener('click', closeActionDialog);
}

function openPostMenu(id) {
  const post = findPostById(id);
  if (!post) return;
  const isAuthor = post.authorId === currentUserId();
  showActionDialog(actionDialogShell('POST OPTIONS', 'What would you like to do?', `<div class="post-menu-list">${isAuthor ? '<button type="button" data-edit-post>✎ <span><strong>Edit Post</strong><small>Update the wording or category</small></span></button><button class="danger" type="button" data-delete-post>⌫ <span><strong>Delete Post</strong><small>Remove this take permanently</small></span></button>' : ''}<button type="button" data-share-post>↗ <span><strong>Share</strong><small>Copy a direct link to this take</small></span></button>${isAuthor ? '' : '<button type="button" data-report-post>⚑ <span><strong>Report</strong><small>Send this take for review</small></span></button>'}</div>`));
  document.querySelector('[data-edit-post]')?.addEventListener('click', () => openEditPost(post));
  document.querySelector('[data-delete-post]')?.addEventListener('click', () => openDeletePost(post));
  document.querySelector('[data-share-post]')?.addEventListener('click', () => sharePost(post));
  document.querySelector('[data-report-post]')?.addEventListener('click', () => openReportPost(post));
}

function openEditPost(post) {
  showActionDialog(actionDialogShell('EDIT TAKE', 'Refine your take', `<form id="editPostForm"><label>Post content<textarea name="content" maxlength="180" required>${escapeHtml(post.text)}</textarea></label><label>Category<select name="category">${['Movies','Music','Entertainment','Games','Life'].map(category => `<option ${post.category === category ? 'selected' : ''}>${category}</option>`).join('')}</select></label><button class="primary-action" type="submit">Save changes</button></form>`));
  document.querySelector('#editPostForm').addEventListener('submit', async event => {
    event.preventDefault();
    const content = sanitizeInput(event.currentTarget.elements.content.value);
    const category = event.currentTarget.elements.category.value;
    if (!content) return;
    const validationError = postTextError(content); if (validationError) return showToast(validationError);
    try { if (post.databaseId && sessionUser) await apiFetch(`/api/posts/${post.databaseId}`, { method: 'PATCH', body: JSON.stringify({ content, category }) }); post.text = content.toUpperCase(); post.category = category; persist(); closeActionDialog(); renderRoute(); showToast('Post updated.'); }
    catch (error) { showToast(error.message); }
  });
}

function openDeletePost(post) {
  showActionDialog(actionDialogShell('DELETE TAKE', 'Are you sure?', `<p class="dialog-copy">This permanently removes the post and its local discussion thread.</p><div class="confirm-actions"><button class="quiet-action" type="button" data-close-action-secondary>Cancel</button><button class="danger-action" type="button" data-confirm-delete>Delete post</button></div>`));
  document.querySelector('[data-close-action-secondary]').addEventListener('click', closeActionDialog);
  document.querySelector('[data-confirm-delete]').addEventListener('click', async () => {
    try {
      if (post.databaseId && sessionUser) await apiFetch(`/api/posts/${post.databaseId}`, { method: 'DELETE' });
      state.posts = state.posts.filter(item => item.id !== post.id);
      state.guildPosts = state.guildPosts.filter(item => item.id !== post.id);
      state.savedPostIds = state.savedPostIds.filter(id => id !== post.id);
      persist(); closeActionDialog(); navigate('home'); renderRoute(); showToast('Post deleted.');
    } catch (error) { showToast(error.message); }
  });
}

async function sharePost(post) {
  const url = `${location.origin}${location.pathname}#take/${post.id}`;
  try { await navigator.clipboard.writeText(url); }
  catch { const input = document.createElement('textarea'); input.value = url; document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove(); }
  closeActionDialog(); showToast('Link copied!');
}

function openReportPost(post) {
  showActionDialog(actionDialogShell('REPORT TAKE', 'Tell us what is wrong', `<form id="reportPostForm"><label>Reason<select name="reason"><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="offensive">Offensive</option><option value="other">Other</option></select></label><label>Details<textarea name="details" maxlength="500" placeholder="Optional context"></textarea></label><button class="primary-action" type="submit">Submit report</button></form>`));
  document.querySelector('#reportPostForm').addEventListener('submit', async event => {
    event.preventDefault();
    const reason = event.currentTarget.elements.reason.value;
    const details = sanitizeInput(event.currentTarget.elements.details.value);
    try {
      if (post.databaseId && sessionUser) await apiFetch(`/api/posts/${post.databaseId}/reports`, { method: 'POST', body: JSON.stringify({ reason, details }) });
      else console.info('Development report:', { postId: post.id, reason, details });
      closeActionDialog(); showToast('Report submitted.');
    } catch (error) { showToast(error.message); }
  });
}

function updateProfilePreview(event) {
  const form = event.currentTarget;
  if (event.target.name === 'displayName') document.querySelector('#previewName').textContent = sanitizeInput(event.target.value) || 'Display name';
  if (event.target.name === 'status') document.querySelector('#previewStatus').textContent = event.target.value;
  if (event.target.name === 'themeColor') { document.querySelector('#profilePreview').style.setProperty('--profile-accent', event.target.value); document.querySelector('#colorHex').textContent = event.target.value; }
  if (event.target.name === 'bio') document.querySelector('#bioCounter').textContent = `${event.target.value.length} / 1000`;
  if (form.elements.bannerUrl?.value) document.querySelector('#bannerPreview').dataset.hasImage = 'true';
}

function handleBannerUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) { event.target.value = ''; return showToast('Choose an image smaller than 2 MB.'); }
  const reader = new FileReader();
  reader.onload = () => {
    const form = document.querySelector('#settingsForm');
    form.elements.bannerUrl.value = reader.result;
    document.querySelector('#bannerPreview').innerHTML = `<img src="${reader.result}" alt="Banner preview" />`;
    showToast('Banner ready to save.');
  };
  reader.readAsDataURL(file);
}

function handleAvatarUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) { event.target.value = ''; return showToast('Choose an avatar smaller than 2 MB.'); }
  const reader = new FileReader();
  reader.onload = () => { document.querySelector('#settingsForm').elements.avatarUrl.value = reader.result; state.profile.avatarUrl = reader.result; document.querySelector('.preview-avatar').innerHTML = `<img src="${reader.result}" alt="Avatar preview" />`; showToast('Avatar ready to save.'); };
  reader.readAsDataURL(file);
}

async function loginUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const payload = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: sanitizeInput(form.elements.email.value), password: form.elements.password.value }) }, false);
    applySessionUser(payload.user); trackEvent('login', { method: 'email' }); await Promise.all([hydratePosts(), hydrateAccountData(), hydrateGuilds(), hydrateLeaderboard()]); navigate('home'); showToast('Signed in securely.');
  } catch (error) { showToast(error.message); }
}

async function signupUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const payload = await apiFetch('/api/auth/signup', { method: 'POST', body: JSON.stringify({ displayName: sanitizeInput(form.elements.displayName.value), email: sanitizeInput(form.elements.email.value), password: form.elements.password.value, ageConfirmed: form.elements.ageConfirmed.checked }) }, false);
    applySessionUser(payload.user); trackEvent('sign_up', { method: 'email' }); await Promise.all([hydrateAccountData(), hydrateLeaderboard()]); navigate('settings'); showToast('Account created. Customize your profile.');
  } catch (error) { showToast(error.message); }
}

async function requestPasswordReset(event) {
  event.preventDefault();
  const email = sanitizeInput(event.currentTarget.elements.email.value);
  try {
    const payload = await apiFetch('/api/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) }, false);
    const confirmForm = document.querySelector('#resetConfirmForm');
    confirmForm.hidden = false;
    confirmForm.elements.email.value = email;
    if (payload.developmentResetToken) confirmForm.elements.token.value = payload.developmentResetToken;
    showToast('Reset request accepted.');
  } catch (error) { showToast(error.message); }
}

async function confirmPasswordReset(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try { await apiFetch('/api/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ email: sanitizeInput(form.elements.email.value), token: sanitizeInput(form.elements.token.value), password: form.elements.password.value }) }, false); showToast('Password updated. You can sign in.'); }
  catch (error) { showToast(error.message); }
}

async function logoutUser() {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }, false); } catch { /* clear local session regardless */ }
  sessionUser = null;
  messageStream?.close(); messageStream = null;
  state.profile = { ...defaultState.profile, socialLinks: { ...defaultState.profile.socialLinks } };
  state.savedPostIds = []; state.notifications = []; state.messages = []; state.friendships = [];
  state.userStanding = null; state.activeGuild = null; state.guildPosts = []; state.guildMessages = []; state.publicProfile = null; state.ownProfileData = null;
  updateHeaderProfile(); await Promise.all([hydratePosts(), hydrateGuilds(), hydrateLeaderboard()]); renderRoute(); showToast('Signed out.');
}

function activeTake() {
  const id = decodeURIComponent(location.hash.split('/')[1] || '');
  return findPostById(id);
}

async function hydrateTake(post) {
  if (!post?.databaseId || post.publishing) return;
  try {
    await apiFetch(`/api/posts/${post.databaseId}/view`, { method: 'POST' }, false);
    const payload = await apiFetch(`/api/posts/${post.databaseId}/comments`, {}, false);
    post.comments = payload.comments || [];
    post.commentCount = countComments(post.comments);
  } catch (error) { console.error('Unable to load take:', error); }
}

function findComment(comments, id) {
  for (const comment of comments) {
    if (String(comment.id) === String(id)) return comment;
    const nested = findComment(comment.replies || [], id);
    if (nested) return nested;
  }
  return null;
}

async function addComment(event) {
  event.preventDefault();
  const post = activeTake();
  const input = event.currentTarget.elements.comment;
  const text = sanitizeInput(input.value);
  if (!post || !text) return;
  if (!sessionUser) { navigate('auth'); return showToast('Sign in to comment.'); }
  const gifFile = event.currentTarget.elements.gifFile?.files?.[0];
  if (gifFile?.size > 2 * 1024 * 1024) return showToast('Comment GIFs must be 2 MB or smaller.');
  const gifUrl = gifFile ? await fileToDataUrl(gifFile) : String(event.currentTarget.elements.gifUrl?.value || '').trim();
  try { await apiFetch('/api/comments', { method: 'POST', body: JSON.stringify({ postId: post.databaseId, text, parent: null, gifUrl }) }); trackEvent('add_take'); await hydrateTake(post); await Promise.all([hydrateTrending(), hydrateSession(), hydrateLeaderboard()]); renderRoute(); showToast('Take added.'); }
  catch (error) { showToast(error.message); }
}

function openReplyComposer(id) {
  const slot = document.querySelector(`#reply-${id}`);
  if (!slot) return;
  slot.hidden = !slot.hidden;
  if (slot.hidden) return;
  slot.innerHTML = `<form class="reply-composer" data-reply-form="${id}"><textarea name="reply" required maxlength="500" placeholder="Write a reply..."></textarea><div><button type="button" data-cancel-reply>Cancel</button><button type="submit">Reply</button></div></form>`;
  slot.querySelector('[data-cancel-reply]').addEventListener('click', () => { slot.hidden = true; slot.innerHTML = ''; });
  slot.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const post = activeTake();
    const parent = post && findComment(post.comments, id);
    const text = sanitizeInput(event.currentTarget.elements.reply.value);
    if (!parent || !text) return;
    if (!sessionUser) { navigate('auth'); return; }
    try { await apiFetch('/api/comments', { method: 'POST', body: JSON.stringify({ postId: post.databaseId, text, parent: String(parent.id) }) }); trackEvent('add_take', { reply: true }); await hydrateTake(post); await Promise.all([hydrateSession(), hydrateLeaderboard()]); renderRoute(); showToast('Reply added.'); }
    catch (error) { showToast(error.message); }
  });
}

async function toggleCommentVote(id) {
  const post = activeTake();
  const comment = post && findComment(post.comments, id);
  if (!comment) return;
  if (!sessionUser) { navigate('auth'); return showToast('Sign in to vote on comments.'); }
  try { await apiFetch(`/api/comments/${id}/vote`, { method: 'POST' }); await hydrateTake(post); await Promise.all([hydrateSession(), hydrateLeaderboard()]); renderRoute(); } catch (error) { showToast(error.message); }
}

function applyDisplaySettings() {
  const prefersDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.resolvedTheme = state.settings.theme === 'system' ? (prefersDark ? 'dark' : 'light') : state.settings.theme;
  document.documentElement.dataset.textSize = state.settings.textSize;
  document.documentElement.dataset.palette = state.settings.palette || 'callout';
  document.documentElement.dataset.feedDensity = state.settings.feedDensity || 'comfortable';
  document.documentElement.dataset.reducedMotion = state.settings.reducedMotion ? 'true' : 'false';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', document.documentElement.dataset.resolvedTheme === 'dark' ? '#151513' : '#ff4713');
}

function previewDisplaySettings() {
  const form = document.querySelector('#settingsForm');
  if (!form) return;
  const prefersDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
  document.documentElement.dataset.theme = form.elements.theme.value;
  document.documentElement.dataset.resolvedTheme = form.elements.theme.value === 'system' ? (prefersDark ? 'dark' : 'light') : form.elements.theme.value;
  document.documentElement.dataset.textSize = form.elements.textSize.value;
  document.documentElement.dataset.palette = form.elements.palette?.value || state.settings.palette;
  document.documentElement.dataset.feedDensity = form.elements.feedDensity?.value || state.settings.feedDensity;
  document.documentElement.dataset.reducedMotion = form.elements.reducedMotion?.checked ? 'true' : 'false';
}

async function saveSettings(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  state.settings.theme = formData.get('theme');
  state.settings.textSize = formData.get('textSize');
  state.settings.palette = formData.get('palette');
  state.settings.feedDensity = formData.get('feedDensity');
  state.settings.voteEffect = formData.get('voteEffect');
  state.settings.notificationSound = formData.get('notificationSound');
  state.settings.reducedMotion = formData.has('reducedMotion');
  state.settings.hiddenTopics = sanitizeInput(formData.get('hiddenTopics')).split(',').map(value => value.trim()).filter(Boolean).slice(0, 30);
  state.settings.directMessages = formData.get('directMessages');
  state.settings.notifications = { likes: formData.has('notifyLikes'), comments: formData.has('notifyComments'), guildInvites: formData.has('notifyGuildInvites') };
  state.settings.notificationDelivery = { inApp: formData.has('deliveryInApp'), push: formData.has('deliveryPush'), email: formData.has('deliveryEmail') };
  state.profile = {
    ...state.profile,
    displayName: sanitizeInput(formData.get('displayName')),
    handle: sanitizeInput(formData.get('handle')).toLowerCase().replace(/\s+/g, '_'),
    bio: sanitizeInput(formData.get('bio')),
    avatarUrl: formData.get('avatarUrl') || state.profile.avatarUrl,
    bannerUrl: formData.get('bannerUrl') || '',
    themeColor: formData.get('themeColor'),
    avatarFrame: formData.get('avatarFrame'),
    profileEffect: formData.get('profileEffect'),
    vibeAura: formData.get('vibeAura'),
    profileBackground: formData.get('profileBackground'),
    profileLayout: [...document.querySelectorAll('[data-layout-item]')].map(item => item.dataset.layoutItem),
    showcaseMode: formData.get('showcaseMode'),
    featuredBadges: formData.getAll('featuredBadge').slice(0, 3),
    pronouns: sanitizeInput(formData.get('pronouns')),
    status: formData.get('status'),
    socialLinks: {
      twitter: sanitizeInput(formData.get('twitter')), instagram: sanitizeInput(formData.get('instagram')), discord: sanitizeInput(formData.get('discord')),
      youtube: sanitizeInput(formData.get('youtube')), twitch: sanitizeInput(formData.get('twitch')), custom: sanitizeInput(formData.get('custom'))
    }
  };
  if (!state.profile.handle.startsWith('@')) state.profile.handle = `@${state.profile.handle}`;
  state.profile.handle = `@${state.profile.handle.slice(1).replace(/[^a-z0-9_]/g, '').slice(0, 29)}`;
  try {
    if (sessionUser) {
      const payload = await apiFetch('/api/profile', { method: 'PATCH', body: JSON.stringify({ displayName: state.profile.displayName, handle: state.profile.handle, avatarUrl: state.profile.avatarUrl, bio: state.profile.bio, bannerUrl: state.profile.bannerUrl, themeColor: state.profile.themeColor, avatarFrame: state.profile.avatarFrame, profileEffect: state.profile.profileEffect, vibeAura: state.profile.vibeAura, profileBackground: state.profile.profileBackground, profileLayout: state.profile.profileLayout, showcaseMode: state.profile.showcaseMode, featuredBadges: state.profile.featuredBadges || [], featuredPosts: state.profile.featuredPosts || [], pinnedGuilds: state.profile.pinnedGuilds || [], socialLinks: state.profile.socialLinks, pronouns: state.profile.pronouns, status: state.profile.status, preferences: { theme: state.settings.theme, palette: state.settings.palette, reducedMotion: state.settings.reducedMotion, feedDensity: state.settings.feedDensity, voteEffect: state.settings.voteEffect, notificationSound: state.settings.notificationSound, widgetOrder: state.settings.widgetOrder, hiddenTopics: state.settings.hiddenTopics, notifications: state.settings.notifications, notificationDelivery: state.settings.notificationDelivery, directMessages: state.settings.directMessages, textSize: state.settings.textSize } }) });
      applySessionUser(payload.user); await hydrateOwnProfile();
    }
    persist(); applyDisplaySettings(); document.querySelector('#headerName').textContent = state.profile.displayName; renderRoute(); showToast('Settings saved.');
  } catch (error) { showToast(error.message); }
}

function unblockUser(user) {
  state.settings.blockedUsers = state.settings.blockedUsers.filter(item => item !== user);
  persist(); renderRoute(); showToast(`${user} unblocked.`);
}

document.querySelectorAll('[data-route]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  navigate(link.dataset.route);
}));
document.querySelectorAll('[data-route-button]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.routeButton)));
document.querySelectorAll('[data-leader-period]').forEach(button => button.addEventListener('click', async () => {
  state.settings.leaderboardPeriod = button.dataset.leaderPeriod;
  document.querySelectorAll('[data-leader-period]').forEach(item => item.classList.toggle('active', item === button));
  persist();
  await hydrateLeaderboard();
  if (currentRoute() === 'leaderboards') renderRoute();
}));
document.querySelector('#profileButton').addEventListener('click', () => navigate('profile'));
document.querySelector('#mobileMenu').addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'));
function openComposerForUser() {
  if (!sessionUser) { navigate('auth'); return showToast('Create an account or sign in to post a take.'); }
  if (!composerRequestId) composerRequestId = crypto.randomUUID();
  updateComposerPreview();
  composer.showModal();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
}

function loadImage(file) {
  return new Promise((resolve, reject) => { const image = new Image(); const url = URL.createObjectURL(file); image.onload = () => { URL.revokeObjectURL(url); resolve(image); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image could not be read.')); }; image.src = url; });
}

async function prepareImage(file) {
  if (file.type === 'image/gif') {
    if (file.size > 2 * 1024 * 1024) throw new Error('GIF files must be 2 MB or smaller.');
    return { type: 'gif', url: await fileToDataUrl(file), alt: file.name, duration: 0, aspectRatio: 1 };
  }
  const image = await loadImage(file);
  const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return { type: 'image', url: canvas.toDataURL('image/webp', .78), alt: file.name, duration: 0, aspectRatio: canvas.width / canvas.height };
}

function videoMetadata(file) {
  return new Promise((resolve, reject) => { const video = document.createElement('video'); const url = URL.createObjectURL(file); video.preload = 'metadata'; video.onloadedmetadata = () => { const meta = { duration: video.duration, aspectRatio: video.videoWidth / video.videoHeight }; URL.revokeObjectURL(url); resolve(meta); }; video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This video could not be read.')); }; video.src = url; });
}

async function prepareVideo(file) {
  if (file.size > 8 * 1024 * 1024) throw new Error('Short videos must be 8 MB or smaller.');
  const meta = await videoMetadata(file);
  if (!Number.isFinite(meta.duration) || meta.duration > 25) throw new Error('Videos must be 25 seconds or shorter.');
  if (meta.aspectRatio < .95 || meta.aspectRatio > 1.05) throw new Error('Videos must use a square 1:1 aspect ratio.');
  return { type: 'video', url: await fileToDataUrl(file), alt: file.name, duration: Math.round(meta.duration * 10) / 10, aspectRatio: meta.aspectRatio };
}

function renderMediaPreview() {
  const preview = document.querySelector('#mediaPreview');
  preview.hidden = pendingMedia.length === 0;
  preview.innerHTML = pendingMedia.map((item, index) => `<figure>${item.type === 'video' ? `<video src="${escapeHtml(item.url)}" muted></video>` : `<img src="${escapeHtml(item.url)}" alt="" />`}<button type="button" data-remove-media="${index}" aria-label="Remove attachment">×</button>${item.type === 'image' ? `<button class="edit-media" type="button" data-edit-media="${index}">Crop</button>` : ''}<figcaption>${escapeHtml(item.type.toUpperCase())}</figcaption></figure>`).join('');
  preview.querySelectorAll('[data-remove-media]').forEach(button => button.addEventListener('click', () => { pendingMedia.splice(Number(button.dataset.removeMedia), 1); renderMediaPreview(); updateComposerPreview(); }));
  preview.querySelectorAll('[data-edit-media]').forEach(button => button.addEventListener('click', () => openImageEditor(Number(button.dataset.editMedia))));
}

let editingMediaIndex = -1;
let editorImage = null;
let editorOffset = { x: 0, y: 0 };
let editorDrag = null;

function drawImageEditor() {
  if (!editorImage) return;
  const canvas = document.querySelector('#imageEditorCanvas'); const context = canvas.getContext('2d'); const zoom = Number(document.querySelector('#imageZoom').value);
  const base = Math.max(canvas.width / editorImage.naturalWidth, canvas.height / editorImage.naturalHeight); const scale = base * zoom;
  const width = editorImage.naturalWidth * scale; const height = editorImage.naturalHeight * scale;
  const maxX = Math.max(0, (width - canvas.width) / 2); const maxY = Math.max(0, (height - canvas.height) / 2);
  editorOffset.x = Math.max(-maxX, Math.min(maxX, editorOffset.x)); editorOffset.y = Math.max(-maxY, Math.min(maxY, editorOffset.y));
  context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(editorImage, (canvas.width - width) / 2 + editorOffset.x, (canvas.height - height) / 2 + editorOffset.y, width, height);
}

function openImageEditor(index) {
  editingMediaIndex = index; editorOffset = { x: 0, y: 0 }; document.querySelector('#imageZoom').value = '1';
  editorImage = new Image(); editorImage.onload = () => { drawImageEditor(); document.querySelector('#imageEditorDialog').showModal(); }; editorImage.src = pendingMedia[index].url;
}

async function addTakeMedia(files) {
  if (!files.length) return;
  if (pendingMedia.length + files.length > 5) return showToast('A take can contain up to 5 media items.');
  try {
    const prepared = await Promise.all(files.map(file => file.type.startsWith('video/') ? prepareVideo(file) : prepareImage(file)));
    pendingMedia.push(...prepared);
    renderMediaPreview(); updateComposerPreview();
  } catch (error) { renderMediaPreview(); showToast(error.message); }
}

async function handleTakeMedia(event) {
  const files = [...event.target.files]; event.target.value = '';
  await addTakeMedia(files);
}

function updateComposerPreview() {
  const text = document.querySelector('#takeText')?.value.trim() || '';
  const category = document.querySelector('#takeCategory')?.value || 'Movies';
  const audience = document.querySelector('#takeAudience')?.selectedOptions?.[0]?.textContent || 'Public';
  const profile = sessionUser ? state.profile : defaultState.profile;
  document.querySelector('#previewName').textContent = profile.displayName || 'Callout member';
  document.querySelector('#previewCategory').textContent = `${category} · now`;
  document.querySelector('#previewAudience').textContent = audience;
  document.querySelector('#previewContent').textContent = text || 'Your take will appear here as you type.';
  const avatar = document.querySelector('#previewAvatar');
  avatar.innerHTML = profile.avatarUrl ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="" />` : escapeHtml((profile.displayName || 'C').charAt(0).toUpperCase());
  const media = document.querySelector('#previewMedia');
  media.hidden = pendingMedia.length === 0;
  media.className = `preview-media preview-media-${Math.min(4, pendingMedia.length)}`;
  media.innerHTML = pendingMedia.slice(0, 4).map(item => item.type === 'video' ? `<video src="${escapeHtml(item.url)}" muted></video>` : `<img src="${escapeHtml(item.url)}" alt="" />`).join('');
}

function setComposerBusy(busy, draft = false) {
  composerSubmissionInFlight = busy;
  const publish = document.querySelector('.publish-button');
  const draftButton = document.querySelector('#saveDraft');
  const closeButton = document.querySelector('[data-close-composer]');
  publish.disabled = busy; draftButton.disabled = busy; closeButton.disabled = busy;
  publish.textContent = busy && !draft ? 'Posting...' : 'Post Take';
  draftButton.textContent = busy && draft ? 'Saving...' : 'Save draft';
}

function beginPublishing(draft = false) {
  const overlay = document.querySelector('#publishingOverlay');
  const progress = document.querySelector('#publishingProgress');
  const status = document.querySelector('#publishingStatus');
  document.querySelector('#publishingTitle').textContent = draft ? 'Saving your draft' : 'Publishing your take';
  document.querySelector('#publishingEstimate').textContent = draft ? 'This normally takes only a few seconds.' : 'Usually ready in 2-8 seconds. Please keep this tab open.';
  overlay.hidden = false; progress.style.width = '12%'; status.textContent = draft ? 'Preparing your draft...' : 'Securing your post...';
  let value = 12; let tick = 0;
  clearInterval(publishingTimer);
  publishingTimer = setInterval(() => {
    value = Math.min(90, value + Math.max(2, Math.round((92 - value) * .13)));
    progress.style.width = `${value}%`; tick += 1;
    status.textContent = tick > 5 ? 'Almost there...' : tick > 2 ? 'Updating the Callout feed...' : 'Uploading your content...';
  }, 650);
}

async function finishPublishing(success, message = 'Your take is live.') {
  clearInterval(publishingTimer); publishingTimer = null;
  const overlay = document.querySelector('#publishingOverlay');
  if (!success) { overlay.hidden = true; return; }
  document.querySelector('#publishingProgress').style.width = '100%';
  document.querySelector('#publishingStatus').textContent = message;
  await new Promise(resolve => setTimeout(resolve, 180));
  overlay.hidden = true;
}

document.querySelector('#openComposer').addEventListener('click', openComposerForUser);
document.querySelector('[data-close-composer]').addEventListener('click', () => composer.close());
document.querySelector('#takeMedia').addEventListener('change', handleTakeMedia);
const composerDropZone = document.querySelector('#composerDropZone');
['dragenter', 'dragover'].forEach(type => composerDropZone.addEventListener(type, event => { event.preventDefault(); if (!composerSubmissionInFlight) composerDropZone.classList.add('is-dragging'); }));
['dragleave', 'drop'].forEach(type => composerDropZone.addEventListener(type, event => { event.preventDefault(); composerDropZone.classList.remove('is-dragging'); }));
composerDropZone.addEventListener('drop', event => { if (!composerSubmissionInFlight) addTakeMedia([...event.dataTransfer.files].filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'))); });
composerDropZone.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target === composerDropZone) { event.preventDefault(); document.querySelector('#takeMedia').click(); } });
document.querySelector('[data-close-image-editor]').addEventListener('click', () => document.querySelector('#imageEditorDialog').close());
document.querySelector('#imageZoom').addEventListener('input', drawImageEditor);
document.querySelector('#imageEditorCanvas').addEventListener('pointerdown', event => { editorDrag = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); });
document.querySelector('#imageEditorCanvas').addEventListener('pointermove', event => { if (!editorDrag) return; editorOffset.x += event.clientX - editorDrag.x; editorOffset.y += event.clientY - editorDrag.y; editorDrag = { x: event.clientX, y: event.clientY }; drawImageEditor(); });
document.querySelector('#imageEditorCanvas').addEventListener('pointerup', () => { editorDrag = null; });
document.querySelector('#imageEditorForm').addEventListener('submit', event => { event.preventDefault(); if (editingMediaIndex < 0) return; const source = document.querySelector('#imageEditorCanvas'); const output = document.createElement('canvas'); output.width = 1200; output.height = 1200; output.getContext('2d').drawImage(source, 0, 0, output.width, output.height); pendingMedia[editingMediaIndex] = { ...pendingMedia[editingMediaIndex], url: output.toDataURL('image/webp', .82), aspectRatio: 1 }; document.querySelector('#imageEditorDialog').close(); renderMediaPreview(); updateComposerPreview(); showToast('Crop applied.'); });
document.querySelector('#addGifUrl').addEventListener('click', () => { const input = document.querySelector('#gifUrlInput'); input.hidden = !input.hidden; if (!input.hidden) input.focus(); });
document.querySelectorAll('#postEmojiTray button').forEach(button => button.addEventListener('click', () => { const input = document.querySelector('#takeText'); input.value += button.textContent; input.dispatchEvent(new Event('input')); input.focus(); }));
document.querySelector('[data-close-guild]').addEventListener('click', () => guildComposer.close());
document.querySelector('#takeText').addEventListener('input', event => { document.querySelector('#charCount').textContent = `${event.target.value.length} / 2000`; updateComposerPreview(); });
document.querySelector('#takeCategory').addEventListener('change', updateComposerPreview);
document.querySelector('#takeAudience').addEventListener('change', updateComposerPreview);
document.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => {
  const input = document.querySelector('#takeText');
  const wrappers = { bold: ['**', '**'], italic: ['*', '*'], spoiler: ['||', '||'] };
  const [before, after] = wrappers[button.dataset.format]; const start = input.selectionStart; const end = input.selectionEnd;
  input.setRangeText(`${before}${input.value.slice(start, end) || 'text'}${after}`, start, end, 'end'); input.dispatchEvent(new Event('input')); input.focus();
}));
document.querySelector('#togglePoll').addEventListener('click', () => { const builder = document.querySelector('#pollBuilder'); builder.hidden = !builder.hidden; });
document.querySelector('#addPollOption').addEventListener('click', () => { const options = document.querySelector('#pollOptions'); if (options.children.length >= 6) return showToast('Polls support up to 6 choices.'); const input = document.createElement('input'); input.maxLength = 100; input.placeholder = `Option ${options.children.length + 1}`; options.appendChild(input); });

async function submitComposer(draft = false) {
  if (composerSubmissionInFlight) return;
  if (!sessionUser) { composer.close(); navigate('auth'); return showToast('Sign in to publish a take.'); }
  const input = document.querySelector('#takeText');
  const text = sanitizeInput(input.value);
  const pollBuilder = document.querySelector('#pollBuilder');
  const pollOptions = [...document.querySelectorAll('#pollOptions input')].map(option => sanitizeInput(option.value)).filter(Boolean);
  const poll = pollBuilder.hidden ? null : { question: sanitizeInput(document.querySelector('#pollQuestion').value), options: pollOptions.map(option => ({ text: option })), closesAt: null };
  if (!draft && !text && !pendingMedia.length && !poll) return showToast('Add text, media, or a poll first.');
  if (poll && (!poll.question || pollOptions.length < 2)) return showToast('A poll needs a question and at least 2 options.');
  const validationError = text ? postTextError(text) : ''; if (validationError) return showToast(validationError);
  const category = document.querySelector('#takeCategory').value;
  const gifUrl = document.querySelector('#gifUrlInput').value.trim();
  const media = gifUrl ? [...pendingMedia, { type: 'gif', url: gifUrl, alt: 'GIF attachment', duration: 0, aspectRatio: 1 }] : [...pendingMedia];
  if (media.length > 5) return showToast('A take can contain up to 5 media items.');
  const scheduledValue = document.querySelector('#takeSchedule').value;
  const payload = {
    clientRequestId: composerRequestId || (composerRequestId = crypto.randomUUID()), content: text, category, media, draft, poll, contentType: poll ? 'poll' : media[0]?.type || 'text',
    visibility: document.querySelector('#takeAudience').value,
    topics: document.querySelector('#takeTopics').value.split(',').map(value => sanitizeInput(value)).filter(Boolean).slice(0, 5),
    contentWarning: sanitizeInput(document.querySelector('#takeWarning').value), reactionSet: document.querySelector('#takeReactionSet').value,
    embedUrl: document.querySelector('#takeEmbed').value.trim(), scheduledPublishedAt: scheduledValue ? new Date(scheduledValue).toISOString() : null
  };
  const instantPublish = !draft && !scheduledValue;
  const temporaryId = instantPublish ? `pending-${composerRequestId}` : '';
  if (instantPublish) {
    const pendingPost = mapPost({
      ...payload, id: temporaryId, publishing: true, createdAt: new Date().toISOString(), commentCount: 0,
      author: { id: currentUserId(), displayName: state.profile.displayName, handle: state.profile.handle, avatarUrl: state.profile.avatarUrl }
    });
    state.posts = [pendingPost, ...state.posts.filter(post => post.id !== temporaryId)];
    setComposerBusy(true, false); composer.close(); navigate(`take/${temporaryId}`);
    showToast('Publishing in the background...');
  } else {
    setComposerBusy(true, draft); beginPublishing(draft);
  }
  let createdPost = null;
  try {
    const result = await apiFetch('/api/posts', { method: 'POST', body: JSON.stringify(payload) });
    createdPost = result?.post || null;
    if (!draft) trackEvent('create_post', { content_type: payload.contentType, audience: payload.visibility, scheduled: Boolean(payload.scheduledPublishedAt) });
  } catch (error) {
    if (instantPublish) {
      state.posts = state.posts.filter(post => post.id !== temporaryId); persist(); navigate('home'); setComposerBusy(false); composer.showModal(); updateComposerPreview();
    } else await finishPublishing(false);
    setComposerBusy(false); return showToast(`Publishing failed: ${error.message}`);
  }
  const createdId = String(createdPost?.id || createdPost?._id || '');
  if (!draft && createdId) {
    const optimisticPost = mapPost({
      ...createdPost,
      author: { id: currentUserId(), displayName: state.profile.displayName, handle: state.profile.handle, avatarUrl: state.profile.avatarUrl },
      commentCount: 0
    });
    state.posts = [optimisticPost, ...state.posts.filter(post => post.id !== optimisticPost.id && post.id !== temporaryId)];
  }
  if (!instantPublish) await finishPublishing(true, draft ? 'Draft saved.' : scheduledValue ? 'Take scheduled.' : 'Your take is live.');
  persist();
  input.value = '';
  pendingMedia = []; renderMediaPreview(); document.querySelector('#gifUrlInput').value = ''; document.querySelector('#gifUrlInput').hidden = true;
  document.querySelector('#charCount').textContent = '0 / 2000';
  document.querySelector('#composerForm').reset(); document.querySelector('#pollBuilder').hidden = true;
  composerRequestId = ''; setComposerBusy(false); updateComposerPreview();
  composer.close();
  if (!draft) {
    if (instantPublish && createdId && decodeURIComponent(location.hash.split('/')[1] || '') === temporaryId) {
      history.replaceState(null, '', `#take/${encodeURIComponent(createdId)}`); renderRoute();
    } else navigate(createdId && !scheduledValue ? `take/${createdId}` : 'home');
    Promise.allSettled([hydratePosts(), hydrateSession(), hydrateLeaderboard(), hydrateTrending()]).then(() => {
      if (currentRoute() === 'take' || currentRoute() === 'home') renderRoute();
    });
  }
  showToast(draft ? 'Draft saved.' : scheduledValue ? 'Take scheduled.' : 'Your take is live.');
}

document.querySelector('#composerForm').addEventListener('submit', async event => {
  event.preventDefault();
  await submitComposer(false);
});
document.querySelector('#saveDraft').addEventListener('click', () => submitComposer(true));
document.querySelector('#guildForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = sanitizeInput(document.querySelector('#guildName').value);
  const description = sanitizeInput(document.querySelector('#guildDescription').value);
  if (!name || !description) return;
  if (!sessionUser) { guildComposer.close(); navigate('auth'); return showToast('Sign in to create a guild.'); }
  try { await apiFetch('/api/guilds', { method: 'POST', body: JSON.stringify({ name, description, privacy: document.querySelector('#guildPrivacy').value }) }); trackEvent('create_guild', { privacy: document.querySelector('#guildPrivacy').value }); await hydrateGuilds(); }
  catch (error) { return showToast(error.message); }
  form.reset();
  guildComposer.close();
  navigate('guilds');
  renderRoute();
  showToast('Guild created.');
});
let searchTimer;
document.querySelector('#globalSearch').addEventListener('input', event => {
  clearTimeout(searchTimer);
  const query = event.target.value.trim();
  const panel = document.querySelector('#globalSearchResults');
  if (query.length < 2) { panel.hidden = true; panel.innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    try {
      const result = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`, {}, false);
      const users = (result.users || []).map(user => `<button type="button" data-search-profile="${user.id}"><span class="avatar">${user.avatarUrl ? `<img src="${escapeHtml(user.avatarUrl)}" alt="" />` : escapeHtml((user.displayName || 'C').charAt(0))}</span><span><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.handle || '')}</small></span></button>`).join('');
      const posts = (result.posts || []).map(post => `<button type="button" data-search-take="${escapeHtml(post.id)}"><span>↗</span><span><strong>${escapeHtml(post.content)}</strong><small>Take</small></span></button>`).join('');
      const guilds = (result.guilds || []).map(guild => `<button type="button" data-search-guild><span>⚔</span><span><strong>${escapeHtml(guild.name)}</strong><small>Guild</small></span></button>`).join('');
      panel.innerHTML = users || posts || guilds ? `${users}${posts}${guilds}` : '<p>No people, takes, or guilds found.</p>';
      panel.hidden = false;
      panel.querySelectorAll('[data-search-take]').forEach(button => button.addEventListener('click', () => { panel.hidden = true; navigate(`take/${button.dataset.searchTake}`); }));
      panel.querySelectorAll('[data-search-guild]').forEach(button => button.addEventListener('click', () => { panel.hidden = true; navigate('guilds'); }));
      panel.querySelectorAll('[data-search-profile]').forEach(button => button.addEventListener('click', () => { panel.hidden = true; navigate(`user/${button.dataset.searchProfile}`); }));
    } catch (error) { showToast(error.message); }
  }, 220);
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    document.querySelector('#globalSearch').focus();
  }
});
if (window.matchMedia) {
  const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemThemeChange = () => { if (state.settings.theme === 'system') applyDisplaySettings(); };
  if (themeMedia.addEventListener) themeMedia.addEventListener('change', handleSystemThemeChange);
  else if (themeMedia.addListener) themeMedia.addListener(handleSystemThemeChange);
}
window.addEventListener('hashchange', async () => {
  renderRoute();
  if (currentRoute() === 'take') { await hydrateTake(activeTake()); renderRoute(); }
  if (currentRoute() === 'trending') { await hydrateTrending(); renderRoute(); }
  if (currentRoute() === 'guilds') { await hydrateGuilds(); renderRoute(); }
  if (currentRoute() === 'notifications' || currentRoute() === 'messages') { await hydrateAccountData(); renderRoute(); }
  if (currentRoute() === 'saved') { await hydrateSavedPosts(); renderRoute(); }
  if (currentRoute() === 'guild') { await hydrateGuildDetail(); renderRoute(); }
  if (currentRoute() === 'user') { await hydratePublicProfile(); renderRoute(); }
  if (currentRoute() === 'profile') { await hydrateOwnProfile(); renderRoute(); }
  if (currentRoute() === 'analytics') { await hydrateAnalytics(); renderRoute(); }
});

setInterval(async () => {
  if (document.activeElement?.matches('textarea,input')) return;
  if (currentRoute() === 'messages' && sessionUser) { await hydrateAccountData(); renderRoute(); }
  if (currentRoute() === 'guild' && location.hash.split('/')[2] === 'chat' && sessionUser) { await hydrateGuildDetail(); renderRoute(); }
}, 4000);

updateHeaderProfile();
applyDisplaySettings();
if (!location.hash) history.replaceState(null, '', '#home');
loadGoogleAnalytics();
renderRoute();
hydrateApp();
loadProductionAds();
