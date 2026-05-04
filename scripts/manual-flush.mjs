#!/usr/bin/env node

/**
 * Manual flush: score pending prompts and post to PR.
 *
 * Usage:
 *   node scripts/manual-flush.mjs
 *
 * Reads session state and batch entries, runs scoring pipeline,
 * posts scored comment to the associated PR, then clears the batch.
 */

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { loadConfig, getStateDir } from './lib/config.mjs';

const STATE_DIR = getStateDir();
const SESSION_FILE = join(STATE_DIR, 'codepresso-session.json');
const BATCH_FILE = join(STATE_DIR, 'codepresso-batch.jsonl');
const TIMER_FILE = join(STATE_DIR, 'codepresso-batch-timer.json');
const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // 1. Read session
  let session;
  try {
    session = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    console.error('No session state found. Is Codepresso running?');
    process.exit(1);
  }

  if (!session.prNumber) {
    console.error(`No PR associated with this session (branch: ${session.branch || 'unknown'}).`);
    process.exit(1);
  }

  // 2. Read batch entries
  let entries = [];
  try {
    const content = readFileSync(BATCH_FILE, 'utf-8').trim();
    if (content) {
      entries = content.split('\n').map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
    }
  } catch {
    // No batch file
  }

  if (entries.length === 0) {
    console.log('No pending prompts to flush.');
    process.exit(0);
  }

  console.log(`Flushing ${entries.length} prompt(s) to PR #${session.prNumber}...`);

  // 3. Build payload and run score-and-post synchronously
  const config = loadConfig();
  const scoringConfig = config.scoring || {};
  const payload = {
    entries,
    meta: {
      branch: session.branch,
      sessionId: session.sessionId,
      cwd: session.gitRoot || process.cwd(),
    },
    prNumber: session.prNumber,
    scoringEnabled: scoringConfig.enabled !== false,
    scoringModel: scoringConfig.model || null,
    scoringBackend: scoringConfig.backend || 'anthropic',
    scoringAwsRegion: scoringConfig.awsRegion || 'us-east-1',
  };

  const tmpFile = join(STATE_DIR, `codepresso-flush-manual-${Date.now()}.json`);
  writeFileSync(tmpFile, JSON.stringify(payload), 'utf-8');

  const scriptPath = join(__dirname, 'score-and-post.mjs');
  try {
    execSync(`node "${scriptPath}" "${tmpFile}"`, {
      cwd: session.gitRoot || process.cwd(),
      timeout: 60000,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('Scoring/posting failed:', err.message);
    // Clean up temp file if score-and-post didn't
    try { unlinkSync(tmpFile); } catch {}
    process.exit(1);
  }

  // 4. Clear batch and timer
  try { unlinkSync(BATCH_FILE); } catch {}
  try { unlinkSync(TIMER_FILE); } catch {}

  console.log(`Done. Posted scored summary to PR #${session.prNumber}.`);
}

main();
