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
    socialLinks: { twitter: '', instagram: '', discord: '', youtube: '', twitch: '', custom: '' },
    pronouns: '',
    status: 'online',
    vibeScore: 0
  },
  settings: {
    appearanceVersion: 2,
    theme: 'light',
    notifications: { likes: true, comments: true, guildInvites: true },
    directMessages: 'everyone',
    textSize: 'medium',
    blockedUsers: []
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
  savedPostIds: Array.isArray(storedState?.savedPostIds) ? storedState.savedPostIds : []
};

if (storedState?.settings?.appearanceVersion !== 2) {
  state.settings.appearanceVersion = 2;
  state.settings.theme = 'light';
}

const routes = new Set(['home', 'trending', 'guilds', 'leaderboards', 'notifications', 'messages', 'saved', 'profile', 'settings', 'take', 'auth']);
const mainContent = document.querySelector('#mainContent');
const composer = document.querySelector('#composer');
const guildComposer = document.querySelector('#guildComposer');
const actionDialog = document.querySelector('#actionDialog');
let sessionUser = null;

function sanitizeInput(value) {
  const source = String(value || '');
  return window.DOMPurify ? window.DOMPurify.sanitize(source, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim() : source.replace(/<[^>]*>/g, '').trim();
}

function loadProductionAds() {
  const client = document.querySelector('meta[name="adsense-client"]')?.content || '';
  if (!/^ca-pub-\d{10,}$/.test(client) || location.protocol === 'file:') return;
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.appendChild(script);
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

async function apiFetch(url, options = {}, retry = true) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  if (response.status === 401 && retry && !url.includes('/api/auth/')) {
    const refreshed = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
    if (refreshed.ok) return apiFetch(url, options, false);
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'Request failed.');
  return payload;
}

function applySessionUser(user) {
  sessionUser = user;
  if (!user) return;
  state.profile = {
    ...state.profile,
    displayName: user.displayName || state.profile.displayName,
    handle: user.handle || state.profile.handle,
    avatarUrl: user.avatarUrl || state.profile.avatarUrl,
    vibeScore: Number(user.vibeScore ?? state.profile.vibeScore),
    bio: user.bio ?? state.profile.bio,
    bannerUrl: user.bannerUrl ?? state.profile.bannerUrl,
    themeColor: user.themeColor || state.profile.themeColor,
    socialLinks: { ...state.profile.socialLinks, ...(user.socialLinks || {}) },
    pronouns: user.pronouns ?? state.profile.pronouns,
    status: user.status || state.profile.status
  };
  if (user.preferences) {
    state.settings = {
      ...state.settings,
      ...user.preferences,
      notifications: { ...state.settings.notifications, ...(user.preferences.notifications || {}) }
    };
  }
  persist();
  document.querySelector('#headerName').textContent = state.profile.displayName;
}

async function hydrateSession() {
  try { const payload = await apiFetch('/api/auth/me', {}, false); applySessionUser(payload.user); if (currentRoute() === 'profile' || currentRoute() === 'auth') renderRoute(); } catch { sessionUser = null; }
}

async function hydratePosts() {
  try {
    const payload = await apiFetch('/api/posts', {}, false);
    state.posts = (payload.posts || []).map(post => {
      const id = String(post.id || post._id);
      return {
        id,
        databaseId: id,
        authorId: String(post.author?.id || post.author?._id || post.author || ''),
        authorHandle: post.author?.handle || '@member',
        authorName: post.author?.displayName || 'Callout member',
        authorAvatarUrl: post.author?.avatarUrl || '',
        text: String(post.content || '').toUpperCase(),
        category: post.category,
        alrightVotes: Number(post.alrightVotes || 0),
        cringeVotes: Number(post.cringeVotes || 0),
        userVote: null,
        comments: [],
        createdAt: new Date(post.createdAt || Date.now()).getTime()
      };
    });
    persist();
    renderRoute();
  } catch (error) { console.error('Unable to load posts:', error); }
}

async function hydrateApp() {
  await hydrateSession();
  await hydratePosts();
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
  return state.profile.avatarUrl ? `<span class="avatar ${className}"><img src="${escapeHtml(state.profile.avatarUrl)}" alt="" /></span>` : `<span class="avatar ${className}">🦸🏻</span>`;
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

function adBanner(slot = 'page-banner') {
  return `<div class="ad-slot ad-leaderboard" data-ad-slot="${slot}"><span>ADVERTISEMENT</span><small>Responsive banner</small></div>`;
}

function inFeedAd() {
  return `<div class="ad-slot ad-infeed" data-ad-slot="in-feed"><ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-XXXXXXXXXXXXXXXX" data-ad-slot="IN_FEED_SLOT" data-ad-format="fluid" data-ad-layout-key="-fb+5w+4e-db+86"></ins><span>ADVERTISEMENT</span><small>In-feed responsive unit</small></div>`;
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
  const commentCount = countComments(post.comments || []);
  return `<article class="take-card ${detail ? 'take-card-detail' : 'take-card-feed'}" data-post-id="${post.id}">
    <div class="take-top">
      ${postAvatarMarkup(post)}
      <div class="take-content" ${detail ? '' : `data-open-take="${post.id}" role="link" tabindex="0" aria-label="Open take: ${escapeHtml(post.text)}"`}>
        <div class="take-byline"><strong>${escapeHtml(post.authorHandle || '@member')}</strong><small>${timeLabel(post.createdAt || Date.now())} in ${escapeHtml(post.category)}</small></div>
        <h2>${escapeHtml(post.text)}</h2>
      </div>
      <button class="icon-button save-button ${isSaved ? 'saved' : ''}" type="button" data-save-post="${post.id}" aria-label="${isSaved ? 'Remove from saved' : 'Save take'}"><svg><use href="#i-bookmark"></use></svg></button>
      <button class="icon-button" type="button" data-post-menu="${post.id}" aria-label="Post options"><svg><use href="#i-more"></use></svg></button>
    </div>
    <div class="vote-row">
      <button class="vote-button alright ${post.userVote === 'alright' ? 'selected' : ''}" type="button" data-vote="alright"><span class="vote-face">☺</span><strong>ALRIGHT</strong></button>
      <b class="percent alright-percent">${alrightPercent}%</b>
      <div class="vote-progress" style="--alright:${alrightPercent}%" role="progressbar" aria-label="${alrightPercent}% Alright, ${cringePercent}% Cringe" aria-valuenow="${alrightPercent}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-glow"></div><div class="progress-divider"></div><span class="progress-pulse"></span>
      </div>
      <b class="percent cringe-percent">${cringePercent}%</b>
      <button class="vote-button cringe ${post.userVote === 'cringe' ? 'selected' : ''}" type="button" data-vote="cringe"><span class="vote-face">☹</span><strong>CRINGE</strong></button>
    </div>
    <div class="take-footer"><span>${total} ${total === 1 ? 'vote' : 'votes'}　•　${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}</span>${detail ? '' : `<button class="comment-link" type="button" data-open-take="${post.id}">Open take →</button>`}</div>
  </article>`;
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
  return `<article class="reddit-comment" style="--depth:${Math.min(depth, 5)}" data-comment-id="${comment.id}">
    <div class="comment-rail"><span class="avatar comment-avatar">🦸🏻</span><i></i></div>
    <div class="comment-content"><div class="comment-author"><strong>${escapeHtml(comment.author)}</strong><span>•</span><time>${timeLabel(comment.createdAt)}</time></div>
      <p>${escapeHtml(comment.text)}</p>
      <div class="reddit-actions"><button type="button" data-upvote-comment="${comment.id}" class="${comment.upvoted ? 'active' : ''}">↑ ${comment.votes || 0}</button><button type="button" data-reply-comment="${comment.id}">↩ Reply</button><button type="button">•••</button></div>
      <div class="reply-slot" id="reply-${comment.id}" hidden></div>
      ${(comment.replies || []).map(reply => commentNode(reply, depth + 1)).join('')}
    </div>
  </article>`;
}

function emptyThreadPreview() {
  return `<div class="empty-thread"><h3>No comments yet</h3><p>Start the discussion. Replies will stack below their parent comment with a visible thread rail.</p>
    <div class="thread-blueprint" aria-label="Nested comment layout preview"><div><span></span><i></i><i></i></div><div class="blueprint-reply"><span></span><i></i></div></div>
  </div>`;
}

function commentThreadDetail(post) {
  const comments = post.comments || [];
  return `<section class="reddit-thread">
    <div class="comment-head"><div><span class="section-kicker">DISCUSSION</span><h2>Comments</h2></div><span class="comment-count">${countComments(comments)} comments</span></div>
    <form class="comment-composer" id="commentForm"><span class="avatar comment-avatar">🦸🏻</span><label><span class="sr-only">Add a comment</span><textarea name="comment" required maxlength="500" placeholder="What do you think?"></textarea></label><button type="submit">Comment</button></form>
    <div class="comment-sort"><strong>Best</strong><button type="button">Sort: Newest⌄</button></div>
    <div class="comment-stack">${comments.length ? comments.map(comment => commentNode(comment)).join('') : emptyThreadPreview()}</div>
  </section>`;
}

function takeDetailView() {
  const id = decodeURIComponent(location.hash.split('/')[1] || '');
  const post = state.posts.find(item => String(item.id) === id);
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
  return `${pageHeader('DISCOVER', 'Trending', 'Fast-moving takes and conversations will surface here as community activity grows.')}
    ${adBanner('trending-banner')}
    <div class="segmented-control"><button class="active" type="button">Takes</button><button type="button">Topics</button><button type="button">Guilds</button></div>
    <section class="trend-stats"><div><span>LIVE SIGNAL</span><strong>—</strong><small>Active debates</small></div><div><span>MOMENTUM</span><strong>—</strong><small>Votes this hour</small></div><div><span>CLOSE CALLS</span><strong>—</strong><small>Near 50/50</small></div></section>
    ${emptyState('↗', 'Nothing is trending yet', 'This page will rank activity using real vote velocity, comment growth, and debate balance. No simulated trends are shown.')}`;
}

function guildCard(guild) {
  return `<article class="created-guild"><div class="guild-monogram">${escapeHtml(guild.name.charAt(0).toUpperCase())}</div><div><span class="section-kicker">NEW GUILD</span><h2>${escapeHtml(guild.name)}</h2><p>${escapeHtml(guild.description)}</p><small>1 member · No posts yet</small></div><button type="button" data-open-guild="${guild.id}">Open</button></article>`;
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
  return `${pageHeader('RANKINGS', 'Leaderboards', 'Transparent community rankings based only on real Callout activity.')}
    <div class="segmented-control"><button class="active" type="button">Cringiest</button><button type="button">Top Vibe</button><button type="button">Guilds</button></div>
    <section class="ranking-card">
      <div class="ranking-head"><span>RANK</span><span>USER OR GUILD</span><span>SCORE</span><span>CHANGE</span></div>
      <div class="ranking-empty"><div class="podium-outline"><i></i><i></i><i></i></div><h2>No rankings yet</h2><p>Leaderboard positions will populate after verified votes and community activity.</p></div>
    </section>
    <aside class="info-callout"><strong>How ranking works</strong><p>Scores use real votes, consistency, and participation. Empty leaderboards stay empty until those signals exist.</p></aside>`;
}

function notificationsView() {
  return `${pageHeader('INBOX', 'Notifications', 'Votes, replies, guild activity, and system updates in one place.', '<button class="quiet-action" type="button" data-mark-read>Mark all as read</button>')}
    <div class="segmented-control"><button class="active" type="button">All</button><button type="button">Replies</button><button type="button">Votes</button><button type="button">Guilds</button></div>
    ${emptyState('♢', 'You’re all caught up', 'New activity will appear here. There are no synthetic notifications in your inbox.')}`;
}

function messagesView() {
  return `${pageHeader('DIRECT MESSAGES', 'Messages', 'Private conversations with people you connect with on Callout.', '<button class="primary-action" type="button" data-new-message>＋ New message</button>')}
    <section class="messages-layout">
      <aside class="conversation-list"><label><svg><use href="#i-search"></use></svg><input type="search" placeholder="Search messages" aria-label="Search messages" /></label><div class="mini-empty"><span>✉</span><strong>No conversations</strong><p>Your message history will appear here.</p></div></aside>
      <div class="conversation-stage" id="conversationStage"><div class="stage-empty"><div class="empty-icon">✉</div><h2>Select a conversation</h2><p>Or start a new message when you have someone to contact.</p></div></div>
    </section>`;
}

function savedView() {
  const saved = state.posts.filter(post => state.savedPostIds.includes(post.id));
  return `${pageHeader('YOUR LIBRARY', 'Saved', 'Takes you want to revisit, kept private to your account.')}
    ${saved.length ? `<section class="take-list">${saved.map(postTemplate).join('')}</section>` : emptyState('◇', 'Nothing saved yet', 'Use the bookmark on a real take and it will be collected here.')}`;
}

function profileView() {
  const profile = state.profile;
  const social = profile.socialLinks || {};
  const links = [['𝕏', social.twitter], ['◎', social.instagram], ['◈', social.discord], ['▶', social.youtube], ['◉', social.twitch], ['↗', social.custom]].filter(([, value]) => value).map(([icon, value]) => `<span>${icon} ${escapeHtml(value)}</span>`);
  return `${pageHeader('ACCOUNT', 'Your profile', 'A customizable public identity with Discord-level detail.', '<button class="quiet-action" type="button" data-open-settings>Edit profile</button>')}
    <section class="profile-hero discord-profile" style="--profile-accent:${escapeHtml(profile.themeColor)}">
      <div class="profile-cover">${profile.bannerUrl ? `<img src="${escapeHtml(profile.bannerUrl)}" alt="Profile banner" />` : '<span>CALL IT LIKE YOU SEE IT.</span>'}</div>
      <div class="profile-identity">${avatarMarkup('profile-avatar')}<div><div class="identity-line"><h2>${escapeHtml(profile.displayName)}</h2><i class="status-dot ${escapeHtml(profile.status)}"></i></div><p>${escapeHtml(profile.handle)}${profile.pronouns ? ` · ${escapeHtml(profile.pronouns)}` : ''}</p></div><div class="vibe-stat-card"><span>✦</span><div><strong>${Number(profile.vibeScore || 0).toLocaleString()}</strong><small>VIBE SCORE</small></div></div></div>
    </section>
    <section class="profile-summary"><div><span class="section-kicker">ABOUT ME</span><h2>${profile.bio ? escapeHtml(profile.bio) : 'No bio added yet.'}</h2><p>Status: ${escapeHtml(profile.status.toUpperCase())}</p></div><div><span class="section-kicker">SOCIAL LINKS</span><h2>Find me elsewhere</h2><div class="profile-links">${links.length ? links.join('') : '<p>No social links added yet.</p>'}</div></div></section>
    <section class="badges-card"><div><span class="section-kicker">BADGES</span><h2>Collected badges</h2></div><div class="badge-grid"><span title="Early Adopter">🚀<strong>Early Adopter</strong></span><span class="locked" title="Locked badge">◇<strong>Locked</strong></span><span class="locked" title="Locked badge">◇<strong>Locked</strong></span></div></section>`;
}

function settingsView() {
  const settings = state.settings;
  const checked = value => value ? 'checked' : '';
  return `${pageHeader('PREFERENCES', 'Settings', 'Manage appearance, notifications, privacy, and account details.')}
    <form class="settings-form" id="settingsForm">
      <section class="settings-section"><div class="settings-section-head"><div><span class="settings-icon">◐</span><div><h2>Appearance</h2><p>Choose how Callout looks on this device.</p></div></div></div>
        <div class="theme-options" role="radiogroup" aria-label="Theme"><label><input type="radio" name="theme" value="light" ${checked(settings.theme === 'light')} /><span>☀<strong>Light</strong><small>Bright and crisp</small></span></label><label><input type="radio" name="theme" value="dark" ${checked(settings.theme === 'dark')} /><span>◐<strong>Dark</strong><small>Easy on the eyes</small></span></label><label><input type="radio" name="theme" value="system" ${checked(settings.theme === 'system')} /><span>◫<strong>System</strong><small>Match your device</small></span></label></div>
      </section>
      <section class="settings-section"><div class="settings-section-head"><div><span class="settings-icon">♢</span><div><h2>Notification preferences</h2><p>Choose what deserves your attention.</p></div></div></div>
        <div class="setting-rows"><label class="setting-row"><span><strong>Likes</strong><small>When someone votes Alright on your take</small></span><input class="switch-input" type="checkbox" name="notifyLikes" ${checked(settings.notifications.likes)} /><i></i></label><label class="setting-row"><span><strong>Comments</strong><small>Replies and new comments on your takes</small></span><input class="switch-input" type="checkbox" name="notifyComments" ${checked(settings.notifications.comments)} /><i></i></label><label class="setting-row"><span><strong>Guild invites</strong><small>Invitations to join a community</small></span><input class="switch-input" type="checkbox" name="notifyGuildInvites" ${checked(settings.notifications.guildInvites)} /><i></i></label></div>
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
        <div class="form-grid"><label>Profile banner<input id="bannerUpload" type="file" accept="image/*" /><small>PNG, JPG, GIF, or WebP. Maximum 2 MB.</small></label><label>Theme color<div class="color-control"><input name="themeColor" type="color" value="${escapeHtml(state.profile.themeColor)}" /><output id="colorHex">${escapeHtml(state.profile.themeColor)}</output></div></label></div>
        <input type="hidden" name="bannerUrl" value="${escapeHtml(state.profile.bannerUrl)}" />
        <label>About Me <span class="field-counter" id="bioCounter">${state.profile.bio.length} / 200</span><textarea name="bio" maxlength="200" placeholder="Tell people what kind of takes you bring.">${escapeHtml(state.profile.bio)}</textarea></label>
        <div class="social-fields"><h3>Social media</h3><label><span>𝕏</span><input name="twitter" value="${escapeHtml(state.profile.socialLinks.twitter)}" placeholder="x.com/username" /></label><label><span>◎</span><input name="instagram" value="${escapeHtml(state.profile.socialLinks.instagram)}" placeholder="instagram.com/username" /></label><label><span>◈</span><input name="discord" value="${escapeHtml(state.profile.socialLinks.discord)}" placeholder="Discord username" /></label><label><span>▶</span><input name="youtube" value="${escapeHtml(state.profile.socialLinks.youtube)}" placeholder="youtube.com/@channel" /></label><label><span>◉</span><input name="twitch" value="${escapeHtml(state.profile.socialLinks.twitch)}" placeholder="twitch.tv/username" /></label><label><span>↗</span><input name="custom" value="${escapeHtml(state.profile.socialLinks.custom)}" placeholder="https://your-site.example" /></label></div>
      </section>
      <section class="settings-section"><div class="settings-section-head"><div><span class="settings-icon">⊘</span><div><h2>Blocked & muted users</h2><p>Accounts you have restricted will be listed here.</p></div></div></div>
        <div class="blocked-list">${settings.blockedUsers.length ? settings.blockedUsers.map(user => `<div><span class="skeleton-avatar small"></span><strong>${escapeHtml(user)}</strong><button type="button" data-unblock="${escapeHtml(user)}">Unblock</button></div>`).join('') : '<div class="blocked-empty"><span class="skeleton-avatar small"></span><span><strong>No blocked accounts</strong><small>Blocked users will appear here.</small></span><button type="button" disabled>Unblock</button></div>'}</div>
      </section>
      <div class="settings-save"><span>Preferences are saved on this device.</span><button class="primary-action" type="submit">Save settings</button></div>
    </form>`;
}

function authView() {
  if (sessionUser) return `${pageHeader('SECURITY', 'Account access', 'Your session is protected by short-lived HTTP-only cookies.')}<section class="auth-session-card">${sessionUser.avatarUrl ? `<span class="avatar"><img src="${escapeHtml(sessionUser.avatarUrl)}" alt="" /></span>` : '<span class="avatar">✓</span>'}<div><span class="section-kicker">SIGNED IN</span><h2>${escapeHtml(sessionUser.displayName)}</h2><p>${escapeHtml(sessionUser.email)}</p></div><button class="quiet-action" type="button" data-logout>Sign out</button></section>`;
  return `${pageHeader('SECURE ACCESS', 'Join Callout', 'Sign in with email or Google. Authentication tokens are never stored in localStorage.')}
    <section class="auth-grid"><form class="auth-card" id="loginForm"><span class="section-kicker">WELCOME BACK</span><h2>Sign in</h2><label>Email<input type="email" name="email" autocomplete="email" required /></label><label>Password<input type="password" name="password" autocomplete="current-password" required minlength="8" /></label><button class="primary-action" type="submit">Sign in</button><a class="google-auth" href="/api/auth/google">G&nbsp; Continue with Google</a></form>
    <form class="auth-card" id="signupForm"><span class="section-kicker">NEW ACCOUNT</span><h2>Create account</h2><label>Display name<input name="displayName" maxlength="40" required /></label><label>Email<input type="email" name="email" autocomplete="email" required /></label><label>Password<input type="password" name="password" autocomplete="new-password" required minlength="8" /></label><label class="age-check"><input type="checkbox" name="ageConfirmed" required /><span>I confirm I am 13 years or older.</span></label><button class="primary-action" type="submit">Create account</button><a class="google-auth" href="/api/auth/google">G&nbsp; Sign up with Google</a></form></section>
    <details class="reset-panel"><summary>Forgot your password?</summary><form id="resetRequestForm"><label>Email<input type="email" name="email" required /></label><button class="quiet-action" type="submit">Request reset</button></form><form id="resetConfirmForm" hidden><label>Email<input type="email" name="email" required /></label><label>Reset token<input name="token" required /></label><label>New password<input type="password" name="password" minlength="8" required /></label><button class="primary-action" type="submit">Update password</button></form></details>`;
}

const viewRenderers = { home: homeView, trending: trendingView, guilds: guildsView, leaderboards: leaderboardsView, notifications: notificationsView, messages: messagesView, saved: savedView, profile: profileView, settings: settingsView, take: takeDetailView, auth: authView };

function renderRoute() {
  const route = currentRoute();
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route || (route === 'take' && item.dataset.route === 'home')));
  document.querySelector('#sidebar').classList.remove('open');
  mainContent.innerHTML = viewRenderers[route]();
  mainContent.dataset.route = route;
  document.title = `${route === 'home' ? 'Callout' : `${route.charAt(0).toUpperCase()}${route.slice(1)} · Callout`}`;
  bindViewInteractions(route);
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

function bindPostInteractions() {
  document.querySelectorAll('[data-vote]').forEach(button => button.addEventListener('click', () => {
    const card = button.closest('[data-post-id]');
    const post = state.posts.find(item => String(item.id) === card.dataset.postId);
    if (!post) return;
    const nextVote = button.dataset.vote;
    if (post.userVote === nextVote) return showToast('You already called this one.');
    if (post.userVote === 'alright') post.alrightVotes = Math.max(0, post.alrightVotes - 1);
    if (post.userVote === 'cringe') post.cringeVotes = Math.max(0, post.cringeVotes - 1);
    if (nextVote === 'alright') post.alrightVotes += 1;
    if (nextVote === 'cringe') post.cringeVotes += 1;
    post.userVote = nextVote;
    persist();
    renderRoute();
    showToast(nextVote === 'alright' ? 'You called it Alright.' : 'You called it Cringe.');
  }));
  document.querySelectorAll('[data-save-post]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.savePost;
    const index = state.savedPostIds.indexOf(id);
    if (index >= 0) state.savedPostIds.splice(index, 1); else state.savedPostIds.push(id);
    persist(); renderRoute(); showToast(index >= 0 ? 'Removed from saved.' : 'Saved for later.');
  }));
  document.querySelectorAll('[data-open-take]').forEach(element => {
    const open = () => navigate(`take/${element.dataset.openTake}`);
    element.addEventListener('click', open);
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
  document.querySelectorAll('[data-post-menu]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); openPostMenu(button.dataset.postMenu); }));
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
  document.querySelector('[data-mark-read]')?.addEventListener('click', () => showToast('No unread notifications.'));
  document.querySelector('[data-new-message]')?.addEventListener('click', renderMessageComposer);
  document.querySelector('[data-open-settings]')?.addEventListener('click', () => navigate('settings'));
  document.querySelector('[data-back-feed]')?.addEventListener('click', () => navigate('home'));
  document.querySelector('#commentForm')?.addEventListener('submit', addComment);
  document.querySelector('#settingsForm')?.addEventListener('submit', saveSettings);
  document.querySelectorAll('input[name="theme"], input[name="textSize"]').forEach(input => input.addEventListener('change', previewDisplaySettings));
  document.querySelector('#settingsForm')?.addEventListener('input', updateProfilePreview);
  document.querySelector('#bannerUpload')?.addEventListener('change', handleBannerUpload);
  document.querySelectorAll('[data-reply-comment]').forEach(button => button.addEventListener('click', () => openReplyComposer(button.dataset.replyComment)));
  document.querySelectorAll('[data-upvote-comment]').forEach(button => button.addEventListener('click', () => toggleCommentVote(button.dataset.upvoteComment)));
  document.querySelectorAll('[data-unblock]').forEach(button => button.addEventListener('click', () => unblockUser(button.dataset.unblock)));
  document.querySelectorAll('[data-open-guild]').forEach(button => button.addEventListener('click', () => showToast('Guild workspace ready for member activity.')));
  document.querySelector('#loginForm')?.addEventListener('submit', loginUser);
  document.querySelector('#signupForm')?.addEventListener('submit', signupUser);
  document.querySelector('#resetRequestForm')?.addEventListener('submit', requestPasswordReset);
  document.querySelector('#resetConfirmForm')?.addEventListener('submit', confirmPasswordReset);
  document.querySelector('[data-logout]')?.addEventListener('click', logoutUser);
}

function renderMessageComposer() {
  const stage = document.querySelector('#conversationStage');
  stage.innerHTML = `<form class="message-compose" id="messageForm"><div><span class="section-kicker">NEW MESSAGE</span><h2>Start a conversation</h2></div><label>To<input name="recipient" required placeholder="@username" /></label><label>Message<textarea name="message" required placeholder="Write a message..."></textarea></label><button class="primary-action" type="submit">Send message</button></form>`;
  document.querySelector('#messageForm').addEventListener('submit', async event => {
    event.preventDefault();
    const recipient = sanitizeInput(event.currentTarget.elements.recipient.value);
    const message = sanitizeInput(event.currentTarget.elements.message.value);
    if (!recipient || !message) return;
    try { if (sessionUser) await apiFetch('/api/messages', { method: 'POST', body: JSON.stringify({ recipient, message }) }); showToast('Message accepted.'); }
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
  const post = state.posts.find(item => String(item.id) === String(id));
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
  if (event.target.name === 'bio') document.querySelector('#bioCounter').textContent = `${event.target.value.length} / 200`;
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

async function loginUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const payload = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: sanitizeInput(form.elements.email.value), password: form.elements.password.value }) }, false);
    applySessionUser(payload.user); navigate('home'); await hydratePosts(); showToast('Signed in securely.');
  } catch (error) { showToast(error.message); }
}

