import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupByPr } from '../../scripts/lib/pr-comment.mjs';

// --- Helpers ---

function entry(overrides = {}) {
  return {
    timestamp: new Date().toISOString(),
    prompt: 'test prompt',
    sessionId: 'sess-1',
    ...overrides,
  };
}

// --- Tests ---

describe('groupByPr()', () => {
  describe('empty input', () => {
    it('returns empty groups and pending for no entries', () => {
      const { groups, pending } = groupByPr([], {});
      assert.equal(groups.size, 0);
      assert.equal(pending.length, 0);
    });

    it('handles missing fallbackSession gracefully', () => {
      const { groups, pending } = groupByPr([entry({ branch: 'feat/x', prNumber: 1 })]);
      assert.equal(groups.size, 1);
      assert.ok(groups.has(1));
      assert.equal(pending.length, 0);
    });
  });

  describe('explicit prNumber on entries', () => {
    it('groups a single entry by its prNumber', () => {
      const e = entry({ branch: 'feat/a', prNumber: 42 });
      const { groups, pending } = groupByPr([e], {});
      assert.equal(groups.size, 1);
      assert.ok(groups.has(42));
      assert.equal(groups.get(42).length, 1);
      assert.equal(pending.length, 0);
    });

    it('groups entries across two different PRs', () => {
      const e1 = entry({ branch: 'feat/a', prNumber: 1 });
      const e2 = entry({ branch: 'feat/b', prNumber: 2 });
      const e3 = entry({ branch: 'feat/a', prNumber: 1 });
      const { groups, pending } = groupByPr([e1, e2, e3], {});
      assert.equal(groups.size, 2);
      assert.equal(groups.get(1).length, 2);
      assert.equal(groups.get(2).length, 1);
      assert.equal(pending.length, 0);
    });

    it('groups entries across three different PRs', () => {
      const entries = [
        entry({ branch: 'feat/a', prNumber: 10 }),
        entry({ branch: 'feat/b', prNumber: 20 }),
        entry({ branch: 'feat/c', prNumber: 30 }),
        entry({ branch: 'feat/a', prNumber: 10 }),
        entry({ branch: 'feat/b', prNumber: 20 }),
      ];
      const { groups, pending } = groupByPr(entries, {});
      assert.equal(groups.size, 3);
      assert.equal(groups.get(10).length, 2);
      assert.equal(groups.get(20).length, 2);
      assert.equal(groups.get(30).length, 1);
      assert.equal(pending.length, 0);
    });
  });

  describe('backfill: null prNumber with matching branch', () => {
    it('backfills prNumber from session when branch matches', () => {
      const e = entry({ branch: 'feat/a', prNumber: null });
      const { groups, pending } = groupByPr([e], { branch: 'feat/a', prNumber: 99 });
      assert.equal(groups.size, 1);
      assert.ok(groups.has(99));
      assert.equal(pending.length, 0);
    });

    it('does not backfill when branch does not match session', () => {
      const e = entry({ branch: 'feat/other', prNumber: null });
      const { groups, pending } = groupByPr([e], { branch: 'feat/a', prNumber: 99 });
      assert.equal(groups.size, 0);
      assert.equal(pending.length, 1);
    });

    it('does not backfill when session has no prNumber', () => {
      const e = entry({ branch: 'feat/a', prNumber: null });
      const { groups, pending } = groupByPr([e], { branch: 'feat/a', prNumber: null });
      assert.equal(groups.size, 0);
      assert.equal(pending.length, 1);
    });

    it('mixes explicit and backfilled entries into the same group', () => {
      const e1 = entry({ branch: 'feat/a', prNumber: 5 });
      const e2 = entry({ branch: 'feat/a', prNumber: null }); // backfilled → 5
      const { groups, pending } = groupByPr([e1, e2], { branch: 'feat/a', prNumber: 5 });
      assert.equal(groups.size, 1);
      assert.equal(groups.get(5).length, 2);
      assert.equal(pending.length, 0);
    });
  });

  describe('legacy entries (no branch/prNumber fields)', () => {
    it('assigns legacy entry to session prNumber', () => {
      const e = entry(); // no branch, no prNumber
      const { groups, pending } = groupByPr([e], { branch: 'feat/a', prNumber: 7 });
      assert.equal(groups.size, 1);
      assert.ok(groups.has(7));
      assert.equal(pending.length, 0);
    });

    it('puts legacy entry in pending when session has no prNumber', () => {
      const e = entry(); // no branch, no prNumber
      const { groups, pending } = groupByPr([e], { branch: 'feat/a', prNumber: null });
      assert.equal(groups.size, 0);
      assert.equal(pending.length, 1);
    });

    it('puts legacy entry in pending when no session at all', () => {
      const e = entry();
      const { groups, pending } = groupByPr([e], {});
      assert.equal(groups.size, 0);
      assert.equal(pending.length, 1);
    });
  });

  describe('closed PR filtering', () => {
    it('discards entries for closed PRs', () => {
      const e = entry({ branch: 'feat/a', prNumber: 3 });
      const { groups, pending } = groupByPr([e], { closedPrs: [3] });
      assert.equal(groups.size, 0);
      assert.equal(pending.length, 0);
    });

    it('keeps entries for open PRs when other PRs are closed', () => {
      const e1 = entry({ branch: 'feat/a', prNumber: 3 }); // closed
      const e2 = entry({ branch: 'feat/b', prNumber: 4 }); // open
      const { groups, pending } = groupByPr([e1, e2], { closedPrs: [3] });
      assert.equal(groups.size, 1);
      assert.ok(groups.has(4));
      assert.equal(pending.length, 0);
    });

    it('discards backfilled entries whose resolved prNumber is closed', () => {
      const e = entry({ branch: 'feat/a', prNumber: null }); // backfilled → 5
      const { groups, pending } = groupByPr([e], { branch: 'feat/a', prNumber: 5, closedPrs: [5] });
      assert.equal(groups.size, 0);
      assert.equal(pending.length, 0);
    });

    it('discards legacy entries whose session prNumber is closed', () => {
      const e = entry(); // legacy
      const { groups, pending } = groupByPr([e], { prNumber: 8, closedPrs: [8] });
      assert.equal(groups.size, 0);
      assert.equal(pending.length, 0);
    });

    it('handles empty closedPrs array normally', () => {
      const e = entry({ branch: 'feat/a', prNumber: 1 });
      const { groups } = groupByPr([e], { closedPrs: [] });
      assert.equal(groups.size, 1);
    });
  });

  describe('pending accumulation', () => {
    it('accumulates multiple unresolvable entries in pending', () => {
      const entries = [
        entry({ branch: 'feat/x', prNumber: null }),
        entry({ branch: 'feat/y', prNumber: null }),
        entry(), // legacy with no session PR
      ];
      const { groups, pending } = groupByPr(entries, {});
      assert.equal(groups.size, 0);
      assert.equal(pending.length, 3);
    });

    it('splits entries between groups and pending correctly', () => {
      const entries = [
        entry({ branch: 'feat/a', prNumber: 1 }),
        entry({ branch: 'feat/b', prNumber: null }), // branch mismatch → pending
        entry({ branch: 'feat/a', prNumber: null }), // backfilled → 1
      ];
      const { groups, pending } = groupByPr(entries, { branch: 'feat/a', prNumber: 1 });
      assert.equal(groups.size, 1);
      assert.equal(groups.get(1).length, 2);
      assert.equal(pending.length, 1);
    });
  });

  describe('edge cases', () => {
    it('handles prNumber: 0 as falsy (treated as no prNumber)', () => {
      // prNumber 0 is not a valid GitHub PR number; should go to pending
      const e = entry({ branch: 'feat/a', prNumber: 0 });
      const { groups, pending } = groupByPr([e], {});
      assert.equal(groups.size, 0);
      assert.equal(pending.length, 1);
    });

    it('preserves entry content in groups', () => {
      const e = entry({ branch: 'feat/a', prNumber: 11, prompt: 'hello world' });
      const { groups } = groupByPr([e], {});
      assert.equal(groups.get(11)[0].prompt, 'hello world');
    });

    it('preserves entry content in pending', () => {
      const e = entry({ prompt: 'unrouted entry' });
      const { pending } = groupByPr([e], {});
      assert.equal(pending[0].prompt, 'unrouted entry');
    });

    it('returns a Map for groups (not a plain object)', () => {
      const { groups } = groupByPr([], {});
      assert.ok(groups instanceof Map);
    });

    it('returns an Array for pending', () => {
      const { pending } = groupByPr([], {});
      assert.ok(Array.isArray(pending));
    });
  });
});
