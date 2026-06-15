import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'aws-cred-process.mjs');

function run(file) {
  return execFileSync('node', [SCRIPT], { env: { ...process.env, AWS_CRED_PROCESS_SESSION_FILE: file }, encoding: 'utf-8' });
}

test('valid cache → emits Version:1 JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cp-'));
  const file = join(dir, 's.json');
  writeFileSync(file, JSON.stringify({ AccessKeyId: 'ASIA', SecretAccessKey: 'sk', SessionToken: 'tok', Expiration: new Date(Date.now() + 600000).toISOString() }));
  const out = JSON.parse(run(file));
  assert.strictEqual(out.Version, 1);
  assert.strictEqual(out.AccessKeyId, 'ASIA');
  rmSync(dir, { recursive: true, force: true });
});

test('missing/expired cache → non-zero exit, no secret on stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cp-'));
  const file = join(dir, 'missing.json');
  let threw = false;
  try { run(file); } catch (e) {
    threw = true;
    assert.ok(!String(e.stdout || '').includes('SecretAccessKey'));
  }
  assert.ok(threw);
  rmSync(dir, { recursive: true, force: true });
});
