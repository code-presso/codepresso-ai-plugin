#!/usr/bin/env node

/**
 * Codepresso Stop hook.
 * Forces a final flush of any remaining batch entries when the session ends.
 * This prevents prompt loss when session ends before the batch interval.
 */

import { readStdin } from './lib/stdin.mjs';
import { forceFlush } from './lib/pr-comment.mjs';
import { recordSessionEnd } from './lib/analytics.mjs';
import { loadConfig } from './lib/config.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SESSION_FILE = join(process.cwd(), '.omc', 'state', 'codepresso-session.json');

function readSession() {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

async function main() {
  // Consume stdin (required by hook protocol)
  await readStdin(2000);

  try {
    const session = readSession();
    if (session && session.prNumber) {
      forceFlush({
        prNumber: session.prNumber,
        branch: session.branch,
        sessionId: session.sessionId,
      });
    }

    // Record session end for analytics (any session with sessionId)
    if (session && session.sessionId) {
      try {
        recordSessionEnd({
          sessionId: session.sessionId,
          branch: session.branch,
          prNumber: session.prNumber,
          startedAt: session.startedAt || session.timestamp || new Date().toISOString(),
        });
      } catch {
        // Analytics failure must never block session end
      }
    }
  } catch {
    // Silent failure — session is ending anyway
  }

  // Spawn QA runner as detached process (never blocks session end)
  try {
    const config = loadConfig();
    if (config.qa?.enabled !== false && session && session.sessionId && session.headCommit) {
      const stateDir = join(process.cwd(), '.omc', 'state');
      const tempFile = join(stateDir, `codepresso-qa-${Date.now()}.json`);
      const qaPayload = {
        sessionId: session.sessionId,
        branch: session.branch,
        prNumber: session.prNumber,
        headCommit: session.headCommit,
        dimensions: config.qa?.dimensions || ['quality', 'security', 'testing', 'documentation', 'performance'],
        model: config.qa?.model || 'claude-haiku-4-5-20251001',
        postToPr: config.qa?.postToPr !== false && !!session.prNumber,
        paths: config.qa?.paths || [],
        cwd: process.cwd(),
      };
      writeFileSync(tempFile, JSON.stringify(qaPayload), 'utf-8');

      const scriptDir = fileURLToPath(new URL('.', import.meta.url));
      const child = spawn(process.execPath, [join(scriptDir, 'qa-runner.mjs'), tempFile], {
        detached: true,
        stdio: 'ignore',
        cwd: process.cwd(),
      });
      child.unref();
    }
  } catch {
    // QA failure must never block session end
  }

  process.stdout.write(JSON.stringify({ continue: true }));
}

main();
