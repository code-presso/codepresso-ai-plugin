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

  it('rejects unknown subcommand with exit 2', () => {
    let exitCode = 0;
    try {
      execFileSync('node', [CLI, 'bogus-cmd'], { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      exitCode = err.status;
    }
    assert.equal(exitCode, 2);
  });

  it('rejects malformed JSON on stage with exit 2', () => {
    let exitCode = 0;
    try {
      execFileSync('node', [CLI, 'stage'], { cwd: tmp, encoding: 'utf-8', input: 'not json{', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      exitCode = err.status;
    }
    assert.equal(exitCode, 2);
  });

  it('schema-cache get/set round-trip', () => {
    const payload = JSON.stringify({ taskDb: { id: 'd1', titleProp: 'Name', statusProp: 'Status', assigneeProp: 'A', dueDateProp: 'D' } });
    run(['schema-cache', 'set'], { cwd: tmp, input: payload });
    const got = JSON.parse(run(['schema-cache', 'get'], { cwd: tmp }));
    assert.equal(got.taskDb.titleProp, 'Name');
    assert.ok(got.taskDb.fetchedAt); // stamped by saveSchemaCache
  });
});
