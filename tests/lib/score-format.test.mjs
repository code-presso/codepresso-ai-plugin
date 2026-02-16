import { describe, it } from 'node:test';
import assert from 'node:assert';

// Recreate the scoreEmoji logic from score-and-post.mjs for testing
function scoreEmoji(score) {
  if (score >= 8) return '⭐';
  if (score >= 5) return '✅';
  if (score >= 3) return '⚠️';
  return '❌';
}

describe('score-format.mjs', () => {
  describe('scoreEmoji', () => {
    it('returns star emoji for score >= 8', () => {
      assert.strictEqual(scoreEmoji(8), '⭐');
      assert.strictEqual(scoreEmoji(9), '⭐');
      assert.strictEqual(scoreEmoji(10), '⭐');
    });

    it('returns check emoji for score 5-7', () => {
      assert.strictEqual(scoreEmoji(5), '✅');
      assert.strictEqual(scoreEmoji(6), '✅');
      assert.strictEqual(scoreEmoji(7), '✅');
    });

    it('returns warning emoji for score 3-4', () => {
      assert.strictEqual(scoreEmoji(3), '⚠️');
      assert.strictEqual(scoreEmoji(4), '⚠️');
    });

    it('returns X emoji for score < 3', () => {
      assert.strictEqual(scoreEmoji(0), '❌');
      assert.strictEqual(scoreEmoji(1), '❌');
      assert.strictEqual(scoreEmoji(2), '❌');
    });

    it('handles edge cases at boundaries', () => {
      assert.strictEqual(scoreEmoji(7.9), '✅');
      assert.strictEqual(scoreEmoji(8.0), '⭐');
      assert.strictEqual(scoreEmoji(4.9), '⚠️');
      assert.strictEqual(scoreEmoji(5.0), '✅');
      assert.strictEqual(scoreEmoji(2.9), '❌');
      assert.strictEqual(scoreEmoji(3.0), '⚠️');
    });

    it('handles negative scores', () => {
      assert.strictEqual(scoreEmoji(-1), '❌');
      assert.strictEqual(scoreEmoji(-10), '❌');
    });

    it('handles scores above maximum', () => {
      assert.strictEqual(scoreEmoji(11), '⭐');
      assert.strictEqual(scoreEmoji(100), '⭐');
    });
  });
});
