/**
 * Integration tests for pre-tool-notion-inject.mjs.
 *
 * These tests spawn the hook script as a subprocess with a temp cwd
 * containing a fixture session.json and (optionally) .codepresso.json
 * for Notion config, then assert on the JSON written to stdout.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_PATH = join(__filename, '..', '..', '..', 'scripts', 'pre-tool-notion-inject.mjs');

function runHook(cwd, stdinPayload) {
  const result = spawnSync('node', [SCRIPT_PATH], {
    cwd,
    input: JSON.stringify(stdinPayload),
    encoding: 'utf-8',
    timeout: 5000,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = null;
  }
  return { stdout: result.stdout, stderr: result.stderr, status: result.status, json: parsed };
}

function writeSession(dir, session) {
  const stateDir = join(dir, '.codepresso', 'state');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'codepresso-session.json'), JSON.stringify(session));
}

function writeProjectConfig(dir, config) {
  writeFileSync(join(dir, '.codepresso.json'), JSON.stringify(config));
}

let tempDir;
beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'codepresso-hook-'));
});
afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('pre-tool-notion-inject.mjs — PR link enforcement', () => {
  describe('no selected task + Notion configured', () => {
    it('blocks gh pr create and emits pick-or-create instructions', () => {
      writeSession(tempDir, {
        notionContextShown: true,
        notionTasks: [
          { id: 'task-1', title: 'Fix auth', uniqueId: 'TSK-100', status: '할 일' },
          { id: 'task-2', title: 'Add logging', uniqueId: 'TSK-101', status: '진행 중' },
        ],
      });
      writeProjectConfig(tempDir, {
        notion: {
          apiKey: 'ntn_test',
          databases: { task: 'db-task-id' },
          userId: 'user-uuid',
        },
      });

      const { json } = runHook(tempDir, {
        hookInput: {
          toolName: 'Bash',
          toolInput: { command: 'gh pr create --title "fix login bug" --body "..."' },
        },
      });

      assert.strictEqual(json.continue, false);
      assert.ok(json.hookSpecificOutput?.additionalContext);
      const ctx = json.hookSpecificOutput.additionalContext;
      assert.match(ctx, /PR creation blocked/);
      assert.match(ctx, /Create new task: 'fix login bug'/);
      assert.match(ctx, /TSK-100/);
      assert.match(ctx, /notion_create_page/);
      assert.match(ctx, /db-task-id/);
      assert.match(ctx, /user-uuid/);
    });

    it('blocks even when no active tasks exist', () => {
      writeSession(tempDir, {
        notionContextShown: true,
        notionTasks: [{ id: 'task-1', title: 'Done one', uniqueId: 'TSK-99', status: '완료' }],
      });
      writeProjectConfig(tempDir, {
        notion: { apiKey: 'ntn_test', databases: { task: 'db-task-id' } },
      });

      const { json } = runHook(tempDir, {
        hookInput: {
          toolName: 'Bash',
          toolInput: { command: 'gh pr create --title "new feature" --body "..."' },
        },
      });

      assert.strictEqual(json.continue, false);
      assert.match(json.hookSpecificOutput.additionalContext, /Create new task: 'new feature'/);
    });
  });

  describe('no selected task + Notion unconfigured', () => {
    it('falls through (continue:true) when apiKey is missing', () => {
      writeSession(tempDir, { notionContextShown: true, notionTasks: [] });
      writeProjectConfig(tempDir, {
        notion: { apiKey: null, databases: { task: 'db-task-id' } },
      });

      const { json } = runHook(tempDir, {
        hookInput: {
          toolName: 'Bash',
          toolInput: { command: 'gh pr create --title "x" --body "y"' },
        },
      });

      assert.strictEqual(json.continue, true);
      assert.strictEqual(json.hookSpecificOutput, undefined);
    });

    it('falls through when databases.task is missing', () => {
      writeSession(tempDir, { notionContextShown: true, notionTasks: [] });
      writeProjectConfig(tempDir, {
        notion: { apiKey: 'ntn_test', databases: { task: null } },
      });

      const { json } = runHook(tempDir, {
        hookInput: {
          toolName: 'Bash',
          toolInput: { command: 'gh pr create --title "x" --body "y"' },
        },
      });

      assert.strictEqual(json.continue, true);
    });
  });

  describe('no selected task + missing --title', () => {
    it('falls through so gh fails naturally', () => {
      writeSession(tempDir, { notionContextShown: true, notionTasks: [] });
      writeProjectConfig(tempDir, {
        notion: { apiKey: 'ntn_test', databases: { task: 'db-task-id' } },
      });

      const { json } = runHook(tempDir, {
        hookInput: {
          toolName: 'Bash',
          toolInput: { command: 'gh pr create --body "no title"' },
        },
      });

      assert.strictEqual(json.continue, true);
    });
  });

  describe('selected task exists — existing behavior preserved', () => {
    it('passes through when title already contains the uniqueId', () => {
      writeSession(tempDir, { notionContextShown: true, notionTasks: [] });
      writeProjectConfig(tempDir, {
        notion: { apiKey: 'ntn_test', databases: { task: 'db-task-id' } },
      });
      const stateDir = join(tempDir, '.codepresso', 'state');
      writeFileSync(
        join(stateDir, 'codepresso-selected-task.json'),
        JSON.stringify({ id: 'task-1', title: 'Fix auth', uniqueId: 'TSK-100' }),
      );

      const { json } = runHook(tempDir, {
        hookInput: {
          toolName: 'Bash',
          toolInput: { command: 'gh pr create --title "[TSK-100] fix auth" --body "..."' },
        },
      });

      assert.strictEqual(json.continue, true);
    });

    it('blocks when title is missing the uniqueId prefix', () => {
      writeSession(tempDir, { notionContextShown: true, notionTasks: [] });
      writeProjectConfig(tempDir, {
        notion: { apiKey: 'ntn_test', databases: { task: 'db-task-id' } },
      });
      const stateDir = join(tempDir, '.codepresso', 'state');
      writeFileSync(
        join(stateDir, 'codepresso-selected-task.json'),
        JSON.stringify({ id: 'task-1', title: 'Fix auth', uniqueId: 'TSK-100' }),
      );

      const { json } = runHook(tempDir, {
        hookInput: {
          toolName: 'Bash',
          toolInput: { command: 'gh pr create --title "fix auth bug" --body "..."' },
        },
      });

      assert.strictEqual(json.continue, false);
      assert.match(json.hookSpecificOutput.additionalContext, /\[TSK-100\] fix auth bug/);
    });
  });

  describe('non-Bash tools', () => {
    it('passes through for non-Bash tool calls', () => {
      writeSession(tempDir, { notionContextShown: true, notionTasks: [] });

      const { json } = runHook(tempDir, {
        hookInput: {
          toolName: 'Read',
          toolInput: { file_path: '/etc/hosts' },
        },
      });

      assert.strictEqual(json.continue, true);
    });
  });
});
