import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('post export creates separate quote and horizontal vote images', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const exporter = app.slice(app.indexOf('async function openPostDownload'), app.indexOf('function openEditPost'));
  assert.match(exporter, /selectExportFormat/);
  assert.match(exporter, /authorAvatarUrl/);
  assert.doesNotMatch(exporter, /badgeX|#2296f3/);
  assert.match(exporter, /drawQuoteExport/);
  assert.match(exporter, /drawVoteExport/);
  assert.match(exporter, /-quote\.png/);
  assert.match(exporter, /-votes\.png/);
  assert.match(exporter, /'#55df50', 'BASED', 'based'/);
  assert.match(exporter, /barWidth \* based \/ 100/);
  assert.doesNotMatch(exporter, /emojiReactions|postReactions/);
});
