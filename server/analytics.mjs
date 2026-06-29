import { BetaAnalyticsDataClient } from '@google-analytics/data';

const cache = new Map();
const cacheTtlMs = 5 * 60 * 1000;

function configuration() {
  return {
    propertyId: String(process.env.GA_PROPERTY_ID || '').trim(),
    clientEmail: String(process.env.GA_CLIENT_EMAIL || '').trim(),
    privateKey: String(process.env.GA_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim()
  };
}

export function analyticsDataConfigured() {
  const config = configuration();
  return /^\d+$/.test(config.propertyId) && config.clientEmail.includes('@') && config.privateKey.includes('PRIVATE KEY');
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function metricValues(row, names) {
  return Object.fromEntries(names.map((name, index) => [name, numberValue(row?.metricValues?.[index]?.value)]));
}

function dateLabel(value = '') {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;
}

export async function getAnalyticsDashboard(days = 28) {
  const safeDays = [7, 28, 90].includes(Number(days)) ? Number(days) : 28;
  if (!analyticsDataConfigured()) return { configured: false, rangeDays: safeDays };
  const cached = cache.get(safeDays);
  if (cached && Date.now() - cached.createdAt < cacheTtlMs) return cached.value;

  const { propertyId, clientEmail, privateKey } = configuration();
  const client = new BetaAnalyticsDataClient({ credentials: { client_email: clientEmail, private_key: privateKey } });
  const property = `properties/${propertyId}`;
  const dateRanges = [{ startDate: `${safeDays - 1}daysAgo`, endDate: 'today' }];
  const summaryNames = ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'engagementRate', 'averageSessionDuration', 'eventCount'];

  const [summaryResponse, dailyResponse, pagesResponse, channelsResponse, realtimeResponse] = await Promise.all([
    client.runReport({ property, dateRanges, metrics: summaryNames.map(name => ({ name })) }),
    client.runReport({ property, dateRanges, dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }], orderBys: [{ dimension: { dimensionName: 'date' } }] }),
    client.runReport({ property, dateRanges, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 8 }),
    client.runReport({ property, dateRanges, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 }),
    client.runRealtimeReport({ property, metrics: [{ name: 'activeUsers' }] })
  ]);

  const summary = metricValues(summaryResponse[0]?.rows?.[0], summaryNames);
  const value = {
    configured: true,
    rangeDays: safeDays,
    generatedAt: new Date().toISOString(),
    realtime: { activeUsers: numberValue(realtimeResponse[0]?.rows?.[0]?.metricValues?.[0]?.value) },
    summary,
    daily: (dailyResponse[0]?.rows || []).map(row => ({ date: dateLabel(row.dimensionValues?.[0]?.value), ...metricValues(row, ['activeUsers', 'sessions', 'screenPageViews']) })),
    pages: (pagesResponse[0]?.rows || []).map(row => ({ path: row.dimensionValues?.[0]?.value || '/', ...metricValues(row, ['screenPageViews', 'activeUsers']) })),
    channels: (channelsResponse[0]?.rows || []).map(row => ({ channel: row.dimensionValues?.[0]?.value || 'Unassigned', ...metricValues(row, ['sessions', 'activeUsers']) }))
  };
  cache.set(safeDays, { createdAt: Date.now(), value });
  return value;
}
