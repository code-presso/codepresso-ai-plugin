/**
 * Rate limiter for PR comment posting.
 * Tracks comment count per PR per hour and per session.
 * State stored in .codepresso/state/codepresso-rate-limit.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getStateDir } from './config.mjs';

const STATE_DIR = getStateDir();
const RATE_FILE = join(STATE_DIR, 'codepresso-rate-limit.json');
const ONE_HOUR_MS = 3600000;

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
 * Read rate limit state from disk.
 * @returns {Object} State keyed by PR number
 */
function readState() {
  try {
    return JSON.parse(readFileSync(RATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Write rate limit state to disk.
 * @param {Object} state
 */
function writeState(state) {
  ensureStateDir();
  writeFileSync(RATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Check if we can post a comment to the given PR.
 * @param {number} prNumber
 * @param {{ maxCommentsPerHour?: number, maxCommentsPerSession?: number }} config
 * @returns {boolean} True if posting is allowed
 */
export function canPost(prNumber, config = {}) {
  const maxPerHour = config.maxCommentsPerHour || 10;
  const maxPerSession = config.maxCommentsPerSession || 50;
  const key = String(prNumber);

  const state = readState();
  const prState = state[key];

  if (!prState) return true; // No history = allowed

  const now = Date.now();

  // Filter hourly timestamps to only the last hour
  const recentPosts = (prState.hourly || []).filter(
    (ts) => now - ts < ONE_HOUR_MS
  );

  if (recentPosts.length >= maxPerHour) return false;
  if ((prState.sessionTotal || 0) >= maxPerSession) return false;

  return true;
}

/**
 * Record that a comment was posted to a PR.
 * @param {number} prNumber
 */
export function recordPost(prNumber) {
  const key = String(prNumber);
  const state = readState();
  const now = Date.now();

  if (!state[key]) {
    state[key] = { hourly: [], sessionTotal: 0 };
  }

  // Clean up old hourly entries
  state[key].hourly = (state[key].hourly || [])
    .filter((ts) => now - ts < ONE_HOUR_MS);

  // Record new post
  state[key].hourly.push(now);
  state[key].sessionTotal = (state[key].sessionTotal || 0) + 1;

  writeState(state);
}

/**
 * Reset rate limit state for a PR (e.g., on session start).
 * @param {number} prNumber
 */
export function resetForSession(prNumber) {
  const key = String(prNumber);
  const state = readState();

  if (state[key]) {
    state[key].sessionTotal = 0;
    writeState(state);
  }
}
