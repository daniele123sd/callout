import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyticsDataConfigured, getAnalyticsDashboard } from '../server/analytics.mjs';

test('analytics dashboard fails closed when reporting credentials are absent', async () => {
  const previous = { property: process.env.GA_PROPERTY_ID, email: process.env.GA_CLIENT_EMAIL, key: process.env.GA_PRIVATE_KEY };
  delete process.env.GA_PROPERTY_ID; delete process.env.GA_CLIENT_EMAIL; delete process.env.GA_PRIVATE_KEY;
  assert.equal(analyticsDataConfigured(), false);
  assert.deepEqual(await getAnalyticsDashboard(28), { configured: false, rangeDays: 28 });
  if (previous.property) process.env.GA_PROPERTY_ID = previous.property;
  if (previous.email) process.env.GA_CLIENT_EMAIL = previous.email;
  if (previous.key) process.env.GA_PRIVATE_KEY = previous.key;
});

test('production template contains configurable ad units and GA4 metadata', async () => {
  const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(template, /name="ga-measurement-id" content="G-XXXXXXXXXX"/);
  assert.match(template, /ADSENSE_SIDEBAR_SLOT/);
  assert.match(template, /ADSENSE_RIGHT_RAIL_SLOT/);
  assert.match(template, /ADSENSE_FOOTER_SLOT/);
  assert.match(template, /id="analyticsNav"/);
});
