import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWikiStatus, formatWikiNotice } from '../../scripts/lib/wiki-state.mjs';

// ---------------------------------------------------------------------------
// formatWikiNotice
// ---------------------------------------------------------------------------
describe('formatWikiNotice', () => {
  it('returns null for null input', () => {
    assert.equal(formatWikiNotice(null), null);
  });

  it('returns null for undefined input', () => {
    assert.equal(formatWikiNotice(undefined), null);
  });

  it('returns null when behind is 0', () => {
    assert.equal(formatWikiNotice({ behind: 0, upstream: 'origin/main', vaultPath: '/tmp/wiki', error: null }), null);
  });

  it('returns null when behind is negative', () => {
    assert.equal(formatWikiNotice({ behind: -1, upstream: 'origin/main', vaultPath: '/tmp/wiki', error: null }), null);
  });

  it('returns null when behind is a non-integer number', () => {
    assert.equal(formatWikiNotice({ behind: 1.5, upstream: 'origin/main', vaultPath: '/tmp/wiki', error: null }), null);
  });

  it('returns null when behind is a non-numeric string', () => {
    assert.equal(formatWikiNotice({ behind: 'x', upstream: 'origin/main', vaultPath: '/tmp/wiki', error: null }), null);
  });

  it('returns null when error is set (even if behind > 0)', () => {
    assert.equal(formatWikiNotice({ behind: 3, error: 'fetch-failed', upstream: 'origin/main', vaultPath: '/tmp/wiki' }), null);
  });

  it('returns a string for behind > 0 with no error', () => {
    const notice = formatWikiNotice({ behind: 2, upstream: 'origin/main', vaultPath: '/home/u/wiki', error: null });
    assert.ok(typeof notice === 'string', 'should be a string');
  });

  it('includes the behind count in the notice', () => {
    const notice = formatWikiNotice({ behind: 2, upstream: 'origin/main', vaultPath: '/home/u/wiki', error: null });
    assert.ok(notice.includes('2'), 'should mention the behind count');
  });

  it('includes the upstream in the notice', () => {
    const notice = formatWikiNotice({ behind: 2, upstream: 'origin/main', vaultPath: '/home/u/wiki', error: null });
    assert.ok(notice.includes('origin/main'), 'should mention the upstream');
  });

  it('includes the vaultPath in the notice', () => {
    const notice = formatWikiNotice({ behind: 2, upstream: 'origin/main', vaultPath: '/home/u/wiki', error: null });
    assert.ok(notice.includes('/home/u/wiki'), 'should mention the vault path');
  });

  it('instructs pull --ff-only', () => {
    const notice = formatWikiNotice({ behind: 2, upstream: 'origin/main', vaultPath: '/home/u/wiki', error: null });
    assert.ok(notice.includes('pull --ff-only'), 'should instruct pull --ff-only');
  });

  it('does NOT instruct auto-merge (instructs user to decide manually)', () => {
    const notice = formatWikiNotice({ behind: 2, upstream: 'origin/main', vaultPath: '/home/u/wiki', error: null });
    // The notice must say NOT to auto-merge (자동 병합하지 말고) and hand off to the user
    assert.ok(notice.includes('자동 병합하지 말'), 'should warn against auto-merging');
    assert.ok(notice.includes('수동'), 'should instruct manual handling');
  });

  it('uses "upstream" as fallback when upstream field is missing', () => {
    const notice = formatWikiNotice({ behind: 1, vaultPath: '/tmp/w', error: null });
    assert.ok(notice.includes('upstream'), 'should fall back to "upstream" label');
  });
});

// ---------------------------------------------------------------------------
// readWikiStatus
// ---------------------------------------------------------------------------
describe('readWikiStatus', () => {
  it('returns null for a non-existent path', () => {
    const result = readWikiStatus('/nonexistent/path/wiki-status.json');
    assert.equal(result, null);
  });

  it('returns null for a corrupt JSON file', () => {
    let tmp;
    try {
      tmp = mkdtempSync(join(tmpdir(), 'cp-wiki-'));
      const badPath = join(tmp, 'wiki-status.json');
      writeFileSync(badPath, 'not json!!!', 'utf-8');
      const result = readWikiStatus(badPath);
      assert.equal(result, null);
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });
});
