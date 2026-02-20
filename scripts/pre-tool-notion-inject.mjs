#!/usr/bin/env node

/**
 * Codepresso PreToolUse hook — one-shot Notion task picker injection.
 *
 * On the first tool use of a session, injects cached Notion tasks as
 * additionalContext with instructions for Claude to present an interactive
 * AskUserQuestion picker. If SessionStart failed to fetch tasks, retries
 * as a self-healing fallback.
 *
 * Why PreToolUse? Claude Code silently drops additionalContext from
 * SessionStart and UserPromptSubmit hooks. Only PreToolUse / PostToolUse
 * hooks propagate additionalContext into the conversation.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SESSION_FILE = join(process.cwd(), '.omc', 'state', 'codepresso-session.json');

// Fast stdin consumption with timeout — never block more than 500ms
await new Promise((resolve) => {
  const timeout = setTimeout(() => {
    process.stdin.removeAllListeners();
    process.stdin.destroy();
    resolve();
  }, 500);

  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => { clearTimeout(timeout); resolve(); });
  process.stdin.on('error', () => { clearTimeout(timeout); resolve(); });

  if (process.stdin.readableEnded) {
    clearTimeout(timeout);
    resolve();
  }
});

/**
 * Check if a task status represents a completed state.
 */
function isCompletedStatus(status) {
  if (!status) return false;
  const normalized = status.toLowerCase().trim();
  return normalized === '완료' || normalized === 'done' || normalized === 'completed';
}

/**
 * Build the picker instruction context from structured task data.
 */
function buildPickerContext(notionContext, notionTasks) {
  const activeTasks = notionTasks.filter((t) => !isCompletedStatus(t.status));

  if (activeTasks.length === 0) {
    return `Your Notion tasks are all completed! Great job — no pending tasks to pick from.\n\n${notionContext}`;
  }

  // Group by status for display order: 할 일 (To Do) → 진행 중 (In Progress) → others
  const statusOrder = ['할 일', '진행 중'];
  const sorted = [...activeTasks].sort((a, b) => {
    const aIdx = statusOrder.indexOf(a.status);
    const bIdx = statusOrder.indexOf(b.status);
    const aOrder = aIdx >= 0 ? aIdx : statusOrder.length;
    const bOrder = bIdx >= 0 ? bIdx : statusOrder.length;
    return aOrder - bOrder;
  });

  const tasksJson = JSON.stringify(sorted, null, 2);

  return [
    'IMPORTANT: Present an interactive task picker to the user using AskUserQuestion.',
    '',
    notionContext,
    '',
    `Active tasks available to work on (${sorted.length}):`,
    tasksJson,
    '',
    'INSTRUCTIONS:',
    '1. Use AskUserQuestion to present the active tasks as selectable options.',
    '   - question: "Which task would you like to work on?"',
    '   - header: "Notion Task"',
    '   - Each option: label = task title, description = current status',
    '   - Group by status: "할 일" (To Do) first, then "진행 중" (In Progress), then others (e.g., Holding)',
    '   - If there are more than 4 active tasks, pick the top 3 most relevant (prioritize "할 일" over "진행 중") and let the 4th option or "Other" handle the rest.',
    '2. When the user picks a task:',
    '   a. If the task status is NOT already "진행 중", use the mcp__notion__notion_update_page or mcp__plugin_codepresso_notion__notion_update_page MCP tool to update the page status property to "진행 중".',
    '      Use: { page_id: "<task-id>", properties: { "상태": { "status": { "name": "진행 중" } } } }',
    '   b. Ask the user if they want to create a feature branch for this task.',
    '   c. If yes, suggest a branch name like "feature/<slugified-task-title>" and create it with `git checkout -b <branch-name>`.',
    '3. If user selects "Other" or types a custom response, just acknowledge and proceed normally without updating Notion.',
  ].join('\n');
}

function emitAndMark(session, context) {
  const output = JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: context,
    },
  });
  process.stdout.write(output);

  session.notionContextShown = true;
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
}

try {
  const session = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));

  // Already shown — fast no-op
  if (session.notionContextShown) {
    process.stdout.write(JSON.stringify({ continue: true }));
  }
  // Structured tasks available — build picker context
  else if (session.notionTasks && session.notionTasks.length > 0) {
    const context = buildPickerContext(session.notionContext, session.notionTasks);
    emitAndMark(session, context);
  }
  // Only formatted text (legacy/fallback) — display as before
  else if (session.notionContext) {
    const context = `IMPORTANT: Display the following Notion tasks to the user immediately. Print them in a readable format so the user can see their current task status.\n\n${session.notionContext}`;
    emitAndMark(session, context);
  }
  // SessionStart fetch failed — retry as fallback (2s budget)
  else {
    try {
      const { fetchNotionTasksStructured } = await import('./lib/notion-tasks.mjs');
      const result = await fetchNotionTasksStructured(2000);
      if (result) {
        session.notionContext = result.formatted;
        session.notionTasks = result.tasks;
        if (result.tasks.length > 0) {
          const context = buildPickerContext(result.formatted, result.tasks);
          emitAndMark(session, context);
        } else {
          const context = `IMPORTANT: Display the following Notion tasks to the user immediately.\n\n${result.formatted}`;
          emitAndMark(session, context);
        }
      } else {
        process.stdout.write(JSON.stringify({ continue: true }));
      }
    } catch {
      process.stdout.write(JSON.stringify({ continue: true }));
    }
  }
} catch {
  process.stdout.write(JSON.stringify({ continue: true }));
}
