import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTrivial } from '../../scripts/lib/trivial-filter.mjs';

describe('trivial-filter.mjs', () => {
  describe('isTrivial', () => {
    // --- Short prompts ---
    it('returns true for prompts shorter than default minPromptLength', () => {
      assert.equal(isTrivial('fix bug'), true);
      assert.equal(isTrivial('do it'), true);
    });

    it('returns true for empty string', () => {
      assert.equal(isTrivial(''), true);
    });

    it('returns true for whitespace-only string', () => {
      assert.equal(isTrivial('   '), true);
    });

    it('returns false for null/undefined/non-string', () => {
      assert.equal(isTrivial(null), false);
      assert.equal(isTrivial(undefined), false);
      assert.equal(isTrivial(123), false);
    });

    // --- Known trivial patterns ---
    it('returns true for known trivial English patterns', () => {
      assert.equal(isTrivial('ok'), true);
      assert.equal(isTrivial('okay'), true);
      assert.equal(isTrivial('yes'), true);
      assert.equal(isTrivial('no'), true);
      assert.equal(isTrivial('sure'), true);
      assert.equal(isTrivial('thanks'), true);
      assert.equal(isTrivial('thx'), true);
      assert.equal(isTrivial('ty'), true);
      assert.equal(isTrivial('lgtm'), true);
      assert.equal(isTrivial('y'), true);
      assert.equal(isTrivial('n'), true);
      assert.equal(isTrivial('continue'), true);
      assert.equal(isTrivial('proceed'), true);
    });

    it('returns true for known trivial Korean patterns', () => {
      assert.equal(isTrivial('확인'), true);
      assert.equal(isTrivial('네'), true);
      assert.equal(isTrivial('응'), true);
      assert.equal(isTrivial('ㅇㅇ'), true);
      assert.equal(isTrivial('좋아'), true);
      assert.equal(isTrivial('ㄱㄱ'), true);
    });

    it('returns true for command-like trivial patterns', () => {
      assert.equal(isTrivial('push'), true);
      assert.equal(isTrivial('pull'), true);
      assert.equal(isTrivial('done'), true);
      assert.equal(isTrivial('next'), true);
      assert.equal(isTrivial('go'), true);
      assert.equal(isTrivial('run'), true);
    });

    it('matches patterns case-insensitively', () => {
      assert.equal(isTrivial('OK'), true);
      assert.equal(isTrivial('LGTM'), true);
      assert.equal(isTrivial('Yes'), true);
      assert.equal(isTrivial('PUSH'), true);
    });

    it('trims whitespace before matching', () => {
      assert.equal(isTrivial('  ok  '), true);
      assert.equal(isTrivial('\tok\n'), true);
    });

    // --- Normal prompts that should pass ---
    it('returns false for normal prompts above min length', () => {
      assert.equal(isTrivial('fix the authentication bug in login handler'), false);
      assert.equal(isTrivial('add error handling to the API endpoint'), false);
      assert.equal(isTrivial('refactor the database connection pooling'), false);
    });

    it('returns false for prompts at exactly minPromptLength', () => {
      // Default minPromptLength is 20
      const exactly20 = 'a]234567890123456789';
      assert.equal(exactly20.length, 20);
      assert.equal(isTrivial(exactly20), false);
    });

    // --- Config options ---
    it('respects custom minPromptLength', () => {
      assert.equal(isTrivial('short text', { minPromptLength: 5 }), false);
      assert.equal(isTrivial('hi', { minPromptLength: 5 }), true);
    });

    it('respects custom trivialPatterns', () => {
      const config = { trivialPatterns: ['skip-this', 'also-skip'], minPromptLength: 5 };
      assert.equal(isTrivial('skip-this', config), true);
      assert.equal(isTrivial('also-skip', config), true);
      assert.equal(isTrivial('ok but this is long enough', config), false);
    });

    it('returns false when filter is disabled', () => {
      assert.equal(isTrivial('ok', { enabled: false }), false);
      assert.equal(isTrivial('y', { enabled: false }), false);
    });

    it('does not match partial patterns', () => {
      // "okay" is a pattern but "okaying" should not match (length > 20 aside)
      assert.equal(isTrivial('okay I will fix the bug now please', {}), false);
    });
  });
});
