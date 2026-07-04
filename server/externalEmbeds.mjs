import { sanitizePlainText } from './security.mjs';

const decodeEntities = value => String(value || '')
  .replace(/&mdash;/gi, '—').replace(/&ndash;/gi, '–').replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
const htmlText = value => sanitizePlainText(decodeEntities(String(value || '').replace(/<br\s*\/?>/gi, '\n')));
const firstMatch = (value, pattern) => htmlText(String(value || '').match(pattern)?.[1] || '');
const fetchedAt = () => new Date().toISOString();

async function getJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Callout/1.0 (+https://callout-social.onrender.com)' },
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`The source returned ${response.status}.`);
  return response.json();
}

function parseSource(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('Paste a valid HTTPS post URL.'); }
  if (url.protocol !== 'https:') throw new Error('Only HTTPS post links are supported.');
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') {
    if (!/^\/[A-Za-z0-9_]{1,15}\/status\/\d+/.test(url.pathname)) throw new Error('Paste a direct X post link.');
    url.hostname = 'x.com'; url.search = ''; url.hash = '';
    return { platform: 'x', url: url.toString(), postId: url.pathname.match(/status\/(\d+)/)?.[1] || '' };
  }
  if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it') {
    const isShareLink = /^\/r\/[^/]+\/s\/[A-Za-z0-9]+/i.test(url.pathname);
    if (host !== 'redd.it' && !/\/comments\/[A-Za-z0-9]+/i.test(url.pathname) && !isShareLink) throw new Error('Paste a direct Reddit post or comment link.');
    if (host !== 'redd.it') url.hostname = 'www.reddit.com';
    url.search = ''; url.hash = '';
    return { platform: 'reddit', url: url.toString(), needsResolution: host === 'redd.it' || isShareLink };
  }
  if (host === 'bsky.app') {
    const match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)/);
    if (!match) throw new Error('Paste a direct Bluesky post link.');
    url.search = ''; url.hash = '';
    return { platform: 'bluesky', url: url.toString(), handle: decodeURIComponent(match[1]), rkey: match[2] };
  }
  throw new Error('Callout currently supports X, Reddit, and Bluesky post links.');
}

async function previewX(source) {
  const data = await getJson(`https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(source.url)}`);
  let rich = null;
  try { rich = await getJson(`https://api.fxtwitter.com/2/status/${encodeURIComponent(source.postId)}`); } catch { /* Keep the official oEmbed fallback. */ }
  const tweet = rich?.status;
  const mediaItems = (tweet?.media?.all || []).slice(0, 4).map(item => {
    if (item.type === 'photo') return { type: 'image', url: item.url, thumbnailUrl: '', alt: sanitizePlainText(item.altText || '') };
    const mp4Options = [...(item.formats || [])].filter(format => format.container === 'mp4').sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
    const mp4 = mp4Options.find(format => Number(format.bitrate || 0) <= 3_000_000)?.url || mp4Options.at(-1)?.url;
    return { type: 'video', url: mp4 || item.transcode_url || item.url, thumbnailUrl: item.thumbnail_url || '', alt: '' };
  }).filter(item => item.url);
  const primary = mediaItems[0] || null;
  return {
    platform: 'x', url: source.url, authorName: sanitizePlainText(tweet?.author?.name || htmlText(data.author_name)),
    authorHandle: tweet?.author?.screen_name ? `@${sanitizePlainText(tweet.author.screen_name)}` : data.author_url ? `@${new URL(data.author_url).pathname.split('/').filter(Boolean)[0] || data.author_name}` : `@${data.author_name || 'x'}`,
    authorAvatar: tweet?.author?.avatar_url || '', text: sanitizePlainText(tweet?.text || firstMatch(data.html, /<p[^>]*>([\s\S]*?)<\/p>/i)), community: '', mediaUrl: primary?.url || '', mediaType: primary?.type || '', mediaItems,
    replyCount: 0, repostCount: 0, likeCount: 0, viewCount: 0, sourceCreatedAt: null, fetchedAt: fetchedAt()
  };
}