async function signupUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const payload = await apiFetch('/api/auth/signup', { method: 'POST', body: JSON.stringify({ displayName: sanitizeInput(form.elements.displayName.value), email: sanitizeInput(form.elements.email.value), password: form.elements.password.value, ageConfirmed: form.elements.ageConfirmed.checked }) }, false);
    applySessionUser(payload.user); navigate('settings'); showToast('Account created. Customize your profile.');
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
  state.profile = { ...defaultState.profile, socialLinks: { ...defaultState.profile.socialLinks } };
  persist(); renderRoute(); showToast('Signed out.');
}

function activeTake() {
  const id = decodeURIComponent(location.hash.split('/')[1] || '');
  return state.posts.find(post => String(post.id) === id);
}

function findComment(comments, id) {
  for (const comment of comments) {
    if (comment.id === Number(id)) return comment;
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
  try { if (sessionUser) await apiFetch('/api/comments', { method: 'POST', body: JSON.stringify({ text }) }); post.comments.push({ id: Date.now(), author: state.profile.handle, text, createdAt: Date.now(), votes: 0, upvoted: false, replies: [] }); persist(); renderRoute(); showToast('Comment added.'); }
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
    try { if (sessionUser) await apiFetch('/api/comments', { method: 'POST', body: JSON.stringify({ text }) }); parent.replies.push({ id: Date.now(), author: state.profile.handle, text, createdAt: Date.now(), votes: 0, upvoted: false, replies: [] }); persist(); renderRoute(); showToast('Reply added.'); }
    catch (error) { showToast(error.message); }
  });
}

