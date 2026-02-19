#!/usr/bin/env node

/**
 * Codepresso PreToolUse hook — one-shot Notion context injection.
 *
 * On the first tool use of a session, injects the cached Notion task list
 * as additionalContext. If SessionStart failed to fetch tasks (notionContext
 * is null), this hook retries the fetch as a self-healing fallback.
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

function emitAndMark(session, notionContext) {
  const output = JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `IMPORTANT: Display the following Notion tasks to the user immediately. Print them in a readable format so the user can see their current task status.\n\n${notionContext}`,
    },
  });
  process.stdout.write(output);

  session.notionContext = notionContext;
  session.notionContextShown = true;
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
}

try {
  const session = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));

  // Already shown — fast no-op
  if (session.notionContextShown) {
    process.stdout.write(JSON.stringify({ continue: true }));
  }
  // Cached tasks available — inject immediately
  else if (session.notionContext) {
    emitAndMark(session, session.notionContext);
  }
  // SessionStart fetch failed — retry as fallback (2s budget)
  else {
    try {
      const { fetchNotionTasks } = await import('./lib/notion-tasks.mjs');
      const taskList = await fetchNotionTasks(2000);
      if (taskList) {
        emitAndMark(session, taskList);
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
