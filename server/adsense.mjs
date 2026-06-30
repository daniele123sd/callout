import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AdminIntegration } from './models/AdminIntegration.mjs';

const ADSENSE_SCOPE = 'https://www.googleapis.com/auth/adsense.readonly';
const INTEGRATION_KEY = 'adsense';
let memoryIntegration = null;

const origin = () => String(process.env.APP_ORIGIN || '').replace(/\/$/, '');
const redirectUri = () => `${origin()}/api/adsense/oauth/callback`;
const encryptionKey = () => crypto.createHash('sha256').update(`${process.env.JWT_SECRET || ''}:callout:adsense`).digest();

export function adsenseOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && origin());
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encryptedRefreshToken = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64');
  return { encryptedRefreshToken, tokenIv: iv.toString('base64'), tokenTag: cipher.getAuthTag().toString('base64') };
}

function decrypt(record) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(record.tokenIv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tokenTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(record.encryptedRefreshToken, 'base64')), decipher.final()]).toString('utf8');
}

async function getIntegration() {
  if (mongoose.connection.readyState !== 1) return memoryIntegration;
  return AdminIntegration.findOne({ key: INTEGRATION_KEY }).select('+encryptedRefreshToken +tokenIv +tokenTag').lean().exec();
}

async function saveIntegration(refreshToken, connectedBy, accountName = '') {
  const encrypted = encrypt(refreshToken);
  const values = { key: INTEGRATION_KEY, ...encrypted, connectedBy, accountName };
  if (mongoose.connection.readyState !== 1) { memoryIntegration = values; return values; }
  return AdminIntegration.findOneAndUpdate({ key: INTEGRATION_KEY }, values, { upsert: true, new: true }).exec();
}

export function createAdsenseAuthorizationUrl(userId) {
  if (!adsenseOAuthConfigured()) throw new Error('Google OAuth is not configured.');
  const state = jwt.sign({ sub: String(userId), purpose: 'adsense-readonly' }, process.env.JWT_SECRET, { expiresIn: '10m', issuer: 'callout' });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(), response_type: 'code', scope: ADSENSE_SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function verifyState(state, userId) {
  const payload = jwt.verify(String(state || ''), process.env.JWT_SECRET, { issuer: 'callout' });
  if (payload.purpose !== 'adsense-readonly' || String(payload.sub) !== String(userId)) throw new Error('Invalid AdSense authorization state.');
}

async function googleTokenRequest(values) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'Google token request failed.');
  return payload;
}

async function getAccessToken(refreshToken) {
  const payload = await googleTokenRequest({
    client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken, grant_type: 'refresh_token'
  });
  return payload.access_token;
}

async function googleApi(path, accessToken) {
  const response = await fetch(`https://adsense.googleapis.com/v2/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `AdSense API request failed (${response.status}).`);
  return payload;
}

async function firstAccount(accessToken) {
  const payload = await googleApi('accounts?pageSize=10', accessToken);
  const account = (payload.accounts || []).find(item => item.state === 'READY') || payload.accounts?.[0];
  if (!account?.name) throw new Error('No AdSense account is available for this Google account.');
  return account;
}

export async function completeAdsenseAuthorization({ code, state, userId }) {
  verifyState(state, userId);
  const tokens = await googleTokenRequest({
    client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
    code: String(code || ''), grant_type: 'authorization_code', redirect_uri: redirectUri()
  });
  if (!tokens.refresh_token) throw new Error('Google did not return an offline refresh token. Reconnect and grant access again.');
  const account = await firstAccount(tokens.access_token);
  await saveIntegration(tokens.refresh_token, userId, account.name);
  return account;
}

const dateParts = date => ({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
const numberValue = value => Number(value || 0);

export function parseAdsenseReport(report = {}) {
  const names = (report.headers || []).map(header => header.name);
  const rows = (report.rows || []).map(row => Object.fromEntries(names.map((name, index) => [name, row.cells?.[index]?.value || '0'])));
  const totals = Object.fromEntries(names.map((name, index) => [name, report.totals?.cells?.[index]?.value || '0']));
  return {
    summary: {
      estimatedEarnings: numberValue(totals.ESTIMATED_EARNINGS), impressions: numberValue(totals.IMPRESSIONS),
      clicks: numberValue(totals.CLICKS), pageViews: numberValue(totals.PAGE_VIEWS), impressionsRpm: numberValue(totals.IMPRESSIONS_RPM)
    },
    daily: rows.map(row => ({ date: row.DATE || '', estimatedEarnings: numberValue(row.ESTIMATED_EARNINGS), impressions: numberValue(row.IMPRESSIONS), clicks: numberValue(row.CLICKS) })),
    currencyCode: (report.headers || []).find(header => header.name === 'ESTIMATED_EARNINGS')?.currencyCode || 'EUR'
  };
}

export async function getAdsenseDashboard(days = 28) {
  const safeDays = [7, 28, 90].includes(Number(days)) ? Number(days) : 28;
  const base = { configured: adsenseOAuthConfigured(), connected: false, rangeDays: safeDays, publisherId: process.env.ADSENSE_CLIENT_ID || '', siteStatus: 'GETTING_READY' };
  if (!base.configured) return base;
  const integration = await getIntegration();
  if (!integration?.encryptedRefreshToken) return base;

  const accessToken = await getAccessToken(decrypt(integration));
  const account = integration.accountName ? { name: integration.accountName } : await firstAccount(accessToken);
  let siteStatus = base.siteStatus;
  try {
    const sites = await googleApi(`${account.name}/sites?pageSize=100`, accessToken);
    const host = new URL(origin()).hostname;
    const site = (sites.sites || []).find(item => item.domain === host);
    if (site?.state) siteStatus = site.state;
  } catch { /* reporting can still work while site status is delayed */ }

  const end = new Date();
  const start = new Date(end); start.setUTCDate(end.getUTCDate() - safeDays + 1);
  const query = new URLSearchParams({ dateRange: 'CUSTOM', reportingTimeZone: 'ACCOUNT_TIME_ZONE' });
  for (const [prefix, value] of [['startDate', dateParts(start)], ['endDate', dateParts(end)]]) for (const [key, part] of Object.entries(value)) query.set(`${prefix}.${key}`, String(part));
  query.append('dimensions', 'DATE');
  for (const metric of ['ESTIMATED_EARNINGS', 'IMPRESSIONS', 'CLICKS', 'PAGE_VIEWS', 'IMPRESSIONS_RPM']) query.append('metrics', metric);
  const report = await googleApi(`${account.name}/reports:generate?${query}`, accessToken);
  return { ...base, ...parseAdsenseReport(report), connected: true, siteStatus, generatedAt: new Date().toISOString() };
}
