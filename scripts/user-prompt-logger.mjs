#!/usr/bin/env node

/**
 * Codepresso UserPromptSubmit hook.
 * Captures user prompts and appends them to a batch file for periodic PR commenting.
 */

import { readStdin } from './lib/stdin.mjs';
import { loadConfig, isExcluded, getStateDir } from './lib/config.mjs';
import { isTrivial } from './lib/trivial-filter.mjs';
import { createLogger } from './lib/logger.mjs';
import { appendToBatch, flushIfReady } from './lib/pr-comment.mjs';
import { isMainBranch } from './lib/git-utils.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SESSION_FILE = join(getStateDir(), 'codepresso-session.json');
const log = createLogger('prompt-logger');

function readSession() {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

async function main() {
  const raw = await readStdin(2000);

  try {
    const input = JSON.parse(raw);
    const prompt = input?.hookInput?.userPrompt || input?.prompt || '';

    if (prompt) {
      const config = loadConfig();

      if (config.prLogging?.enabled && !isExcluded(prompt, config.excludePatterns)) {
        // Skip trivial prompts (short or acknowledgment-only)
        if (isTrivial(prompt, config.trivialFilter)) {
          try {
            const session = readSession();
            if (session) {
              session.skippedTrivialCount = (session.skippedTrivialCount || 0) + 1;
              writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
            }
          } catch {
            // Silent — never block on counter increment
          }
          process.stdout.write(JSON.stringify({ continue: true }));
          return;
        }

        const session = readSession();

        // Skip batching on main branches (no PR to log to)
        if (session) {
          const branch = session.branch;
          if (branch && isMainBranch(branch)) {
            process.stdout.write(JSON.stringify({ continue: true }));
            return;
          }
        }

        if (session) {
          // Truncate prompt if configured
          const maxLen = config.prLogging.truncatePromptLength || 500;
          const truncated = prompt.length > maxLen
            ? prompt.slice(0, maxLen) + '...'
            : prompt;

          // Append entry — no branch/prNumber fields needed (single-PR model)
          const redactionEnabled = config.redaction?.enabled !== false;
          const extraRedactPatterns = redactionEnabled ? (config.redaction?.extraPatterns || []) : [];
          appendToBatch({
            timestamp: new Date().toISOString(),
            prompt: truncated,
            sessionId: session.sessionId,
          }, redactionEnabled ? extraRedactPatterns : null);

          log.debug(`Prompt batched (session: ${session.sessionId?.slice(0,8)})`);

          // Check if batch should flush (non-blocking)
          if (session.prNumber) {
            flushIfReady(
              { prNumber: session.prNumber, branch: session.branch, sessionId: session.sessionId, gitRoot: session.gitRoot },
              {
                batchIntervalSeconds: config.prLogging.batchIntervalSeconds,
                maxBatchSize: config.prLogging.maxBatchSize,
                rateLimit: config.rateLimit,
              }
            );
          }
        }
      }
    }
  } catch {
    // Silent failure
  }

  // Notion task picker is handled exclusively by PreToolUse hook
  // (UserPromptSubmit does NOT support additionalContext injection)
  process.stdout.write(JSON.stringify({ continue: true }));
}

main();
