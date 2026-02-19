#!/usr/bin/env node

/**
 * Codepresso UserPromptSubmit hook.
 * Captures user prompts and appends them to a batch file for periodic PR commenting.
 */

import { readStdin } from './lib/stdin.mjs';
import { loadConfig, isExcluded } from './lib/config.mjs';
import { createLogger } from './lib/logger.mjs';
import { appendToBatch, flushIfReady } from './lib/pr-comment.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
        const session = readSession();
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
            { prNumber: session.prNumber, branch: session.branch, sessionId: session.sessionId },
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

  process.stdout.write(JSON.stringify({ continue: true }));
}

main();
