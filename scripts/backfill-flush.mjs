#!/usr/bin/env node

/**
 * Codepresso backfill flush.
 * Spawned as a detached process when a PR is newly created or first detected.
 * Flushes pending batch entries + sidecar (pre-PR planning prompts) to the PR.
 */

import { forceFlush } from './lib/pr-comment.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SESSION_FILE = join(process.cwd(), '.omc', 'state', 'codepresso-session.json');

try {
  const session = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
  if (session.prNumber && session.branch) {
    forceFlush({
      prNumber: session.prNumber,
      branch: session.branch,
      sessionId: session.sessionId,
      gitRoot: session.gitRoot,
    });
  }
} catch {
  // Silent failure — this is a best-effort background process
}
