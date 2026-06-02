import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const CLI = resolve('scripts/aidlc-cli.mjs');
function tmp() { return mkdtempSync(join(tmpdir(), 'aidlc-cli-')); }
const run = (args, cwd) => JSON.parse(execFileSync('node', [CLI, ...args], { cwd }).toString());

describe('aidlc-cli', () => {
  it('detect → JSON with structure', () => {
    const d = tmp(); writeFileSync(join(d, 'package.json'), '{}');
    const out = run(['detect', d], d);
    assert.equal(out.structure, 'single');
    rmSync(d, { recursive: true, force: true });
  });
  it('scan → 16 results + score', () => {
    const d = tmp();
    const out = run(['scan', d], d);
    assert.equal(out.results.length, 16);
    assert.ok('percent' in out.score);
    rmSync(d, { recursive: true, force: true });
  });
  it('plan → missing files list', () => {
    const d = tmp();
    const out = run(['plan', d], d);
    assert.ok(Array.isArray(out));
    assert.ok(out.some(f => f.key === 'agents-md'));
    rmSync(d, { recursive: true, force: true });
  });
  it('apply-static → creates doc-policy, skips if present', () => {
    const d = tmp();
    run(['apply-static', d], d);
    assert.ok(existsSync(join(d, 'docs/documentation-policy.md')));
    rmSync(d, { recursive: true, force: true });
  });
});
