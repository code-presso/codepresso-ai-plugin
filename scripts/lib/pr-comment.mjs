import { readFileSync, writeFileSync, appendFileSync, unlinkSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadConfig } from './config.mjs';
import { redactSecrets } from './redactor.mjs';
import { canPost, recordPost } from './rate-limiter.mjs';

const STATE_DIR = join(process.cwd(), '.omc', 'state');
const BATCH_FILE = join(STATE_DIR, 'codepresso-batch.jsonl');
const TIMER_FILE = join(STATE_DIR, 'codepresso-batch-timer.json');
const LOCK_FILE = join(STATE_DIR, 'codepresso-flush.lock');
const LOCK_STALE_MS = 30000; // 30 seconds
const SIDECAR_PREFIX = 'codepresso-prepr-';

// --- Sidecar helpers (pre-PR prompt persistence) ---

function branchToSlug(branch) {
  return branch.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase().slice(0, 80);
}

export function getSidecarPath(branch) {
  return join(STATE_DIR, `${SIDECAR_PREFIX}${branchToSlug(branch)}.jsonl`);
}

function readSidecar(branch) {
  if (!branch) return [];
  try {
    const content = readFileSync(getSidecarPath(branch), 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function writeSidecar(entries, branch) {
  if (!branch || entries.length === 0) return;
  ensureStateDir();
  const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  appendFileSync(getSidecarPath(branch), lines, 'utf-8');
}

function clearSidecar(branch) {
  if (!branch) return;
  try { unlinkSync(getSidecarPath(branch)); } catch { /* may not exist */ }
}

/**
 * Ensure state directory exists.
 */
function ensureStateDir() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

/**
 * Append a prompt entry to the batch file.
 * @param {{ timestamp: string, prompt: string, sessionId?: string }} entry
 * @param {string[]} extraRedactPatterns
 */
export function appendToBatch(entry, extraRedactPatterns = []) {
  ensureStateDir();
  const sanitized = {
    ...entry,
    prompt: extraRedactPatterns === null
      ? entry.prompt
      : redactSecrets(entry.prompt, extraRedactPatterns),
  };
  appendFileSync(BATCH_FILE, JSON.stringify(sanitized) + '\n', 'utf-8');
}

/**
 * Read all entries from the batch file.
 * @returns {Array<{ timestamp: string, prompt: string, sessionId?: string }>}
 */
function readBatch() {
  try {
    const content = readFileSync(BATCH_FILE, 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Clear the batch file.
 */
function clearBatch() {
  try {
    unlinkSync(BATCH_FILE);
  } catch {
    // file may not exist
  }
}

/**
 * Overwrite the batch file with the given entries (used for pending entries after partial flush).
 */
function writeBatch(entries) {
  ensureStateDir();
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(BATCH_FILE, content, 'utf-8');
}

/**
 * Read/write the timer state to track when the batch window started.
 */
function getTimerState() {
  try {
    return JSON.parse(readFileSync(TIMER_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function setTimerState(state) {
  ensureStateDir();
  writeFileSync(TIMER_FILE, JSON.stringify(state), 'utf-8');
}

function clearTimerState() {
  try {
    unlinkSync(TIMER_FILE);
  } catch {
    // file may not exist
  }
}

/**
 * Acquire flush lock. Returns true if acquired, false if already locked.
 * Stale locks (>30s) are automatically removed.
 */
function acquireLock() {
  try {
    // Check for stale lock
    try {
      const stat = statSync(LOCK_FILE);
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        unlinkSync(LOCK_FILE);
      }
    } catch {
      // Lock doesn't exist — good
    }

    // Atomic create (wx flag fails if file exists)
    writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false; // Lock already held
  }
}

/**
 * Release flush lock.
 */
function releaseLock() {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // Already released
  }
}

/**
 * Format batch entries into a markdown PR comment.
 * @param {Array<{ timestamp: string, prompt: string }>} entries
 * @param {{ branch: string, sessionId?: string }} meta
 * @returns {string}
 */
function formatBatchComment(entries, meta) {
  const sessionLabel = meta.sessionId
    ? meta.sessionId.slice(0, 8)
    : 'unknown';

  const rows = entries.map((e) => {
    const time = new Date(e.timestamp).toISOString().split('T')[1].replace('Z', '').slice(0, 8);
    const prompt = e.prompt.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    return `| ${time} | ${prompt} |`;
  });

  return [
    '### :robot: Claude Code Activity Log',
    '',
    `**Session:** \`${sessionLabel}\` | **Branch:** \`${meta.branch}\``,
    '',
    '| Time (UTC) | Prompt |',
    '|------------|--------|',
    ...rows,
    '',
    '---',
    '<sub>Logged by Codepresso</sub>',
  ].join('\n');
}

/**
 * Post a comment to a PR using a detached gh process (fire-and-forget).
 * @param {number} prNumber
 * @param {string} body
 * @param {string} [cwd]
 */
function postComment(prNumber, body, cwd = process.cwd()) {
  const child = spawn('gh', ['pr', 'comment', String(prNumber), '--body', body], {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

/**
 * Check rate limits before posting. Returns false if rate-limited.
 * @param {number} prNumber
 * @param {{ maxCommentsPerHour?: number, maxCommentsPerSession?: number }} rateLimitConfig
 * @returns {boolean}
 */
function checkRateLimit(prNumber, rateLimitConfig = {}) {
  if (!canPost(prNumber, rateLimitConfig)) return false;
  recordPost(prNumber);
  return true;
}

/**
 * Score prompts and post to PR via detached process.
 * @param {Array<{ timestamp: string, prompt: string }>} entries
 * @param {{ branch: string, sessionId?: string, cwd?: string }} meta
 * @param {number} prNumber
 */
function scoreAndPost(entries, meta, prNumber) {
  const scoringConfig = loadConfig().scoring || {};
  const payload = {
    entries,
    meta: { ...meta, cwd: meta.cwd || process.cwd() },
    prNumber,
    scoringEnabled: scoringConfig.enabled !== false,
    scoringModel: scoringConfig.model || null,
    scoringBackend: scoringConfig.backend || 'anthropic',
    scoringAwsRegion: scoringConfig.awsRegion || 'us-east-1',
  };

  const tmpFile = join(STATE_DIR, `codepresso-flush-${Date.now()}.json`);
  writeFileSync(tmpFile, JSON.stringify(payload), 'utf-8');

  const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'score-and-post.mjs');

  const child = spawn('node', [scriptPath, tmpFile], {
    cwd: meta.cwd || process.cwd(),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

/**
 * Check if the batch should be flushed based on interval and size.
 * If ready, flush and post the comment. Non-blocking.
 *
 * @param {{ prNumber: number, branch: string, sessionId?: string, gitRoot?: string }} session
 * @param {{ batchIntervalSeconds?: number, maxBatchSize?: number }} config
 */
export function flushIfReady(session, config = {}) {
  const maxSize = config.maxBatchSize || 10;
  const intervalMs = (config.batchIntervalSeconds || 60) * 1000;

  const entries = readBatch();
  if (entries.length === 0) return;

  const timerState = getTimerState();
  const now = Date.now();

  if (!timerState) {
    setTimerState({ startedAt: now });
  }

  const startedAt = timerState ? timerState.startedAt : now;
  const elapsed = now - startedAt;
  const shouldFlush = entries.length >= maxSize || elapsed >= intervalMs;

  if (!shouldFlush) return;
  if (!acquireLock()) return;

  try {
    const rateLimitConfig = config.rateLimit || {};

    if (!checkRateLimit(session.prNumber, rateLimitConfig)) {
      return;
    }

    // Merge sidecar entries (pre-PR planning prompts)
    const sidecarEntries = readSidecar(session.branch);
    const allEntries = sidecarEntries.length > 0
      ? [...sidecarEntries, ...entries]
      : entries;

    scoreAndPost(allEntries, {
      branch: session.branch,
      sessionId: session.sessionId,
      cwd: session.gitRoot,
    }, session.prNumber);

    if (sidecarEntries.length > 0) {
      clearSidecar(session.branch);
    }

    const prLabelsConfig = loadConfig().prLabels || {};
    if (prLabelsConfig.enabled !== false) {
      applyPrLabels(session.prNumber, prLabelsConfig.labels, session.gitRoot);
    }

    clearBatch();
    clearTimerState();
  } finally {
    releaseLock();
  }
}

/**
 * Force-flush whatever is in the batch, regardless of timer/size.
 * Used by the manual `codepresso:log` skill and Stop hook.
 *
 * @param {{ prNumber: number, branch: string, sessionId?: string, gitRoot?: string }} session
 */
export function forceFlush(session) {
  const entries = readBatch();
  if (entries.length === 0) return;

  // No PR yet — persist to sidecar for future sessions
  if (!session.prNumber) {
    if (session.branch) {
      writeSidecar(entries, session.branch);
    }
    clearBatch();
    clearTimerState();
    return;
  }

  if (!acquireLock()) return;

  try {
    const rateLimitConfig = loadConfig().rateLimit || {};

    if (!checkRateLimit(session.prNumber, rateLimitConfig)) {
      clearBatch();
      clearTimerState();
      return;
    }

    // Merge sidecar entries (pre-PR planning prompts)
    const sidecarEntries = readSidecar(session.branch);
    const allEntries = sidecarEntries.length > 0
      ? [...sidecarEntries, ...entries]
      : entries;

    scoreAndPost(allEntries, {
      branch: session.branch,
      sessionId: session.sessionId,
      cwd: session.gitRoot,
    }, session.prNumber);

    if (sidecarEntries.length > 0) {
      clearSidecar(session.branch);
    }

    const prLabelsConfig = loadConfig().prLabels || {};
    if (prLabelsConfig.enabled !== false) {
      applyPrLabels(session.prNumber, prLabelsConfig.labels, session.gitRoot);
    }

    clearBatch();
    clearTimerState();
  } finally {
    releaseLock();
  }
}

/**
 * Post a standalone git operation comment to a PR.
 * @param {number} prNumber
 * @param {{ hash: string, message: string, timestamp: string }} commit
 * @param {string} [cwd]
 */
export function postGitComment(prNumber, commit, cwd = process.cwd()) {
  const body = [
    '### :robot: Git Activity',
    '',
    `**Commit:** \`${commit.hash}\` \u2014 ${commit.message}`,
    `**Time:** ${commit.timestamp}`,
    '',
    '---',
    '<sub>Logged by Codepresso</sub>',
  ].join('\n');

  postComment(prNumber, body, cwd);
}

/**
 * Apply labels to a PR (fire-and-forget).
 * Tracks via simple boolean to avoid re-applying this session.
 * @param {number} prNumber
 * @param {string[]} labels
 * @param {string} [cwd]
 */
export function applyPrLabels(prNumber, labels, cwd = process.cwd()) {
  if (!labels || labels.length === 0) return;

  const sessionFile = join(STATE_DIR, 'codepresso-session.json');
  try {
    const session = JSON.parse(readFileSync(sessionFile, 'utf-8'));
    if (session.labelsApplied) return; // Already applied this session

    session.labelsApplied = true;
    writeFileSync(sessionFile, JSON.stringify(session, null, 2), 'utf-8');
  } catch {
    return;
  }

  const args = ['pr', 'edit', String(prNumber), ...labels.flatMap((l) => ['--add-label', l])];
  const child = spawn('gh', args, {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
