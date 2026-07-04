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
    return { platform: 'x', url: url.toString() };
  }
  if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it') {
    if (host !== 'redd.it' && !/\/comments\/[A-Za-z0-9]+/i.test(url.pathname)) throw new Error('Paste a direct Reddit post or comment link.');
    if (host !== 'redd.it') url.hostname = 'www.reddit.com';
    url.search = ''; url.hash = '';
    return { platform: 'reddit', url: url.toString() };
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
  return {
    platform: 'x', url: source.url, authorName: htmlText(data.author_name),
    authorHandle: data.author_url ? `@${new URL(data.author_url).pathname.split('/').filter(Boolean)[0] || data.author_name}` : `@${data.author_name || 'x'}`,
    authorAvatar: '', text: firstMatch(data.html, /<p[^>]*>([\s\S]*?)<\/p>/i), community: '', mediaUrl: '',
    replyCount: 0, repostCount: 0, likeCount: 0, viewCount: 0, sourceCreatedAt: null, fetchedAt: fetchedAt()
  };
}

async function previewReddit(source) {
  const data = await getJson(`https://www.reddit.com/oembed?url=${encodeURIComponent(source.url)}`);
  const community = firstMatch(data.html, /href="https:\/\/www\.reddit\.com\/r\/[^"/]+\/?"[^>]*>([^<]+)<\/a>/i);
  const title = firstMatch(data.html, /<blockquote[\s\S]*?<a[^>]+>([\s\S]*?)<\/a>/i);
  return {
    platform: 'reddit', url: source.url, authorName: htmlText(data.author_name || 'Redditor'),
    authorHandle: data.author_name ? `u/${htmlText(data.author_name)}` : 'u/redditor', authorAvatar: '', text: title,
    community: community ? `r/${community.replace(/^r\//, '')}` : '', mediaUrl: '', replyCount: 0, repostCount: 0,
    likeCount: 0, viewCount: 0, sourceCreatedAt: null, fetchedAt: fetchedAt()
  };
}

async function previewBluesky(source) {
  const did = source.handle.startsWith('did:') ? source.handle : (await getJson(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(source.handle)}`)).did;
  const uri = `at://${did}/app.bsky.feed.post/${source.rkey}`;
  const data = await getJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=0`);
  const post = data.thread?.post;
  if (!post?.record) throw new Error('That Bluesky post is unavailable.');
  const image = post.embed?.images?.[0]?.thumb || post.embed?.media?.images?.[0]?.thumb || '';
  return {
    platform: 'bluesky', url: source.url, authorName: sanitizePlainText(post.author?.displayName || post.author?.handle || 'Bluesky user'),
    authorHandle: `@${sanitizePlainText(post.author?.handle || source.handle)}`, authorAvatar: post.author?.avatar || '',
    text: sanitizePlainText(post.record.text || ''), community: '', mediaUrl: image, replyCount: Number(post.replyCount || 0),
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
