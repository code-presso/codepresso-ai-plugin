import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', '..', 'scripts', 'inbox-cli.mjs');

function run(args, { cwd, input } = {}) {
  return execFileSync('node', [CLI, ...args], {
    cwd, encoding: 'utf-8',
    input: input ?? undefined,
    stdio: input != null ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  });
}

describe('inbox-cli', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'cp-cli-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('prep emits seen + leftovers JSON', () => {
    const out = JSON.parse(run(['prep'], { cwd: tmp }));
    assert.deepEqual(out.seen.gmail, []);
    assert.deepEqual(out.seen.chat, []);
    assert.deepEqual(out.leftovers, []);
  });

  it('redact strips Anthropic keys from stdin', () => {
    const out = run(['redact'], { cwd: tmp, input: 'token sk-ant-api03-abcdefghijklmnopqrstuv0123' });
    assert.ok(!out.includes('sk-ant-'));
    assert.ok(out.includes('[REDACTED_API_KEY]'));
  });

  it('stage appends candidates and marks seen', () => {
    const payload = JSON.stringify({
      candidates: [{ id: 'g1', source: 'gmail', summary: 'A' }],
      sourceIds: { gmail: ['g1'], chat: [] },
    });
    run(['stage'], { cwd: tmp, input: payload });
    const out = JSON.parse(run(['prep'], { cwd: tmp }));
    assert.equal(out.leftovers.length, 1);
    assert.equal(out.leftovers[0].id, 'g1');
    assert.equal(out.seen.gmail.length, 1);
  });

  it('complete removes accepted + rejected candidates', () => {
    run(['stage'], { cwd: tmp, input: JSON.stringify({
      candidates: [{ id: 'g1', source: 'gmail' }, { id: 'g2', source: 'gmail' }],
      sourceIds: { gmail: ['g1', 'g2'], chat: [] },
    })});
    run(['complete'], { cwd: tmp, input: JSON.stringify({ accepted: ['g1'], rejected: ['g2'] }) });
    const out = JSON.parse(run(['prep'], { cwd: tmp }));
    assert.equal(out.leftovers.length, 0);
  });
});
