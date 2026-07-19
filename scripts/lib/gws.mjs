import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from './logger.mjs';

const logger = createLogger('gws');

/**
 * Send a Google Chat message via the `gws` CLI.
 *
 * On Windows, `gws` is installed as `gws.cmd`. Node.js (post CVE-2024-27980)
 * refuses to spawn `.cmd`/`.bat` without `shell: true`, and cmd.exe mangles
 * JSON payloads that contain quotes and newlines. To stay cross-platform,
 * this helper writes the params/body JSON to temp files and invokes `gws`
 * through `bash` (available via Git Bash on Windows) using `"$(cat ...)"`.
 *
 * Throws on failure; caller is responsible for logging.
 *
 * @param {string} spaceId  Google Chat space id (e.g. "AAAAxQcYA-o").
 * @param {string} message  Plain text body for the chat message.
 * @param {{ timeout?: number }} [opts]
 */
export function sendChatMessage(spaceId, message, opts = {}) {
  const timeout = opts.timeout ?? 15000;
  const tmp = mkdtempSync(join(tmpdir(), 'codepresso-gws-'));
  const paramsPath = join(tmp, 'params.json');
  const bodyPath = join(tmp, 'body.json');
  writeFileSync(paramsPath, JSON.stringify({ parent: `spaces/${spaceId}` }), 'utf-8');
  writeFileSync(bodyPath, JSON.stringify({ text: message }), 'utf-8');
  try {
    const paramsArg = paramsPath.replace(/\\/g, '/');
    const bodyArg = bodyPath.replace(/\\/g, '/');
    const cmd = `gws chat spaces messages create --params "$(cat '${paramsArg}')" --json "$(cat '${bodyArg}')"`;
    execSync(cmd, { shell: 'bash', timeout, stdio: 'pipe' });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function defaultRunner(cmd) {
  return execSync(cmd, { shell: 'bash', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

/**
 * Fetch unread Google Chat messages from one or more spaces via the `gws` CLI.
 *
 * DI-friendly: accepts an optional `runner` function for unit testing.
 * Production callers omit `runner` and the real execSync wrapper is used.
 *
 * @param {{ spaceIds: string[], sinceIso: string, maxPerSpace: number, runner?: (cmd: string) => string }} opts
 * @returns {{ id: string, source: 'chat', from: string, subject: string, snippet: string, sourceUrl: string, scannedAt: string }[]}
 */
export function fetchChatUnread({ spaceIds, sinceIso, maxPerSpace, runner = defaultRunner }) {
  if (!Array.isArray(spaceIds) || spaceIds.length === 0) return [];

  // Fix 2 (sinceIso validation) — validate once before the loop
  if (typeof sinceIso !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(sinceIso)) {
    logger.warn(`fetchChatUnread: invalid sinceIso "${sinceIso}"`);
    return [];
  }

  // Fix 3 — capture scannedAt once before the loop
  const scannedAt = new Date().toISOString();

  const results = [];
  let attempted = 0;
  let failed = 0;
  for (const spaceId of spaceIds) {
    // Fix 1 — shell injection defense: validate spaceId before interpolating
    if (!/^[A-Za-z0-9_-]+$/.test(spaceId)) {
      logger.warn(`fetchChatUnread: skipping invalid spaceId "${spaceId}"`);
      continue;
    }
    attempted += 1;

    // The gws CLI takes every URL/query parameter through a single --params JSON
    // blob; it has no --parent/--filter/--page-size flags. Passing those as bare
    // flags makes gws exit non-zero ("unexpected argument '--parent' found"),
    // which this loop would then swallow as "no messages".
    // spaceId and sinceIso are both validated above, so neither can contain a
    // single quote that would break out of the shell quoting below.
    const params = JSON.stringify({
      parent: `spaces/${spaceId}`,
      filter: `createTime > "${sinceIso}"`,
      pageSize: maxPerSpace,
    });
    const cmd = `gws chat spaces messages list --params '${params}' --format json`;
    let raw;
    try {
      raw = runner(cmd);
    } catch (err) {
      // Fix 2 — log runner failures instead of swallowing silently
      failed += 1;
      logger.warn(`fetchChatUnread: runner failed for spaces/${spaceId} — ${err.message}`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw || '{}');
    } catch (err) {
      // Fix 2 — log parse failures instead of swallowing silently
      failed += 1;
      logger.warn(`fetchChatUnread: JSON parse failed for spaces/${spaceId} — ${err.message}`);
      continue;
    }
    const messages = parsed.messages || [];
    for (const m of messages) {
      results.push({
        id: m.name,
        source: 'chat',
        from: m.sender?.displayName || m.sender?.name || 'unknown',
        subject: null, // Fix 4 — Chat messages have no subject concept
        snippet: (m.text || '').slice(0, 500),
        // Fix 5 — Note: Google Chat permalinks require threadId; this approximation links to space root.
        sourceUrl: `https://chat.google.com/room/${spaceId}`,
        scannedAt, // Fix 3 — reuse single timestamp
      });
    }
  }

  // A total wipeout means the CLI contract is broken (wrong flags, missing auth,
  // gws not installed) — not "the spaces were quiet". Returning [] there is how a
  // stale --parent/--filter invocation went unnoticed across every space for weeks.
  // Partial failures stay tolerated: one 403 space shouldn't sink the whole scan.
  if (attempted > 0 && failed === attempted) {
    throw new Error(
      `fetchChatUnread: all ${attempted} space(s) failed — gws CLI is unusable, not merely empty. See warnings above.`,
    );
  }
  return results;
}
