/**
 * Lightweight helper to read gitRoot from the cached session file.
 * Other hooks import this instead of re-computing getGitRoot().
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getStateDir } from './config.mjs';

const SESSION_FILE = join(getStateDir(), 'codepresso-session.json');

/**
 * Read the gitRoot from the cached session state.
 * Falls back to process.cwd() if session file is missing or has no gitRoot.
 * @returns {string} Absolute path to the git root
 */
export function getSessionGitRoot() {
  try {
    const session = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
    return session.gitRoot || process.cwd();
  } catch {
    return process.cwd();
  }
}
