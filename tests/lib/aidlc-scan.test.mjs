import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ITEMS, scanItem, computeScore } from '../../scripts/lib/aidlc-scan.mjs';

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

it('ITEMS has exactly 16 entries with unique keys', { skip: 'completed in Task 4' }, () => {
  assert.equal(ITEMS.length, 16);
  assert.equal(new Set(ITEMS.map(i => i.key)).size, 16);
});
