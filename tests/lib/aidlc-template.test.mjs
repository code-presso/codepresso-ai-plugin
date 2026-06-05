import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { substitute, writeIfAbsent, planFiles } from '../../scripts/lib/aidlc-template.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'aidlc-tpl-')); }

describe('substitute', () => {
  it('replaces known vars, leaves unknown', () => {
    assert.equal(substitute('a {{NAME}} {{MISSING}}', { NAME: 'x' }), 'a x {{MISSING}}');
  });
});

describe('writeIfAbsent', () => {
  it('creates when absent', () => {
    const d = tmp(); const p = join(d, 'AGENTS.md');
    assert.deepEqual(writeIfAbsent(p, 'hello'), { written: true, reason: 'created' });
    assert.equal(readFileSync(p, 'utf8'), 'hello');
    rmSync(d, { recursive: true, force: true });
  });
  it('does NOT overwrite when present', () => {
    const d = tmp(); const p = join(d, 'AGENTS.md');
    writeFileSync(p, 'original');
    assert.deepEqual(writeIfAbsent(p, 'new'), { written: false, reason: 'exists' });
    assert.equal(readFileSync(p, 'utf8'), 'original');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('planFiles', () => {
  it('lists only missing items, excludes present/na', () => {
    const scanResult = { results: [
      { key: 'agents-md', kind: 'authored', status: 'missing' },
      { key: 'adr', kind: 'static', status: 'present' },
      { key: 'submodule-claude', kind: 'authored', status: 'na' },
      { key: 'doc-policy', kind: 'static', status: 'missing' },
    ] };
    const got = planFiles(scanResult, { structure: 'single' });
    assert.deepEqual(got.map(f => f.key).sort(), ['agents-md', 'doc-policy']);
    assert.equal(got.find(f => f.key === 'doc-policy').kind, 'static');
  });

  it('local-dev is opt-in: excluded by default, included when profile scaffolds', () => {
    const sr = { results: [{ key: 'local-dev', kind: 'static', status: 'missing' }] };
    assert.equal(planFiles(sr, {}).length, 0);
    const got = planFiles(sr, {}, { localDev: 'scaffold' });
    assert.deepEqual(got.map(f => f.path), ['scripts/local-up.sh']);
  });

  it('ci-pr path follows profile host', () => {
    const sr = { results: [{ key: 'ci-pr', kind: 'static', status: 'missing' }] };
    assert.equal(planFiles(sr, { host: 'github' }).find(f => f.key === 'ci-pr').path, '.github/workflows/ci.yml');
    assert.equal(planFiles(sr, {}, { ciHost: 'gitlab' }).find(f => f.key === 'ci-pr').path, '.gitlab-ci.yml');
  });
});
