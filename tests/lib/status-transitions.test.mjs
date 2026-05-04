import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTaskForPr } from '../../scripts/lib/status-transitions.mjs';

describe('status-transitions.mjs', () => {
  describe('resolveTaskForPr', () => {
    const stateDir = join(process.cwd(), '.codepresso', 'state');
    const selectedTaskFile = join(stateDir, 'codepresso-selected-task.json');
    let originalContent = null;
    let originallyExisted = false;

    beforeEach(() => {
      originallyExisted = existsSync(selectedTaskFile);
      if (originallyExisted) {
        originalContent = readFileSync(selectedTaskFile, 'utf-8');
      } else {
        originalContent = null;
      }
    });

    afterEach(() => {
      if (originallyExisted && originalContent !== null) {
        writeFileSync(selectedTaskFile, originalContent, 'utf-8');
      } else {
        try { rmSync(selectedTaskFile); } catch { /* ignore */ }
      }
    });

    it('returns null for null branch', () => {
      assert.strictEqual(resolveTaskForPr(null), null);
    });

    it('returns null for empty branch', () => {
      assert.strictEqual(resolveTaskForPr(''), null);
    });

    it('reads branch-keyed task', () => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(selectedTaskFile, JSON.stringify({
        'feature/test': {
          id: 'task-123',
          uniqueId: 'TSK-9999',
          epicId: 'epic-456',
          epicUniqueId: 'GP-1001',
        },
      }), 'utf-8');

      const result = resolveTaskForPr('feature/test');
      assert.strictEqual(result.taskId, 'task-123');
      assert.strictEqual(result.taskUniqueId, 'TSK-9999');
      assert.strictEqual(result.epicId, 'epic-456');
      assert.strictEqual(result.epicUniqueId, 'GP-1001');
    });

    it('returns null for unmatched branch', () => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(selectedTaskFile, JSON.stringify({
        'feature/other': { id: 'task-123', uniqueId: 'TSK-9999' },
      }), 'utf-8');

      const result = resolveTaskForPr('feature/test');
      assert.strictEqual(result, null);
    });

    it('supports legacy singleton format', () => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(selectedTaskFile, JSON.stringify({
        id: 'task-legacy',
        uniqueId: 'TSK-1234',
      }), 'utf-8');

      const result = resolveTaskForPr('any-branch');
      assert.strictEqual(result.taskId, 'task-legacy');
      assert.strictEqual(result.taskUniqueId, 'TSK-1234');
    });

    it('returns null when selected task file does not exist', () => {
      // Ensure file doesn't exist
      try { rmSync(selectedTaskFile); } catch { /* ignore */ }

      const result = resolveTaskForPr('feature/test');
      assert.strictEqual(result, null);
    });
  });
});
