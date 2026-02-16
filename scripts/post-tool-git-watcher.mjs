#!/usr/bin/env node

/**
 * Codepresso PostToolUse:Bash hook.
 * Detects git commit/push operations and posts structured comments to the associated PR.
 */

import { readStdin } from './lib/stdin.mjs';
import { loadConfig } from './lib/config.mjs';
import { createLogger } from './lib/logger.mjs';
import { postGitComment } from './lib/pr-comment.mjs';
import { recordGitCommit, recordGitPush } from './lib/analytics.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SESSION_FILE = join(process.cwd(), '.omc', 'state', 'codepresso-session.json');
const log = createLogger('git-watcher');

function readSession() {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Extract commit info from git command + output.
 * Returns { hash, message } or null.
 */
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

/**
 * Check if command is a git push.
 */
function isGitPush(command) {
  return /\bgit\s+push\b/.test(command);
}

async function main() {
  const raw = await readStdin(2000);

  try {
    const input = JSON.parse(raw);
    const toolInput = input?.hookInput?.toolInput || input?.toolInput || {};
    const toolOutput = input?.hookInput?.toolOutput || input?.toolOutput || '';
    const command = toolInput?.command || '';
    const output = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput);

    const config = loadConfig();

    if (!config.prLogging?.enabled || !config.prLogging?.trackGitOps) {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    const session = readSession();
    if (!session || !session.prNumber) {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    // Check for git commit
    const commitInfo = extractCommitInfo(command, output);
    if (commitInfo) {
      log.info(`Commit detected: ${commitInfo.hash}`);
      postGitComment(session.prNumber, {
        hash: commitInfo.hash,
        message: commitInfo.message,
        timestamp: new Date().toISOString(),
      });

      try {
        recordGitCommit({
          sessionId: session.sessionId,
          branch: session.branch,
          prNumber: session.prNumber,
          commitHash: commitInfo.hash,
          commitMessage: commitInfo.message,
        });
      } catch {
        // Analytics failure must never block the hook
      }

      process.stdout.write(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `[Codepresso] Commit \`${commitInfo.hash}\` logged to PR #${session.prNumber}`,
        },
      }));
      return;
    }

    // Check for git push
    if (isGitPush(command)) {
      try {
        recordGitPush({
          sessionId: session.sessionId,
          branch: session.branch,
          prNumber: session.prNumber,
        });
      } catch {
        // Analytics failure must never block the hook
      }

      process.stdout.write(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `[Codepresso] Push detected on branch \`${session.branch}\` (PR #${session.prNumber})`,
        },
      }));
      return;
    }
  } catch {
    // Silent failure
  }

  process.stdout.write(JSON.stringify({ continue: true }));
}

main();
