import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeScoreTiers, aggregateSessions, computeTrends } from '../../scripts/lib/analytics.mjs';

describe('analytics.mjs', () => {
  describe('computeScoreTiers', () => {
    it('returns all zeros for empty array', () => {
      const result = computeScoreTiers([]);
      assert.deepStrictEqual(result, { excellent: 0, good: 0, warning: 0, poor: 0 });
    });

    it('returns all zeros for all-null scores', () => {
      const result = computeScoreTiers([null, null, null]);
      assert.deepStrictEqual(result, { excellent: 0, good: 0, warning: 0, poor: 0 });
    });

    it('categorizes boundary values correctly', () => {
      // 8 = excellent, 5 = good, 3 = warning, 2 = poor
      const result = computeScoreTiers([8, 5, 3, 2]);
      assert.strictEqual(result.excellent, 1);
      assert.strictEqual(result.good, 1);
      assert.strictEqual(result.warning, 1);
      assert.strictEqual(result.poor, 1);
    });

    it('handles high scores as excellent', () => {
      const result = computeScoreTiers([8, 9, 10]);
      assert.deepStrictEqual(result, { excellent: 3, good: 0, warning: 0, poor: 0 });
    });

    it('handles mixed scores with nulls', () => {
      const result = computeScoreTiers([9, null, 6, null, 1, 4]);
      assert.strictEqual(result.excellent, 1); // 9
      assert.strictEqual(result.good, 1);      // 6
      assert.strictEqual(result.warning, 1);   // 4
      assert.strictEqual(result.poor, 1);      // 1
    });
  });

  describe('aggregateSessions', () => {
    it('returns empty array for empty input', () => {
      assert.deepStrictEqual(aggregateSessions([]), []);
    });

    it('returns empty array when records have no sessionId', () => {
      const records = [{ recordType: 'flush', timestamp: '2025-01-01T00:00:00Z' }];
      assert.deepStrictEqual(aggregateSessions(records), []);
    });

    it('groups multiple flush records into one session', () => {
      const records = [
        { recordType: 'flush', sessionId: 's1', branch: 'main', timestamp: '2025-01-01T00:00:00Z', promptCount: 5, scores: [7, 8] },
        { recordType: 'flush', sessionId: 's1', branch: 'main', timestamp: '2025-01-01T01:00:00Z', promptCount: 3, scores: [6, null, 9] },
      ];
      const result = aggregateSessions(records);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].sessionId, 's1');
      assert.strictEqual(result[0].promptCount, 8);
      assert.strictEqual(result[0].avgScore, 7.5); // (7+8+6+9)/4 = 7.5
    });

    it('counts git commits and pushes', () => {
      const records = [
        { recordType: 'flush', sessionId: 's1', timestamp: '2025-01-01T00:00:00Z', promptCount: 1, scores: [] },
        { recordType: 'git_commit', sessionId: 's1', timestamp: '2025-01-01T00:01:00Z', commitHash: 'abc' },
        { recordType: 'git_commit', sessionId: 's1', timestamp: '2025-01-01T00:02:00Z', commitHash: 'def' },
        { recordType: 'git_push', sessionId: 's1', timestamp: '2025-01-01T00:03:00Z' },
      ];
      const result = aggregateSessions(records);
      assert.strictEqual(result[0].commits, 2);
      assert.strictEqual(result[0].pushes, 1);
    });

    it('merges session_end data', () => {
      const records = [
        { recordType: 'flush', sessionId: 's1', timestamp: '2025-01-01T00:00:00Z', promptCount: 1, scores: [] },
        { recordType: 'session_end', sessionId: 's1', timestamp: '2025-01-01T01:00:00Z', startedAt: '2025-01-01T00:00:00Z', endedAt: '2025-01-01T01:00:00Z', durationMinutes: 60 },
      ];
      const result = aggregateSessions(records);
      assert.strictEqual(result[0].durationMinutes, 60);
      assert.strictEqual(result[0].startedAt, '2025-01-01T00:00:00Z');
      assert.strictEqual(result[0].endedAt, '2025-01-01T01:00:00Z');
    });

    it('handles multiple sessions sorted by firstSeen', () => {
      const records = [
        { recordType: 'flush', sessionId: 's2', timestamp: '2025-01-02T00:00:00Z', promptCount: 1, scores: [] },
        { recordType: 'flush', sessionId: 's1', timestamp: '2025-01-01T00:00:00Z', promptCount: 1, scores: [] },
      ];
      const result = aggregateSessions(records);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].sessionId, 's1');
      assert.strictEqual(result[1].sessionId, 's2');
    });

    it('sets avgScore to null when no scores exist', () => {
      const records = [
        { recordType: 'flush', sessionId: 's1', timestamp: '2025-01-01T00:00:00Z', promptCount: 3, scores: [null, null] },
      ];
      const result = aggregateSessions(records);
      assert.strictEqual(result[0].avgScore, null);
    });

    it('preserves branch and prNumber from records', () => {
      const records = [
        { recordType: 'flush', sessionId: 's1', branch: 'feat/auth', prNumber: 42, timestamp: '2025-01-01T00:00:00Z', promptCount: 1, scores: [] },
      ];
      const result = aggregateSessions(records);
      assert.strictEqual(result[0].branch, 'feat/auth');
      assert.strictEqual(result[0].prNumber, 42);
    });
  });

  describe('computeTrends', () => {
    it('returns zero summaries for empty sessions', () => {
      const result = computeTrends([]);
      assert.strictEqual(result.current.sessions, 0);
      assert.strictEqual(result.current.prompts, 0);
      assert.strictEqual(result.previous.sessions, 0);
    });

    it('partitions sessions into current and previous periods', () => {
      const now = new Date();
      const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

      const sessions = [
        { sessionId: 's1', firstSeen: daysAgo(1), promptCount: 10, commits: 2, pushes: 1, avgScore: 7.0, durationMinutes: 30 },
        { sessionId: 's2', firstSeen: daysAgo(3), promptCount: 5, commits: 1, pushes: 0, avgScore: 8.0, durationMinutes: 20 },
        { sessionId: 's3', firstSeen: daysAgo(10), promptCount: 8, commits: 3, pushes: 1, avgScore: 6.0, durationMinutes: 45 },
      ];

      const result = computeTrends(sessions, 7);
      assert.strictEqual(result.current.sessions, 2);  // s1, s2
      assert.strictEqual(result.previous.sessions, 1); // s3
      assert.strictEqual(result.current.prompts, 15);
      assert.strictEqual(result.previous.prompts, 8);
    });

    it('computes deltas as percentages', () => {
      const now = new Date();
      const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

      const sessions = [
        { sessionId: 's1', firstSeen: daysAgo(1), promptCount: 10, commits: 2, pushes: 0, avgScore: 8.0, durationMinutes: 30 },
        { sessionId: 's2', firstSeen: daysAgo(10), promptCount: 5, commits: 1, pushes: 0, avgScore: 4.0, durationMinutes: 20 },
      ];

      const result = computeTrends(sessions, 7);
      assert.strictEqual(result.deltas.prompts, '+100%');
      assert.strictEqual(result.deltas.commits, '+100%');
    });

    it('handles custom period length', () => {
      const now = new Date();
      const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

      const sessions = [
        { sessionId: 's1', firstSeen: daysAgo(1), promptCount: 5, commits: 1, pushes: 0, avgScore: 7.0, durationMinutes: 10 },
        { sessionId: 's2', firstSeen: daysAgo(20), promptCount: 5, commits: 1, pushes: 0, avgScore: 7.0, durationMinutes: 10 },
      ];

      // 14-day period: s1 in current, s2 in previous
      const result = computeTrends(sessions, 14);
      assert.strictEqual(result.current.sessions, 1);
      assert.strictEqual(result.previous.sessions, 1);
    });

    it('returns dash for zero-base deltas', () => {
      const result = computeTrends([]);
      assert.strictEqual(result.deltas.sessions, '—');
      assert.strictEqual(result.deltas.prompts, '—');
    });
  });
});
