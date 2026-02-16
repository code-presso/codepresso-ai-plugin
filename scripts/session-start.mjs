#!/usr/bin/env node

/**
 * Codepresso SessionStart hook.
 * Detects current branch and associated PR, caches state for the session.
 */

import { readStdin } from './lib/stdin.mjs';
import { loadConfig } from './lib/config.mjs';
import { createLogger } from './lib/logger.mjs';
import { getCurrentBranch, findPrForBranch, isMainBranch, getHeadCommit } from './lib/git-utils.mjs';
import { fetchNotionTasks } from './lib/notion-tasks.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STATE_DIR = join(process.cwd(), '.omc', 'state');
const SESSION_FILE = join(STATE_DIR, 'codepresso-session.json');
const log = createLogger('session-start');

function ensureStateDir() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

async function main() {
  // Consume stdin (required by hook protocol)
  await readStdin(3000);

  try {
    const config = loadConfig();

    if (!config.prLogging?.enabled) {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    const branch = getCurrentBranch();
    if (!branch || isMainBranch(branch)) {
      // No PR logging on main branches
      ensureStateDir();
      writeFileSync(SESSION_FILE, JSON.stringify({ branch, prNumber: null, prUrl: null, sessionId: randomUUID(), headCommit: getHeadCommit() }), 'utf-8');
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    const pr = findPrForBranch(branch);
    const sessionId = randomUUID();

    log.info(`Branch: ${branch}, PR: ${pr?.number || 'none'}`);

    const sessionState = {
      branch,
      prNumber: pr?.number || null,
      prUrl: pr?.url || null,
      sessionId,
      startedAt: new Date().toISOString(),
      labelsApplied: false,
      headCommit: getHeadCommit(),
    };

    ensureStateDir();
    writeFileSync(SESSION_FILE, JSON.stringify(sessionState, null, 2), 'utf-8');

    // Build context parts
    const contextParts = [];

    if (pr) {
      contextParts.push(`[Codepresso] PR #${pr.number} detected on branch \`${branch}\`. Prompts will be logged.`);
    } else {
      contextParts.push(`[Codepresso] Branch \`${branch}\` — no open PR found. Prompt logging disabled.`);
    }

    // Fetch Notion tasks (non-blocking, timeout-protected)
    try {
      const taskList = await fetchNotionTasks();
      if (taskList) {
        contextParts.push(taskList);
      }
    } catch {
      // Notion fetch failed — skip silently
    }

    process.stdout.write(JSON.stringify({
      continue: true,
      additionalContext: contextParts.join('\n\n'),
    }));
  } catch (err) {
    // Silent failure — don't break the session
    log.error(`SessionStart error: ${err.message}`);
    process.stdout.write(JSON.stringify({ continue: true }));
  }
}

main();
