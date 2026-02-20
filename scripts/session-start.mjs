#!/usr/bin/env node

/**
 * Codepresso SessionStart hook.
 * Detects current branch and associated PR, caches state for the session.
 */

import { readStdin } from './lib/stdin.mjs';
import { loadConfig, isSetupComplete } from './lib/config.mjs';
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
  await readStdin(1000);

  // Enforce setup if global config doesn't exist (first run after install)
  if (!isSetupComplete()) {
    process.stdout.write(JSON.stringify({
      continue: true,
      additionalContext: [
        '[Codepresso] Setup required — this plugin has not been configured yet.',
        'Please run the setup wizard now by invoking the `/codepresso:setup` skill.',
        'The plugin will not log prompts or track activity until setup is complete.',
      ].join('\n'),
    }));
    return;
  }

  try {
    const config = loadConfig();
    const branch = getCurrentBranch();
    const onMainBranch = !branch || isMainBranch(branch);
    const sessionId = randomUUID();
    let pr = null;

    if (!onMainBranch) {
      pr = findPrForBranch(branch);
    }

    log.info(`Branch: ${branch || '(none)'}, PR: ${pr?.number || 'none'}`);

    // Build context parts
    const contextParts = [];

    // PR context only if prLogging is enabled
    if (config.prLogging?.enabled) {
      if (pr) {
        contextParts.push(`[Codepresso] PR #${pr.number} detected on branch \`${branch}\`. Prompts will be logged.`);
      } else if (!onMainBranch) {
        contextParts.push(`[Codepresso] Branch \`${branch}\` — no open PR found. Prompt logging disabled.`);
      }
    }

    // Fetch Notion tasks (non-blocking, timeout-protected) — always, regardless of branch
    let notionContext = null;
    try {
      const taskList = await fetchNotionTasks();
      if (taskList) {
        notionContext = taskList;
        contextParts.push(taskList);
      }
    } catch {
      // Notion fetch failed — skip silently
    }

    const sessionState = {
      branch,
      prNumber: pr?.number || null,
      prUrl: pr?.url || null,
      sessionId,
      startedAt: new Date().toISOString(),
      labelsApplied: false,
      headCommit: getHeadCommit(),
      notionContext,
      notionContextShown: false,
    };

    ensureStateDir();
    writeFileSync(SESSION_FILE, JSON.stringify(sessionState, null, 2), 'utf-8');

    if (contextParts.length === 0) {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
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
