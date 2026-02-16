import { describe, it } from 'node:test';
import assert from 'node:assert';

// Recreate the extractCommitInfo and isGitPush logic from post-tool-git-watcher.mjs for testing
function extractCommitInfo(command, output) {
  if (!command) return null;

  // Detect git commit
  if (/\bgit\s+commit\b/.test(command)) {
    // Try to extract from output like: [branch abc1234] commit message
    const match = output?.match(/\[[\w/.-]+\s+([a-f0-9]{7,})\]\s+(.+)/);
    if (match) {
      return { hash: match[1], message: match[2].trim() };
    }
    // Fallback: extract -m message from command
    const msgMatch = command.match(/-m\s+["']([^"']+)["']/);
    if (msgMatch) {
      return { hash: 'unknown', message: msgMatch[1] };
    }
  }

  return null;
}

function isGitPush(command) {
  return /\bgit\s+push\b/.test(command);
}

describe('git-watcher.mjs', () => {
  describe('extractCommitInfo', () => {
    it('extracts hash and message from git commit output', () => {
      const command = 'git commit -m "feat: add auth"';
      const output = '[main abc1234] feat: add auth';
      const result = extractCommitInfo(command, output);

      assert.deepStrictEqual(result, {
        hash: 'abc1234',
        message: 'feat: add auth',
      });
    });

    it('extracts hash and message with branch containing slashes', () => {
      const command = 'git commit -m "fix bug"';
      const output = '[feature/user-profile def5678] fix bug';
      const result = extractCommitInfo(command, output);

      assert.deepStrictEqual(result, {
        hash: 'def5678',
        message: 'fix bug',
      });
    });

    it('extracts hash and message with longer commit hash', () => {
      const command = 'git commit -m "update readme"';
      const output = '[develop 1a2b3c4d5e6f] update readme';
      const result = extractCommitInfo(command, output);

      assert.deepStrictEqual(result, {
        hash: '1a2b3c4d5e6f',
        message: 'update readme',
      });
    });

    it('falls back to extracting message from -m flag when output does not match', () => {
      const command = 'git commit -m "test message"';
      const output = 'Some unexpected output';
      const result = extractCommitInfo(command, output);

      assert.deepStrictEqual(result, {
        hash: 'unknown',
        message: 'test message',
      });
    });

    it('handles single quotes in -m flag', () => {
      const command = "git commit -m 'single quoted message'";
      const output = '';
      const result = extractCommitInfo(command, output);

      assert.deepStrictEqual(result, {
        hash: 'unknown',
        message: 'single quoted message',
      });
    });

    it('returns null for non-git-commit commands', () => {
      const command = 'git push origin main';
      const output = 'Pushing...';
      const result = extractCommitInfo(command, output);

      assert.strictEqual(result, null);
    });

    it('returns null for git commands without commit', () => {
      const command = 'git status';
      const output = 'On branch main';
      const result = extractCommitInfo(command, output);

      assert.strictEqual(result, null);
    });

    it('returns null when command is null', () => {
      const result = extractCommitInfo(null, 'some output');
      assert.strictEqual(result, null);
    });

    it('returns null when command is undefined', () => {
      const result = extractCommitInfo(undefined, 'some output');
      assert.strictEqual(result, null);
    });

    it('handles git commit with additional flags', () => {
      const command = 'git commit -m "feat: new feature" --no-verify';
      const output = '[main abc9876] feat: new feature';
      const result = extractCommitInfo(command, output);

      assert.deepStrictEqual(result, {
        hash: 'abc9876',
        message: 'feat: new feature',
      });
    });

    it('trims whitespace from extracted message', () => {
      const command = 'git commit -m "message"';
      const output = '[main abc1234]   message with spaces  ';
      const result = extractCommitInfo(command, output);

      assert.deepStrictEqual(result, {
        hash: 'abc1234',
        message: 'message with spaces',
      });
    });
  });

  describe('isGitPush', () => {
    it('returns true for git push command', () => {
      assert.strictEqual(isGitPush('git push'), true);
      assert.strictEqual(isGitPush('git push origin main'), true);
      assert.strictEqual(isGitPush('git push -u origin feature'), true);
    });

    it('returns true for git push with flags', () => {
      assert.strictEqual(isGitPush('git push --force'), true);
      assert.strictEqual(isGitPush('git push --set-upstream origin main'), true);
    });

    it('returns false for non-push git commands', () => {
      assert.strictEqual(isGitPush('git commit -m "test"'), false);
      assert.strictEqual(isGitPush('git status'), false);
      assert.strictEqual(isGitPush('git pull'), false);
      assert.strictEqual(isGitPush('git checkout main'), false);
    });

    it('returns false for non-git commands', () => {
      assert.strictEqual(isGitPush('npm install'), false);
      assert.strictEqual(isGitPush('ls -la'), false);
      assert.strictEqual(isGitPush('pushd /some/dir'), false);
    });

    it('handles commands with extra whitespace', () => {
      assert.strictEqual(isGitPush('  git   push  '), true);
    });

    it('is case-sensitive', () => {
      assert.strictEqual(isGitPush('GIT PUSH'), false);
      assert.strictEqual(isGitPush('Git Push'), false);
    });
  });
});