function toggleCommentVote(id) {
  const post = activeTake();
  const comment = post && findComment(post.comments, id);
  if (!comment) return;
  comment.upvoted = !comment.upvoted;
  comment.votes = Math.max(0, (comment.votes || 0) + (comment.upvoted ? 1 : -1));
  persist(); renderRoute();
}

function applyDisplaySettings() {
  const prefersDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.resolvedTheme = state.settings.theme === 'system' ? (prefersDark ? 'dark' : 'light') : state.settings.theme;
  document.documentElement.dataset.textSize = state.settings.textSize;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', document.documentElement.dataset.resolvedTheme === 'dark' ? '#151513' : '#ff4713');
}

function previewDisplaySettings() {
  const form = document.querySelector('#settingsForm');
  if (!form) return;
  const prefersDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
  document.documentElement.dataset.theme = form.elements.theme.value;
  document.documentElement.dataset.resolvedTheme = form.elements.theme.value === 'system' ? (prefersDark ? 'dark' : 'light') : form.elements.theme.value;
  document.documentElement.dataset.textSize = form.elements.textSize.value;
}

async function saveSettings(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  state.settings.theme = formData.get('theme');
  state.settings.textSize = formData.get('textSize');
  state.settings.directMessages = formData.get('directMessages');
  state.settings.notifications = { likes: formData.has('notifyLikes'), comments: formData.has('notifyComments'), guildInvites: formData.has('notifyGuildInvites') };
  state.profile = {
    ...state.profile,
    displayName: sanitizeInput(formData.get('displayName')),
    handle: sanitizeInput(formData.get('handle')).toLowerCase().replace(/\s+/g, '_'),
    bio: sanitizeInput(formData.get('bio')),
    bannerUrl: formData.get('bannerUrl') || '',
    themeColor: formData.get('themeColor'),
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
      const payload = await apiFetch('/api/profile', { method: 'PATCH', body: JSON.stringify({ displayName: state.profile.displayName, handle: state.profile.handle, avatarUrl: state.profile.avatarUrl, bio: state.profile.bio, bannerUrl: state.profile.bannerUrl, themeColor: state.profile.themeColor, socialLinks: state.profile.socialLinks, pronouns: state.profile.pronouns, status: state.profile.status, preferences: { theme: state.settings.theme, notifications: state.settings.notifications, directMessages: state.settings.directMessages, textSize: state.settings.textSize } }) });
      applySessionUser(payload.user);
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
document.querySelector('#profileButton').addEventListener('click', () => navigate('profile'));
document.querySelector('#mobileMenu').addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'));
function openComposerForUser() {
  if (!sessionUser) { navigate('auth'); return showToast('Create an account or sign in to post a take.'); }
  composer.showModal();
}

document.querySelector('#openComposer').addEventListener('click', openComposerForUser);
document.querySelector('[data-close-composer]').addEventListener('click', () => composer.close());
document.querySelector('[data-close-guild]').addEventListener('click', () => guildComposer.close());
document.querySelector('#takeText').addEventListener('input', event => document.querySelector('#charCount').textContent = `${event.target.value.length} / 180`);
document.querySelector('#composerForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!sessionUser) { composer.close(); navigate('auth'); return showToast('Sign in to publish a take.'); }
  const input = document.querySelector('#takeText');
  const text = sanitizeInput(input.value);
  if (!text) return;
  const category = document.querySelector('#takeCategory').value;
  const post = { id: String(Date.now()), authorId: currentUserId(), authorHandle: state.profile.handle, authorName: state.profile.displayName, authorAvatarUrl: state.profile.avatarUrl, text: text.toUpperCase(), category, alrightVotes: 0, cringeVotes: 0, userVote: null, comments: [], createdAt: Date.now() };
  try {
    const payload = await apiFetch('/api/posts', { method: 'POST', body: JSON.stringify({ content: text, category }) });
    post.databaseId = String(payload.post._id || payload.post.id);
    post.id = post.databaseId;
  } catch (error) { return showToast(error.message); }
  state.posts.unshift(post);
  persist();
  input.value = '';
  document.querySelector('#charCount').textContent = '0 / 180';
  composer.close();
  navigate('home');
  renderRoute();
  showToast('Your take is live.');
});
document.querySelector('#guildForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = sanitizeInput(document.querySelector('#guildName').value);
  const description = sanitizeInput(document.querySelector('#guildDescription').value);
  if (!name || !description) return;
  state.guilds.push({ id: Date.now(), name, description });
  persist();
  event.currentTarget.reset();
  guildComposer.close();
  navigate('guilds');
  renderRoute();
  showToast('Guild created.');
});
document.querySelector('#globalSearch').addEventListener('input', event => {
  if (currentRoute() !== 'home') navigate('home');
  renderFilteredPosts('All', event.target.value.trim());
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
window.addEventListener('hashchange', renderRoute);

document.querySelector('#headerName').textContent = state.profile.displayName;
applyDisplaySettings();
if (!location.hash) history.replaceState(null, '', '#home');
renderRoute();
hydrateApp();
loadProductionAds();
