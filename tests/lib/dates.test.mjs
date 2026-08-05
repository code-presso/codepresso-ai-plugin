import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateStr } from '../../scripts/lib/dates.mjs';

test('localDateStr formats in local time, not UTC', () => {
  // Local midnight: UTC date differs for any timezone east of UTC (e.g. KST).
  const d = new Date(2026, 7, 6, 0, 30); // 2026-08-06 00:30 local
  assert.equal(localDateStr(d), '2026-08-06');
});

test('localDateStr pads month and day', () => {
  assert.equal(localDateStr(new Date(2026, 0, 5)), '2026-01-05');
});
