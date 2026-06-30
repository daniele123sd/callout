import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdsenseReport } from '../server/adsense.mjs';

test('AdSense report parser returns currency and monetisation totals', () => {
  const report = {
    headers: [
      { name: 'DATE' }, { name: 'ESTIMATED_EARNINGS', currencyCode: 'EUR' },
      { name: 'IMPRESSIONS' }, { name: 'CLICKS' }, { name: 'PAGE_VIEWS' }, { name: 'IMPRESSIONS_RPM' }
    ],
    rows: [{ cells: [{ value: '2026-06-30' }, { value: '1.25' }, { value: '100' }, { value: '2' }, { value: '80' }, { value: '12.5' }] }],
    totals: { cells: [{ value: '' }, { value: '1.25' }, { value: '100' }, { value: '2' }, { value: '80' }, { value: '12.5' }] }
  };
  const parsed = parseAdsenseReport(report);
  assert.equal(parsed.currencyCode, 'EUR');
  assert.equal(parsed.summary.estimatedEarnings, 1.25);
  assert.equal(parsed.summary.impressions, 100);
  assert.equal(parsed.daily[0].date, '2026-06-30');
});
