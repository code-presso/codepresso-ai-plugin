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
