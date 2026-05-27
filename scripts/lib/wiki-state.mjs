/**
 * wiki-state.mjs — Pure helpers for LLM Wiki fetch-status state.
 * Reading and formatting are kept deterministic so they can be unit-tested
 * without touching the filesystem or spawning child processes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const WIKI_STATUS_FILE = join(homedir(), '.codepresso', 'wiki-status.json');

/**
 * Read and parse wiki-status.json.
 * Returns the parsed object, or null on any error (missing file, corrupt JSON, etc.).
 * @param {string} [file] - Path to the status file (defaults to WIKI_STATUS_FILE)
 * @returns {object|null}
 */
export function readWikiStatus(file = WIKI_STATUS_FILE) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Format a one-time staleness notice for Claude to surface to the user.
 * Returns null when no notice should be shown (status missing, error set, or behind <= 0).
 *
 * @param {object|null|undefined} status
 * @returns {string|null}
 */
export function formatWikiNotice(status) {
  if (!status) return null;
  if (status.error) return null;
  const behind = status.behind;
  if (typeof behind !== 'number' || !Number.isInteger(behind) || behind <= 0) return null;

  const upstream = status.upstream || 'upstream';
  const vaultPath = status.vaultPath || '';

  return [
    `[Codepresso] 📚 LLM Wiki가 원격보다 ${behind} commit 뒤처져 있습니다 (${upstream}).`,
    ``,
    `INSTRUCTIONS:`,
    `1. 사용자에게 위 사실을 알리고, 지금 동기화할지 물어보세요 (예/아니오).`,
    `2. "예"면 다음을 실행: git -C "${vaultPath}" pull --ff-only`,
    `   - ff-only가 실패(diverged)하면 자동 병합하지 말고, 충돌 가능성을 알린 뒤 사용자에게 수동 처리를 맡기세요.`,
    `3. "아니오"면 그냥 진행하세요. 알림은 다음 동기화 전까지 세션마다 다시 표시될 수 있습니다.`,
  ].join('\n');
}
