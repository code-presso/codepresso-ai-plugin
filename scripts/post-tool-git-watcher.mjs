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
import { getCurrentBranch } from './lib/git-utils.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

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

/**
 * Check if command is a gh pr merge.
 */
function isGitMerge(command) {
  return /\bgh\s+pr\s+merge\b/.test(command);
}

/**
 * Check if command is a gh pr create.
 */
function isPrCreate(command) {
  return /\bgh\s+pr\s+create\b/.test(command);
}

/**
 * Extract PR number from gh pr create output (URL contains /pull/NNN).
 */
function extractCreatedPrNumber(output) {
  const match = output?.match(/\/pull\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Spawn backfill-flush.mjs as a detached process to post pre-PR planning prompts.
 */
function spawnBackfillFlush(cwd) {
  try {
    const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'backfill-flush.mjs');
    const child = spawn('node', [scriptPath], {
      cwd,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    log.debug('Failed to spawn backfill flush');
  }
}

/**
 * Extract PR number from gh pr merge command or fall back to session PR.
 */
function extractMergedPr(command, session) {
  const match = command.match(/\bgh\s+pr\s+merge\s+(\d+)/);
  if (match) return parseInt(match[1], 10);
  return session?.prNumber || null;
}

/**
 * Spawn a detached handle-merge-transition.mjs process.
 * Writes a temp payload file then unref()s the child immediately.
 */
function spawnMergeHandler(prNumber, session) {
  try {
    const payloadFile = join(process.cwd(), '.omc', 'state', `codepresso-merge-${prNumber}.json`);
    const payload = {
      prNumber,
      branch: session.branch,
      sessionId: session.sessionId,
      gitRoot: session.gitRoot,
      sprintDatabases: session.sprintDatabases || null,
    };
    writeFileSync(payloadFile, JSON.stringify(payload, null, 2), 'utf-8');

    const child = spawn('node', [
      join(dirname(fileURLToPath(import.meta.url)), 'handle-merge-transition.mjs'),
      payloadFile,
    ], {
      detached: true,
      stdio: 'ignore',
      cwd: session.gitRoot || process.cwd(),
    });
    child.unref();
  } catch {
    log.debug('Failed to spawn merge handler');
  }
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

    let session = readSession();
    if (!session) {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    // Branch-aware: check if current branch matches session branch
    const currentBranch = getCurrentBranch(session.gitRoot);
    if (currentBranch && session.branch && currentBranch !== session.branch) {
      // Branch differs from session — session.prNumber belongs to a different branch, skip
      log.debug(`Branch mismatch: session=${session.branch}, current=${currentBranch} — skipping git comment`);
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    // Check for gh pr create BEFORE the prNumber guard — PR doesn't exist yet
    if (isPrCreate(command)) {
      const newPrNumber = extractCreatedPrNumber(output);
      if (newPrNumber) {
        log.info(`PR create detected: #${newPrNumber}`);
        session.prNumber = newPrNumber;
        const prUrlLine = output.split('\n').find(l => l.includes('/pull/'));
        if (prUrlLine) session.prUrl = prUrlLine.trim();
        writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');

        // Spawn detached backfill to flush pre-PR planning prompts into the new PR
        spawnBackfillFlush(session.gitRoot || process.cwd());

        process.stdout.write(JSON.stringify({
          continue: true,
          additionalContext: `[Codepresso] PR #${newPrNumber} created — flushing pre-PR planning prompts to the PR.`,
        }));
        return;
      }
    }

    if (!session.prNumber) {
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
      }, session.gitRoot);

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
        additionalContext: `[Codepresso] Commit \`${commitInfo.hash}\` logged to PR #${session.prNumber}`,
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
        additionalContext: `[Codepresso] Push detected on branch \`${session.branch}\` (PR #${session.prNumber})`,
      }));
      return;
    }

    // Check for PR merge
    if (isGitMerge(command)) {
      const mergedPr = extractMergedPr(command, session);
      if (mergedPr) {
        log.info(`PR merge detected: #${mergedPr}`);

        // Spawn detached handler for Notion status transitions
        spawnMergeHandler(mergedPr, session);

        process.stdout.write(JSON.stringify({
          continue: true,
          additionalContext: `[Codepresso] PR #${mergedPr} merge detected — task status transition triggered.`,
        }));
        return;
      }
    }
  } catch {
    // Silent failure
  }

  process.stdout.write(JSON.stringify({ continue: true }));
}

main();
