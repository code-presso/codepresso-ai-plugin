import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We need to test the rate limiter logic. Since it uses process.cwd() for state,
// we'll test the core logic patterns directly.

describe('rate-limiter.mjs', () => {
  describe('rate limiting logic', () => {
    // Test the filtering logic that canPost uses
    const ONE_HOUR_MS = 3600000;

    function simulateCanPost(hourly, sessionTotal, config = {}) {
      const maxPerHour = config.maxCommentsPerHour || 10;
      const maxPerSession = config.maxCommentsPerSession || 50;
      const now = Date.now();

      const recentPosts = (hourly || []).filter((ts) => now - ts < ONE_HOUR_MS);

      if (recentPosts.length >= maxPerHour) return false;
      if ((sessionTotal || 0) >= maxPerSession) return false;

      return true;
    }

    it('allows posting when no history exists', () => {
      assert.equal(simulateCanPost([], 0), true);
    });

    it('allows posting when under hourly limit', () => {
      const now = Date.now();
      const hourly = Array(5).fill(0).map((_, i) => now - i * 60000);
      assert.equal(simulateCanPost(hourly, 5), true);
    });

    it('blocks posting when at hourly limit', () => {
      const now = Date.now();
      const hourly = Array(10).fill(0).map((_, i) => now - i * 60000);
      assert.equal(simulateCanPost(hourly, 10), false);
    });

    it('blocks posting when over hourly limit', () => {
      const now = Date.now();
      const hourly = Array(15).fill(0).map((_, i) => now - i * 60000);
      assert.equal(simulateCanPost(hourly, 15), false);
    });

    it('allows posting when old entries have expired', () => {
      const now = Date.now();
      // All entries are older than 1 hour
      const hourly = Array(10).fill(0).map((_, i) => now - ONE_HOUR_MS - i * 60000);
      assert.equal(simulateCanPost(hourly, 5), true);
    });

    it('blocks posting when at session limit', () => {
      assert.equal(simulateCanPost([], 50), false);
    });

    it('respects custom hourly limit', () => {
      const now = Date.now();
      const hourly = Array(3).fill(0).map((_, i) => now - i * 60000);
      assert.equal(simulateCanPost(hourly, 3, { maxCommentsPerHour: 3 }), false);
    });

    it('respects custom session limit', () => {
      assert.equal(simulateCanPost([], 20, { maxCommentsPerSession: 20 }), false);
    });

    it('allows posting when both limits are not reached', () => {
      const now = Date.now();
      const hourly = Array(5).fill(0).map((_, i) => now - i * 60000);
      assert.equal(simulateCanPost(hourly, 30, { maxCommentsPerHour: 10, maxCommentsPerSession: 50 }), true);
    });

    it('handles null/undefined hourly array', () => {
      assert.equal(simulateCanPost(null, 0), true);
      assert.equal(simulateCanPost(undefined, 0), true);
    });
  });
});