async function resolveReddit(source) {
  if (!source.needsResolution) return source;
  let current = source.url;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(current, {
      redirect: 'manual', headers: { 'user-agent': 'Callout/1.0 (+https://callout-social.onrender.com)' },
      signal: AbortSignal.timeout(8_000)
    });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location) break;
    const next = new URL(location, current);
    const host = next.hostname.toLowerCase().replace(/^www\./, '');
    if (next.protocol !== 'https:' || !(host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it')) throw new Error('That Reddit share link is unavailable.');
    current = next.toString();
  }
  const resolved = parseSource(current);
  if (!/\/comments\/[A-Za-z0-9]+/i.test(new URL(resolved.url).pathname)) throw new Error('That Reddit share link is unavailable.');
  return { ...resolved, needsResolution: false };
}

async function previewReddit(source) {
  source = await resolveReddit(source);
  const data = await getJson(`https://www.reddit.com/oembed?url=${encodeURIComponent(source.url)}`);
  const community = firstMatch(data.html, /href="https:\/\/www\.reddit\.com\/r\/[^"/]+\/?"[^>]*>([^<]+)<\/a>/i);
  const title = firstMatch(data.html, /<blockquote[\s\S]*?<a[^>]+>([\s\S]*?)<\/a>/i);
  return {
    platform: 'reddit', url: source.url, authorName: htmlText(data.author_name || 'Redditor'),
    authorHandle: data.author_name ? `u/${htmlText(data.author_name)}` : 'u/redditor', authorAvatar: '', text: title,
    community: community ? `r/${community.replace(/^r\//, '')}` : '', mediaUrl: data.thumbnail_url || '', mediaType: data.thumbnail_url ? 'image' : '',
    mediaItems: data.thumbnail_url ? [{ type: 'image', url: data.thumbnail_url, thumbnailUrl: '', alt: title }] : [], replyCount: 0, repostCount: 0,
    likeCount: 0, viewCount: 0, sourceCreatedAt: null, fetchedAt: fetchedAt()
  };
}

async function previewBluesky(source) {
  const did = source.handle.startsWith('did:') ? source.handle : (await getJson(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(source.handle)}`)).did;
  const uri = `at://${did}/app.bsky.feed.post/${source.rkey}`;
  const data = await getJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=0`);
  const post = data.thread?.post;
  if (!post?.record) throw new Error('That Bluesky post is unavailable.');
  const blueskyImages = post.embed?.items || post.embed?.images || post.embed?.media?.images || [];
  const mediaItems = blueskyImages.slice(0, 4).map(item => ({
    type: 'image', url: item.fullsize || item.thumb || item.thumbnail || '', thumbnailUrl: item.thumbnail || item.thumb || '', alt: sanitizePlainText(item.alt || '')
  })).filter(item => item.url);
  const image = mediaItems[0]?.url || '';
  return {
    platform: 'bluesky', url: source.url, authorName: sanitizePlainText(post.author?.displayName || post.author?.handle || 'Bluesky user'),
    authorHandle: `@${sanitizePlainText(post.author?.handle || source.handle)}`, authorAvatar: post.author?.avatar || '',
    text: sanitizePlainText(post.record.text || ''), community: '', mediaUrl: image, mediaType: image ? 'image' : '', mediaItems, replyCount: Number(post.replyCount || 0),
    repostCount: Number(post.repostCount || 0), likeCount: Number(post.likeCount || 0), viewCount: Number(post.quoteCount || 0),
    sourceCreatedAt: post.record.createdAt || null, fetchedAt: fetchedAt()
  };
}

export async function buildExternalEmbed(rawUrl) {
  const source = parseSource(rawUrl);
  if (source.platform === 'x') return previewX(source);
  if (source.platform === 'reddit') return previewReddit(source);
  return previewBluesky(source);
}
