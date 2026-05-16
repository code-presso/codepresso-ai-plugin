import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  const results = [];
  for (const spaceId of spaceIds) {
    const filter = `createTime > "${sinceIso}"`;
    const cmd =
      `gws chat spaces messages list --parent "spaces/${spaceId}" ` +
      `--filter '${filter}' --page-size ${maxPerSpace} --format json`;
    let raw;
    try {
      raw = runner(cmd);
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw || '{}');
    } catch {
      continue;
    }
    const messages = parsed.messages || [];
    for (const m of messages) {
      results.push({
        id: m.name,
        source: 'chat',
        from: m.sender?.displayName || m.sender?.name || 'unknown',
        subject: '',
        snippet: (m.text || '').slice(0, 500),
        sourceUrl: `https://chat.google.com/room/${spaceId}/${m.name?.split('/').pop() || ''}`,
        scannedAt: new Date().toISOString(),
      });
    }
  }
  return results;
}
