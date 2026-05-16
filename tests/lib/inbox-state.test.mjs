import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSeen, saveSeen, markSeen } from '../../scripts/lib/inbox-state.mjs';

describe('inbox-state seen-IDs', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'cp-inbox-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('returns empty defaults when seen file is missing', () => {
    const seen = loadSeen(tmp);
    assert.deepEqual(seen.gmail, []);
    assert.deepEqual(seen.chat, []);
    assert.equal(seen.lastScannedAt, null);
  });

  it('roundtrips through saveSeen/loadSeen', () => {
    saveSeen(tmp, {
      gmail: [{ id: 'm1', at: new Date().toISOString() }],
      chat: [{ id: 'c1', at: new Date().toISOString() }],
      lastScannedAt: '2026-05-16T09:00:00+09:00',
    });
    const seen = loadSeen(tmp);
    assert.equal(seen.gmail.length, 1);
    assert.equal(seen.gmail[0].id, 'm1');
    assert.equal(seen.lastScannedAt, '2026-05-16T09:00:00+09:00');
  });

  it('markSeen appends new IDs and is idempotent', () => {
    markSeen(tmp, 'gmail', ['m1', 'm2']);
    markSeen(tmp, 'gmail', ['m2', 'm3']);
    const seen = loadSeen(tmp);
    const ids = seen.gmail.map((e) => e.id).sort();
    assert.deepEqual(ids, ['m1', 'm2', 'm3']);
  });

  it('prunes entries older than 30 days on save', () => {
    const oldIso = new Date(Date.now() - 31 * 86400 * 1000).toISOString();
    const newIso = new Date().toISOString();
    saveSeen(tmp, {
      gmail: [{ id: 'old', at: oldIso }, { id: 'new', at: newIso }],
      chat: [],
      lastScannedAt: newIso,
    });
    const seen = loadSeen(tmp);
    const ids = seen.gmail.map((e) => e.id);
    assert.deepEqual(ids, ['new']);
  });

  it('does not leave a temp file behind after successful save', () => {
    saveSeen(tmp, { gmail: [], chat: [], lastScannedAt: null });
    const stateDir = join(tmp, '.codepresso', 'state');
    const files = readdirSync(stateDir);
    const tmps = files.filter((f) => f.includes('.tmp.'));
    assert.equal(tmps.length, 0);
  });

  it('keeps entries at exactly 30 days', () => {
    // Subtract a tiny offset to compensate for the fact that
    // by the time saveSeen runs, Date.now() has advanced past the cutoff
    const boundaryIso = new Date(Date.now() - 30 * 86400 * 1000 + 60_000).toISOString();
    saveSeen(tmp, { gmail: [{ id: 'boundary', at: boundaryIso }], chat: [], lastScannedAt: null });
    const seen = loadSeen(tmp);
    assert.equal(seen.gmail.length, 1);
  });

  it('keeps entries at 29 days', () => {
    const recentIso = new Date(Date.now() - 29 * 86400 * 1000).toISOString();
    saveSeen(tmp, { gmail: [{ id: 'recent', at: recentIso }], chat: [], lastScannedAt: null });
    const seen = loadSeen(tmp);
    assert.equal(seen.gmail.length, 1);
  });

  it('markSeen throws on unknown source', () => {
    assert.throws(
      () => markSeen(tmp, 'slack', ['s1']),
      /unknown source/,
    );
  });
});
