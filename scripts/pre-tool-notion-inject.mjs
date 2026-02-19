#!/usr/bin/env node

/**
 * Codepresso PreToolUse hook — one-shot Notion context injection.
 *
 * On the first tool use of a session, injects the cached Notion task list
 * as additionalContext. Subsequent calls are fast no-ops.
 *
 * Why PreToolUse? Claude Code silently drops additionalContext from
 * SessionStart and UserPromptSubmit hooks. Only PreToolUse / PostToolUse
 * hooks propagate additionalContext into the conversation.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SESSION_FILE = join(process.cwd(), '.omc', 'state', 'codepresso-session.json');

// Fast stdin consumption with timeout — never block more than 1s
await new Promise((resolve) => {
  const timeout = setTimeout(() => {
    process.stdin.removeAllListeners();
    process.stdin.destroy();
    resolve();
  }, 1000);

  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => { clearTimeout(timeout); resolve(); });
  process.stdin.on('error', () => { clearTimeout(timeout); resolve(); });

  if (process.stdin.readableEnded) {
    clearTimeout(timeout);
    resolve();
  }
});

try {
  const session = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));

  if (session.notionContext && !session.notionContextShown) {
    // Write stdout FIRST, then mark as shown
    const output = JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: session.notionContext,
      },
    });
    process.stdout.write(output);

    // Now mark as shown
    session.notionContextShown = true;
    writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
  } else {
    process.stdout.write(JSON.stringify({ continue: true }));
  }
} catch {
  process.stdout.write(JSON.stringify({ continue: true }));
}
