#!/usr/bin/env node

/**
 * Codepresso Stop hook.
 * Forces a final flush of any remaining batch entries when the session ends.
 * This prevents prompt loss when session ends before the batch interval.
 */

import { readStdin } from './lib/stdin.mjs';
import { forceFlush } from './lib/pr-comment.mjs';
import { recordSessionEnd } from './lib/analytics.mjs';
import { getStateDir } from './lib/config.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SESSION_FILE = join(getStateDir(), 'codepresso-session.json');

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

  let session = null;
  try {
    session = readSession();
    if (session && session.prNumber) {
      forceFlush({
        prNumber: session.prNumber,
        branch: session.branch,
        sessionId: session.sessionId,
        gitRoot: session.gitRoot,
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

  process.stdout.write(JSON.stringify({ continue: true }));
}

main();
