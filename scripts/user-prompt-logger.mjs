#!/usr/bin/env node

/**
 * Codepresso UserPromptSubmit hook.
 * Captures user prompts and appends them to a batch file for periodic PR commenting.
 */

import { readStdin } from './lib/stdin.mjs';
import { loadConfig, isExcluded } from './lib/config.mjs';
import { isTrivial } from './lib/trivial-filter.mjs';
import { createLogger } from './lib/logger.mjs';
import { appendToBatch, flushIfReady } from './lib/pr-comment.mjs';
import { getCurrentBranch, isMainBranch } from './lib/git-utils.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const SESSION_FILE = join(process.cwd(), '.omc', 'state', 'codepresso-session.json');
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

        // Lazy PR detection: if no PR cached, try to find one for the current branch
        if (session && !session.prNumber) {
          const currentBranch = getCurrentBranch();
          if (currentBranch && !isMainBranch(currentBranch)) {
            // Spawn detached process to find PR and update session file (non-blocking)
            const sessionFile = SESSION_FILE;
            const cwd = session?.gitRoot || process.cwd();
            const script = `
              const fs = require('fs');
              const { execSync } = require('child_process');
              try {
                const session = JSON.parse(fs.readFileSync(${JSON.stringify(sessionFile)}, 'utf-8'));
                const branch = ${JSON.stringify(currentBranch)};
                const output = execSync(
                  'gh pr list --head "' + branch + '" --json number,url --limit 1',
                  { cwd: ${JSON.stringify(cwd)}, encoding: 'utf-8', timeout: 10000, stdio: ['pipe','pipe','pipe'] }
                );
                const prs = JSON.parse(output);
                if (prs && prs.length > 0) {
                  session.branch = branch;
                  session.prNumber = prs[0].number;
                  session.prUrl = prs[0].url;
                  fs.writeFileSync(${JSON.stringify(sessionFile)}, JSON.stringify(session, null, 2), 'utf-8');
                }
              } catch {}
            `;
            const child = spawn(process.execPath, ['-e', script], {
              detached: true,
              stdio: 'ignore',
              cwd,
            });
            child.unref();
          }
        }

        if (session && session.prNumber) {
          // Truncate prompt if configured
          const maxLen = config.prLogging.truncatePromptLength || 500;
          const truncated = prompt.length > maxLen
            ? prompt.slice(0, maxLen) + '...'
            : prompt;

          // Append to batch (fire-and-forget, with redaction if enabled)
          const redactionEnabled = config.redaction?.enabled !== false;
          const extraRedactPatterns = redactionEnabled ? (config.redaction?.extraPatterns || []) : [];
          appendToBatch({
            timestamp: new Date().toISOString(),
            prompt: truncated,
            sessionId: session.sessionId,
          }, redactionEnabled ? extraRedactPatterns : null);

          log.debug(`Prompt batched (session: ${session.sessionId?.slice(0,8)})`);

          // Check if batch should flush (non-blocking)
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
  } catch {
    // Silent failure
  }

  // Notion task picker is handled exclusively by PreToolUse hook
  // (UserPromptSubmit does NOT support additionalContext injection)
  process.stdout.write(JSON.stringify({ continue: true }));
}

main();
