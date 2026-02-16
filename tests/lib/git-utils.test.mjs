import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isMainBranch } from '../../scripts/lib/git-utils.mjs';

describe('git-utils.mjs', () => {
  describe('isMainBranch', () => {
    it('returns true for main branch', () => {
      assert.strictEqual(isMainBranch('main'), true);
    });

    it('returns true for master branch', () => {
      assert.strictEqual(isMainBranch('master'), true);
    });

    it('returns true for develop branch', () => {
      assert.strictEqual(isMainBranch('develop'), true);
    });

    it('returns false for feature branches', () => {
      assert.strictEqual(isMainBranch('feature/auth'), false);
      assert.strictEqual(isMainBranch('feature/user-profile'), false);
    });

    it('returns false for fix branches', () => {
      assert.strictEqual(isMainBranch('fix/bug-123'), false);
      assert.strictEqual(isMainBranch('fix/login-error'), false);
    });

    it('returns false for release branches', () => {
      assert.strictEqual(isMainBranch('release/v1'), false);
      assert.strictEqual(isMainBranch('release/v2.0.0'), false);
    });

    it('returns false for other branch patterns', () => {
      assert.strictEqual(isMainBranch('dev'), false);
      assert.strictEqual(isMainBranch('staging'), false);
      assert.strictEqual(isMainBranch('hotfix/urgent'), false);
      assert.strictEqual(isMainBranch('chore/cleanup'), false);
    });

    it('is case-sensitive', () => {
      assert.strictEqual(isMainBranch('Main'), false);
      assert.strictEqual(isMainBranch('MASTER'), false);
      assert.strictEqual(isMainBranch('Develop'), false);
    });
  });
});
