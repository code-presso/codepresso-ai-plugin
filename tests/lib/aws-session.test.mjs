import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandHome, isSessionValid, readCache, writeCache } from '../../scripts/lib/aws-session.mjs';

test('expandHome expands leading ~', () => {
  assert.ok(expandHome('~/x').endsWith('/x'));
  assert.ok(!expandHome('~/x').startsWith('~'));
  assert.strictEqual(expandHome('/abs/x'), '/abs/x');
});

test('isSessionValid honors expiry minus skew', () => {
  const exp = new Date(Date.now() + 120000).toISOString(); // +2 min
  assert.strictEqual(isSessionValid({ AccessKeyId: 'A', Expiration: exp }), true);
  const soon = new Date(Date.now() + 30000).toISOString();  // +30s, inside 60s skew
  assert.strictEqual(isSessionValid({ AccessKeyId: 'A', Expiration: soon }), false);
  assert.strictEqual(isSessionValid(null), false);
  assert.strictEqual(isSessionValid({ Expiration: 'nope' }), false);
});

test('writeCache writes atomically with 0600 and readCache roundtrips', () => {
  const dir = mkdtempSync(join(tmpdir(), 'awssess-'));
  const file = join(dir, 'aws-session.json');
  const cache = { AccessKeyId: 'A', SecretAccessKey: 'S', SessionToken: 'T', Expiration: '2030-01-01T00:00:00Z' };
  writeCache(file, cache);
  assert.deepStrictEqual(readCache(file), cache);
  assert.strictEqual(statSync(file).mode & 0o777, 0o600);
  assert.strictEqual(readCache(join(dir, 'missing.json')), null);
  rmSync(dir, { recursive: true, force: true });
});
