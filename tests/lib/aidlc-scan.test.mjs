import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ITEMS, scanItem, computeScore } from '../../scripts/lib/aidlc-scan.mjs';
import { scanSecrets, scan } from '../../scripts/lib/aidlc-scan.mjs';

function tmpRepo() { return mkdtempSync(join(tmpdir(), 'aidlc-scan-')); }
const ctx = { structure: 'single', submodules: [], stacks: [{ path: '.', stack: 'node' }], host: 'github', tickets: { hasTickets: false } };
const itemByKey = (k) => ITEMS.find(i => i.key === k);

describe('computeScore', () => {
  it('present=1 partial=0.5 missing=0, na excluded', () => {
    const r = computeScore([
      { status: 'present' }, { status: 'present' }, { status: 'partial' }, { status: 'missing' }, { status: 'na' },
    ]);
    assert.deepEqual(r, { present: 2, partial: 1, missing: 1, na: 1, percent: 63 });
  });
});

describe('detector: agents-md (#1)', () => {
  it('present when AGENTS.md exists', () => {
    const d = tmpRepo(); writeFileSync(join(d, 'AGENTS.md'), '# x');
    assert.equal(scanItem(d, ctx, itemByKey('agents-md')).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('missing when absent', () => {
    const d = tmpRepo();
    assert.equal(scanItem(d, ctx, itemByKey('agents-md')).status, 'missing');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detector: adr (#4)', () => {
  it('present with dir + TEMPLATE + >=1 ADR', () => {
    const d = tmpRepo(); mkdirSync(join(d, 'docs/decisions'), { recursive: true });
    writeFileSync(join(d, 'docs/decisions/TEMPLATE.md'), '');
    writeFileSync(join(d, 'docs/decisions/ADR-0001-x.md'), '');
    assert.equal(scanItem(d, ctx, itemByKey('adr')).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('partial with dir only', () => {
    const d = tmpRepo(); mkdirSync(join(d, 'docs/decisions'), { recursive: true });
    assert.equal(scanItem(d, ctx, itemByKey('adr')).status, 'partial');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detector: submodule-claude (#3)', () => {
  it('na for single repo', () => {
    const d = tmpRepo();
    assert.equal(scanItem(d, ctx, itemByKey('submodule-claude')).status, 'na');
    rmSync(d, { recursive: true, force: true });
  });
});

it('ITEMS has exactly 16 entries with unique keys', () => {
  assert.equal(ITEMS.length, 16);
  assert.equal(new Set(ITEMS.map(i => i.key)).size, 16);
});

describe('detector: ci-pr (#11)', () => {
  it('present when a workflow has pull_request trigger', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.github/workflows'), { recursive: true });
    writeFileSync(join(d, '.github/workflows/ci.yml'), 'on:\n  pull_request:\njobs:\n  t:\n    steps: []\n');
    assert.equal(scanItem(d, ctx, ITEMS.find(i=>i.key==='ci-pr')).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('missing when no workflow', () => {
    const d = tmpRepo();
    assert.equal(scanItem(d, ctx, ITEMS.find(i=>i.key==='ci-pr')).status, 'missing');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detector: permission-matrix (#10)', () => {
  it('present for committed settings.json', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.claude'), { recursive: true });
    writeFileSync(join(d, '.claude/settings.json'), '{"permissions":{}}');
    assert.equal(scanItem(d, ctx, ITEMS.find(i=>i.key==='permission-matrix')).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('partial for local-only', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.claude'), { recursive: true });
    writeFileSync(join(d, '.claude/settings.local.json'), '{"permissions":{}}');
    assert.equal(scanItem(d, ctx, ITEMS.find(i=>i.key==='permission-matrix')).status, 'partial');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('scanSecrets', () => {
  it('flags a notion token, masked', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.claude'), { recursive: true });
    writeFileSync(join(d, '.claude/settings.local.json'), 'Bearer ntn_ABCDEFGHIJ1234567890');
    const s = scanSecrets(d);
    assert.equal(s.length, 1);
    assert.equal(s[0].kind, 'notion-token');
    assert.ok(!s[0].masked.includes('ABCDEFGHIJ1234567890'));
    rmSync(d, { recursive: true, force: true });
  });
  it('returns [] when clean', () => {
    const d = tmpRepo();
    assert.deepEqual(scanSecrets(d), []);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('scan (composite)', () => {
  it('empty repo → all 16 missing-or-na, percent low', () => {
    const d = tmpRepo();
    const r = scan(d, ctx);
    assert.equal(r.results.length, 16);
    assert.ok(r.score.percent <= 10);
    rmSync(d, { recursive: true, force: true });
  });
});
