# AWS MFA Session Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude reactively mint and cache a short-lived (1h) MFA-backed AWS session so every AWS channel (cloud-dev MCP, raw `aws` CLI, other AWS MCP) keeps working under MFA enforcement.

**Architecture:** A `credential_process` helper wired into the `~/.aws/config` `[default]` profile serves a cached session file. The long-lived key is relocated to `[codepresso-source]` and used only to mint sessions. When an AWS call fails because the cache is missing/expired, the cloud-dev MCP error path and the PostToolUse:Bash hook detect it and instruct Claude to run `/codepresso:aws-login`, which prompts for the 6-digit code, refreshes the cache, and retries.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert`, AWS CLI (`aws sts get-session-token`, `aws iam list-mfa-devices`), `@aws-sdk/client-ec2` (existing).

**Spec:** `docs/superpowers/specs/2026-06-15-aws-mfa-session-helper-design.md`

---

## File Structure

- `scripts/lib/aws-session.mjs` (new) — pure lib: path/expiry/cache/parse/redact/detection. The brain.
- `scripts/lib/aws-ini.mjs` (new) — pure lib: safe `~/.aws` INI section rename/upsert.
- `scripts/aws-cred-process.mjs` (new) — credential_process entry (cache → AWS JSON or exit 1).
- `scripts/aws-cli.mjs` (new) — dispatcher: `status` / `detect-mfa` / `refresh` / `setup`.
- `skills/aws-login/SKILL.md` (new) — the refresh skill.
- `scripts/lib/config.mjs` (modify) — add `aws` defaults + `'aws'` to `KNOWN_KEYS`.
- `mcp/cloud-dev-server.mjs` (modify) — classify MFA errors in the catch block.
- `scripts/post-tool-git-watcher.mjs` (modify) — AWS-deny detection before the `prNumber` gate.
- `tests/lib/aws-session.test.mjs`, `tests/lib/aws-ini.test.mjs`, `tests/lib/aws-cred-process.test.mjs` (new).
- `skills/setup/SKILL.md`, `CLAUDE.md` (modify) — wire setup + document.

All paths are relative to the repo root `/Users/kwm/Documents/GitHub/codepresso-ai-plugin`.

---

## Task 1: Config defaults

**Files:**
- Modify: `scripts/lib/config.mjs` (DEFAULT_CONFIG ~line 12; KNOWN_KEYS ~line 224)

- [ ] **Step 1: Add the `aws` section to `DEFAULT_CONFIG`**

Insert after the `cloudDev` section object:

```js
  aws: {
    enabled: false,                                 // flipped true by `aws-cli setup`
    sourceProfile: 'codepresso-source',
    mfaSerial: null,                                // detected at setup, e.g. arn:aws:iam::ACCT:mfa/<name>
    sessionTtlSeconds: 3600,
    sessionFile: '~/.codepresso/aws-session.json',
    region: 'ap-northeast-2',
  },
```

- [ ] **Step 2: Add `'aws'` to `KNOWN_KEYS` in `validateConfig`**

Change the array so it includes `'aws'`:

```js
  const KNOWN_KEYS = ['github', 'notion', 'deploy', 'epicDocs', 'cloudDev', 'googleChat', 'inbox', 'wiki', 'aws', 'excludePatterns', 'debug'];
```

- [ ] **Step 3: Verify config still loads**

Run: `node -e "import('./scripts/lib/config.mjs').then(m=>console.log(JSON.stringify(m.loadConfig().aws)))"`
Expected: `{"enabled":false,"sourceProfile":"codepresso-source","mfaSerial":null,"sessionTtlSeconds":3600,"sessionFile":"~/.codepresso/aws-session.json","region":"ap-northeast-2"}`

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/config.mjs
git commit -m "feat(aws): add aws config section defaults"
```

---

## Task 2: aws-session lib — paths, expiry, cache I/O

**Files:**
- Create: `scripts/lib/aws-session.mjs`
- Test: `tests/lib/aws-session.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandHome, isSessionValid, readCache, writeCache } from '../../scripts/lib/aws-session.mjs';

test('expandHome expands leading ~', () => {
  assert.ok(expandHome('~/x').endsWith('/x'));
  assert.ok(!expandHome('~/x').startsWith('~'));
  assert.strictEqual(expandHome('/abs/x'), '/abs/x');
});

test('isSessionValid honors expiry minus skew', () => {
  const exp = new Date(Date.now() + 120000).toISOString(); // +2 min
  assert.strictEqual(isSessionValid({ AccessKeyId: 'A', Expiration: exp }), true);
  const soon = new Date(Date.now() + 30000).toISOString();  // +30s, inside 60s skew
  assert.strictEqual(isSessionValid({ AccessKeyId: 'A', Expiration: soon }), false);
  assert.strictEqual(isSessionValid(null), false);
  assert.strictEqual(isSessionValid({ Expiration: 'nope' }), false);
});

test('writeCache writes atomically with 0600 and readCache roundtrips', () => {
  const dir = mkdtempSync(join(tmpdir(), 'awssess-'));
  const file = join(dir, 'aws-session.json');
  const cache = { AccessKeyId: 'A', SecretAccessKey: 'S', SessionToken: 'T', Expiration: '2030-01-01T00:00:00Z' };
  writeCache(file, cache);
  assert.deepStrictEqual(readCache(file), cache);
  assert.strictEqual(statSync(file).mode & 0o777, 0o600);
  assert.strictEqual(readCache(join(dir, 'missing.json')), null);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test tests/lib/aws-session.test.mjs`
Expected: FAIL — cannot find module `aws-session.mjs`.

- [ ] **Step 3: Implement the lib (first slice)**

```js
// scripts/lib/aws-session.mjs
import { readFileSync, writeFileSync, renameSync, chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export function expandHome(p) {
  if (!p) return p;
  return p.startsWith('~') ? join(homedir(), p.slice(1).replace(/^[/\\]/, '')) : p;
}

export function getSessionFile(config) {
  return expandHome(config?.aws?.sessionFile || '~/.codepresso/aws-session.json');
}

export function isSessionValid(cache, nowMs = Date.now(), skewSeconds = 60) {
  if (!cache || !cache.Expiration || !cache.AccessKeyId) return false;
  const exp = Date.parse(cache.Expiration);
  if (Number.isNaN(exp)) return false;
  return nowMs < exp - skewSeconds * 1000;
}

export function readCache(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeCache(file, cache) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test tests/lib/aws-session.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/aws-session.mjs tests/lib/aws-session.test.mjs
git commit -m "feat(aws): session lib paths/expiry/cache I/O"
```

---

## Task 3: aws-session lib — STS/MFA parsing, cred-process output, redaction

**Files:**
- Modify: `scripts/lib/aws-session.mjs`
- Test: `tests/lib/aws-session.test.mjs`

- [ ] **Step 1: Append failing tests**

```js
import { parseStsSessionToken, parseMfaSerial, toCredentialProcessOutput, redact } from '../../scripts/lib/aws-session.mjs';

test('parseStsSessionToken maps Credentials → cache shape', () => {
  const sts = { Credentials: { AccessKeyId: 'ASIA', SecretAccessKey: 'sk', SessionToken: 'tok', Expiration: '2030-01-01T00:00:00Z' } };
  assert.deepStrictEqual(parseStsSessionToken(sts), { AccessKeyId: 'ASIA', SecretAccessKey: 'sk', SessionToken: 'tok', Expiration: '2030-01-01T00:00:00Z' });
  assert.deepStrictEqual(parseStsSessionToken(JSON.stringify(sts)).AccessKeyId, 'ASIA');
  assert.throws(() => parseStsSessionToken({ Credentials: {} }));
});

test('parseMfaSerial picks the virtual TOTP (:mfa/), ignores passkey (:u2f/)', () => {
  const j = { MFADevices: [
    { SerialNumber: 'arn:aws:iam::1:u2f/user/x/passkey-AAA' },
    { SerialNumber: 'arn:aws:iam::1:mfa/maphone' },
  ] };
  assert.strictEqual(parseMfaSerial(j), 'arn:aws:iam::1:mfa/maphone');
  assert.strictEqual(parseMfaSerial({ MFADevices: [{ SerialNumber: 'arn:aws:iam::1:u2f/x' }] }), null);
  assert.strictEqual(parseMfaSerial({ MFADevices: [] }), null);
});

test('toCredentialProcessOutput emits AWS Version:1 shape', () => {
  const cache = { AccessKeyId: 'A', SecretAccessKey: 'S', SessionToken: 'T', Expiration: 'E' };
  assert.deepStrictEqual(toCredentialProcessOutput(cache), { Version: 1, AccessKeyId: 'A', SecretAccessKey: 'S', SessionToken: 'T', Expiration: 'E' });
});

test('redact masks secret-bearing keys', () => {
  const r = redact({ AccessKeyId: 'ASIAabcd1234', SecretAccessKey: 'supersecretvalue', Expiration: 'E' });
  assert.strictEqual(r.Expiration, 'E');
  assert.ok(!r.SecretAccessKey.includes('supersecretvalue'));
  assert.ok(r.SecretAccessKey.includes('REDACTED'));
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test tests/lib/aws-session.test.mjs`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Append implementation to `aws-session.mjs`**

```js
export function parseStsSessionToken(input) {
  const obj = typeof input === 'string' ? JSON.parse(input) : input;
  const c = obj && obj.Credentials;
  if (!c || !c.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration) {
    throw new Error('Invalid get-session-token output');
  }
  return { AccessKeyId: c.AccessKeyId, SecretAccessKey: c.SecretAccessKey, SessionToken: c.SessionToken, Expiration: c.Expiration };
}

export function parseMfaSerial(input) {
  const obj = typeof input === 'string' ? JSON.parse(input) : input;
  const devices = (obj && obj.MFADevices) || [];
  const totp = devices.find((d) => typeof d.SerialNumber === 'string' && d.SerialNumber.includes(':mfa/'));
  return totp ? totp.SerialNumber : null;
}

export function toCredentialProcessOutput(cache) {
  return {
    Version: 1,
    AccessKeyId: cache.AccessKeyId,
    SecretAccessKey: cache.SecretAccessKey,
    SessionToken: cache.SessionToken,
    Expiration: cache.Expiration,
  };
}

const SECRET_KEY = /SecretAccessKey|SessionToken|AccessKeyId|aws_secret|aws_access_key|token/i;
export function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY.test(k) && typeof v === 'string') {
      out[k] = v.length <= 4 ? '****' : `${v.slice(0, 4)}…REDACTED…`;
    } else if (v && typeof v === 'object') {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test tests/lib/aws-session.test.mjs`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/aws-session.mjs tests/lib/aws-session.test.mjs
git commit -m "feat(aws): STS/MFA parsing, cred-process output, redaction"
```

---

## Task 4: aws-session lib — reactive detection classifiers

**Files:**
- Modify: `scripts/lib/aws-session.mjs`
- Test: `tests/lib/aws-session.test.mjs`

- [ ] **Step 1: Append failing tests**

```js
import { shouldPromptMfa, isMfaCredentialError } from '../../scripts/lib/aws-session.mjs';

test('shouldPromptMfa only fires on signature AND invalid cache', () => {
  const deny = 'User: ... is not authorized ... with an explicit deny in an identity-based policy';
  assert.strictEqual(shouldPromptMfa(deny, { cacheValid: false }), true);
  assert.strictEqual(shouldPromptMfa(deny, { cacheValid: true }), false);   // real authz error, not MFA
  assert.strictEqual(shouldPromptMfa('ExpiredToken: token expired', { cacheValid: false }), true);
  assert.strictEqual(shouldPromptMfa('some unrelated output', { cacheValid: false }), false);
});

test('isMfaCredentialError matches credential/expiry/deny errors', () => {
  assert.strictEqual(isMfaCredentialError({ name: 'CredentialsProviderError', message: '' }), true);
  assert.strictEqual(isMfaCredentialError({ name: 'ExpiredTokenException', message: 'x' }), true);
  assert.strictEqual(isMfaCredentialError({ name: 'ValidationError', message: 'bad param' }), false);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test tests/lib/aws-session.test.mjs`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Append implementation**

```js
export const MFA_SIGNATURES = /CredentialsProviderError|credential_process|ExpiredToken|TokenRefreshRequired|with an explicit deny/i;

export function shouldPromptMfa(output, { cacheValid }) {
  if (cacheValid) return false;
  return MFA_SIGNATURES.test(String(output || ''));
}

export function isMfaCredentialError(error) {
  const text = `${(error && error.name) || ''} ${(error && error.message) || ''}`;
  return /CredentialsProviderError|ExpiredToken|ExpiredTokenException|TokenRefreshRequired|InvalidClientTokenId|UnrecognizedClient|with an explicit deny|AccessDenied/i.test(text);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test tests/lib/aws-session.test.mjs`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/aws-session.mjs tests/lib/aws-session.test.mjs
git commit -m "feat(aws): reactive MFA detection classifiers"
```

---

## Task 5: credential_process entry

**Files:**
- Create: `scripts/aws-cred-process.mjs`
- Test: `tests/lib/aws-cred-process.test.mjs`

The cache path is read from `AWS_CRED_PROCESS_SESSION_FILE` if set (for tests), else from `loadConfig().aws.sessionFile`.

- [ ] **Step 1: Write failing test (spawns the script)**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'aws-cred-process.mjs');

function run(file) {
  return execFileSync('node', [SCRIPT], { env: { ...process.env, AWS_CRED_PROCESS_SESSION_FILE: file }, encoding: 'utf-8' });
}

test('valid cache → emits Version:1 JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cp-'));
  const file = join(dir, 's.json');
  writeFileSync(file, JSON.stringify({ AccessKeyId: 'ASIA', SecretAccessKey: 'sk', SessionToken: 'tok', Expiration: new Date(Date.now() + 600000).toISOString() }));
  const out = JSON.parse(run(file));
  assert.strictEqual(out.Version, 1);
  assert.strictEqual(out.AccessKeyId, 'ASIA');
  rmSync(dir, { recursive: true, force: true });
});

test('missing/expired cache → non-zero exit, no secret on stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cp-'));
  const file = join(dir, 'missing.json');
  let threw = false;
  try { run(file); } catch (e) {
    threw = true;
    assert.ok(!String(e.stdout || '').includes('SecretAccessKey'));
  }
  assert.ok(threw);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test tests/lib/aws-cred-process.test.mjs`
Expected: FAIL — script not found / non-zero on valid case.

- [ ] **Step 3: Implement `scripts/aws-cred-process.mjs`**

```js
#!/usr/bin/env node
// AWS credential_process entry. Emits cached MFA session creds, or exits 1.
import { loadConfig } from './lib/config.mjs';
import { getSessionFile, readCache, isSessionValid, toCredentialProcessOutput } from './lib/aws-session.mjs';

function main() {
  const file = process.env.AWS_CRED_PROCESS_SESSION_FILE || getSessionFile(loadConfig());
  const cache = readCache(file);
  if (!isSessionValid(cache)) {
    process.stderr.write('codepresso: no valid AWS MFA session — run /codepresso:aws-login\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(toCredentialProcessOutput(cache)));
}

main();
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test tests/lib/aws-cred-process.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/aws-cred-process.mjs tests/lib/aws-cred-process.test.mjs
git commit -m "feat(aws): credential_process entry"
```

---

## Task 6: aws-ini lib — safe ~/.aws section editing

**Files:**
- Create: `scripts/lib/aws-ini.mjs`
- Test: `tests/lib/aws-ini.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { renameSection, upsertSectionKV } from '../../scripts/lib/aws-ini.mjs';

test('renameSection renames header, refuses if target exists', () => {
  const ini = '[default]\naws_access_key_id = AKIA\n';
  assert.strictEqual(renameSection(ini, 'default', 'codepresso-source'), '[codepresso-source]\naws_access_key_id = AKIA\n');
  const both = '[default]\nx = 1\n[codepresso-source]\ny = 2\n';
  assert.strictEqual(renameSection(both, 'default', 'codepresso-source'), both); // no clobber
});

test('upsertSectionKV creates section and updates keys in place', () => {
  let out = upsertSectionKV('', 'default', { credential_process: 'node /p/x.mjs', region: 'ap-northeast-2' });
  assert.ok(out.includes('[default]'));
  assert.ok(out.includes('credential_process = node /p/x.mjs'));
  out = upsertSectionKV(out, 'default', { region: 'us-east-1' });   // update existing key
  assert.ok(out.includes('region = us-east-1'));
  assert.ok(!out.includes('region = ap-northeast-2'));
  assert.strictEqual((out.match(/\[default\]/g) || []).length, 1);  // no duplicate section
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test tests/lib/aws-ini.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scripts/lib/aws-ini.mjs`**

```js
// Minimal INI section editor for ~/.aws files. Pure string transforms.
export function renameSection(text, from, to) {
  const lines = (text || '').split('\n');
  if (lines.some((l) => l.trim() === `[${to}]`)) return text; // never clobber
  return lines.map((l) => (l.trim() === `[${from}]` ? `[${to}]` : l)).join('\n');
}

export function upsertSectionKV(text, section, kv) {
  const lines = (text || '').split('\n');
  const start = lines.findIndex((l) => l.trim() === `[${section}]`);
  if (start === -1) {
    const block = [`[${section}]`, ...Object.entries(kv).map(([k, v]) => `${k} = ${v}`)];
    const base = text && !text.endsWith('\n') ? `${text}\n` : (text || '');
    return `${base}${base ? '\n' : ''}${block.join('\n')}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) { end = i; break; }
  }
  const remaining = { ...kv };
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(/^\s*([A-Za-z0-9_]+)\s*=/);
    if (m && m[1] in remaining) { lines[i] = `${m[1]} = ${remaining[m[1]]}`; delete remaining[m[1]]; }
  }
  const insert = Object.entries(remaining).map(([k, v]) => `${k} = ${v}`);
  lines.splice(end, 0, ...insert);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test tests/lib/aws-ini.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/aws-ini.mjs tests/lib/aws-ini.test.mjs
git commit -m "feat(aws): minimal ~/.aws INI section editor"
```

---

## Task 7: aws-cli — `status` and `detect-mfa`

**Files:**
- Create: `scripts/aws-cli.mjs`

- [ ] **Step 1: Implement the dispatcher with `status` + `detect-mfa`**

```js
#!/usr/bin/env node
// Codepresso AWS MFA session CLI. Commands: status | detect-mfa | refresh | setup
import { execFileSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';
import { getSessionFile, readCache, isSessionValid, parseMfaSerial } from './lib/aws-session.mjs';

function awsJson(args) {
  return JSON.parse(execFileSync('aws', [...args, '--output', 'json'], { encoding: 'utf-8' }));
}

function cmdStatus() {
  const cfg = loadConfig();
  const cache = readCache(getSessionFile(cfg));
  const valid = isSessionValid(cache);
  console.log(JSON.stringify({
    enabled: !!cfg.aws?.enabled,
    sourceProfile: cfg.aws?.sourceProfile,
    mfaSerial: cfg.aws?.mfaSerial,
    sessionValid: valid,
    expiration: cache?.Expiration || null,
  }));
}

function cmdDetectMfa() {
  const cfg = loadConfig();
  const profile = cfg.aws?.sourceProfile || 'codepresso-source';
  const out = awsJson(['iam', 'list-mfa-devices', '--profile', profile]);
  const serial = parseMfaSerial(out);
  console.log(JSON.stringify({ mfaSerial: serial }));
}

const cmd = process.argv[2];
const handlers = { status: cmdStatus, 'detect-mfa': cmdDetectMfa };
if (!handlers[cmd]) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
handlers[cmd]();
```

- [ ] **Step 2: Verify `status` runs without throwing**

Run: `node scripts/aws-cli.mjs status`
Expected: JSON line with `"enabled":false` (no AWS calls made).

- [ ] **Step 3: Commit**

```bash
git add scripts/aws-cli.mjs
git commit -m "feat(aws): aws-cli status + detect-mfa"
```

---

## Task 8: aws-cli — `refresh`

**Files:**
- Modify: `scripts/aws-cli.mjs`

- [ ] **Step 1: Add `refresh` (reuses tested lib for the cache write)**

Add imports and the handler:

```js
import { getSessionFile as _gsf } from './lib/aws-session.mjs'; // already imported above; reuse
import { parseStsSessionToken, writeCache, redact } from './lib/aws-session.mjs';

function cmdRefresh() {
  const cfg = loadConfig();
  const aws = cfg.aws || {};
  if (!aws.mfaSerial) {
    console.error(JSON.stringify({ ok: false, error: 'NO_MFA_SERIAL', hint: 'Register a virtual TOTP, then run: aws-cli detect-mfa' }));
    process.exit(1);
  }
  const i = process.argv.indexOf('--token-code');
  const code = i >= 0 ? process.argv[i + 1] : null;
  if (!code || !/^\d{6}$/.test(code)) {
    console.error(JSON.stringify({ ok: false, error: 'BAD_CODE', hint: 'Pass --token-code <6 digits>' }));
    process.exit(1);
  }
  try {
    const sts = awsJson([
      'sts', 'get-session-token',
      '--profile', aws.sourceProfile || 'codepresso-source',
      '--serial-number', aws.mfaSerial,
      '--token-code', code,
      '--duration-seconds', String(aws.sessionTtlSeconds || 3600),
    ]);
    const cache = parseStsSessionToken(sts);
    writeCache(getSessionFile(cfg), cache);
    console.log(JSON.stringify({ ok: true, expiration: cache.Expiration, redacted: redact(cache) }));
  } catch (e) {
    const msg = String(e.stderr || e.message || '');
    let error = 'REFRESH_FAILED';
    if (/session credentials/i.test(msg)) error = 'TEMP_SESSION';      // running inside temp creds
    else if (/AccessDenied|MultiFactorAuthentication|invalid.*token|not authorized/i.test(msg)) error = 'BAD_OR_DENIED_CODE';
    console.error(JSON.stringify({ ok: false, error, hint: error === 'TEMP_SESSION' ? 'Run from a normal shell (not inside temp credentials).' : 'Check the 6-digit code and retry.' }));
    process.exit(1);
  }
}
```

Register it: `const handlers = { status: cmdStatus, 'detect-mfa': cmdDetectMfa, refresh: cmdRefresh };`

- [ ] **Step 2: Verify guard paths (no AWS call)**

Run: `node scripts/aws-cli.mjs refresh --token-code 12`
Expected: stderr JSON `"error":"BAD_CODE"` (or `NO_MFA_SERIAL` if mfaSerial unset), exit 1.

- [ ] **Step 3: Commit**

```bash
git add scripts/aws-cli.mjs
git commit -m "feat(aws): aws-cli refresh (get-session-token → cache)"
```

---

## Task 9: aws-cli — `setup`

**Files:**
- Modify: `scripts/aws-cli.mjs`

- [ ] **Step 1: Add `setup` (backs up, relocates key, writes credential_process, stores config)**

```js
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renameSection, upsertSectionKV } from './lib/aws-ini.mjs';

function cmdSetup() {
  const cfg = loadConfig();
  const aws = cfg.aws || {};
  const sourceProfile = aws.sourceProfile || 'codepresso-source';
  const region = aws.region || 'ap-northeast-2';
  const awsDir = join(homedir(), '.aws');
  const credPath = join(awsDir, 'credentials');
  const confPath = join(awsDir, 'config');
  const credProcessScript = join(dirname(fileURLToPath(import.meta.url)), 'aws-cred-process.mjs');

  // 1. Back up + relocate long-term [default] key → [codepresso-source]
  if (existsSync(credPath)) {
    copyFileSync(credPath, `${credPath}.codepresso.bak`);
    const moved = renameSection(readFileSync(credPath, 'utf-8'), 'default', sourceProfile);
    writeFileSync(credPath, moved, { mode: 0o600 });
  }

  // 2. Back up + write [default] credential_process into ~/.aws/config
  mkdirSync(awsDir, { recursive: true });
  const confText = existsSync(confPath) ? (copyFileSync(confPath, `${confPath}.codepresso.bak`), readFileSync(confPath, 'utf-8')) : '';
  const newConf = upsertSectionKV(confText, 'default', { credential_process: `node ${credProcessScript}`, region });
  writeFileSync(confPath, newConf);

  // 3. Detect mfaSerial via the source profile (allowed without MFA)
  let mfaSerial = null;
  try { mfaSerial = parseMfaSerial(awsJson(['iam', 'list-mfa-devices', '--profile', sourceProfile])); } catch { /* leave null */ }

  // 4. Persist aws config section + enable
  const globalCfgPath = join(homedir(), '.codepresso', 'config.json');
  mkdirSync(dirname(globalCfgPath), { recursive: true });
  const existing = existsSync(globalCfgPath) ? JSON.parse(readFileSync(globalCfgPath, 'utf-8')) : {};
  existing.aws = { ...(existing.aws || {}), enabled: !!mfaSerial, sourceProfile, mfaSerial, sessionTtlSeconds: aws.sessionTtlSeconds || 3600, sessionFile: aws.sessionFile || '~/.codepresso/aws-session.json', region };
  writeFileSync(globalCfgPath, JSON.stringify(existing, null, 2));

  console.log(JSON.stringify({ ok: true, mfaSerial, enabled: !!mfaSerial, credProcess: credProcessScript, backups: [`${credPath}.codepresso.bak`, `${confPath}.codepresso.bak`], note: mfaSerial ? null : 'No virtual TOTP found — register one, then run: aws-cli detect-mfa && aws-cli setup' }));
}
```

Register it: add `setup: cmdSetup` to `handlers`.

- [ ] **Step 2: Verify dispatcher recognizes `setup` (dry inspection — do NOT run against real ~/.aws here)**

Run: `node -e "import('./scripts/aws-cli.mjs').catch(()=>{})" ; grep -q "setup: cmdSetup" scripts/aws-cli.mjs && echo OK`
Expected: `OK`. (Actual setup execution is part of the manual runbook, Task 13.)

- [ ] **Step 3: Commit**

```bash
git add scripts/aws-cli.mjs
git commit -m "feat(aws): aws-cli setup (relocate key, wire credential_process)"
```

---

## Task 10: cloud-dev MCP — classify MFA errors

**Files:**
- Modify: `mcp/cloud-dev-server.mjs` (catch block, ~line 358-367)

- [ ] **Step 1: Add imports near the other imports**

```js
import { loadConfig } from '../scripts/lib/config.mjs';
import { getSessionFile, readCache, isSessionValid, isMfaCredentialError } from '../scripts/lib/aws-session.mjs';
```

- [ ] **Step 2: Replace the catch block**

Old:

```js
  } catch (error) {
    const message = error.name === 'CredentialsProviderError'
      ? 'AWS credentials not configured. Set up AWS CLI credentials or environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY).'
      : error.message;

    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
```

New:

```js
  } catch (error) {
    const cfg = loadConfig();
    const cacheValid = isSessionValid(readCache(getSessionFile(cfg)));
    if (cfg.aws?.enabled && !cacheValid && isMfaCredentialError(error)) {
      return {
        content: [{ type: 'text', text: 'MFA_REQUIRED: AWS MFA session missing/expired. Run /codepresso:aws-login to refresh, then retry this tool.' }],
        isError: true,
      };
    }
    const message = error.name === 'CredentialsProviderError'
      ? 'AWS credentials not configured. Run /codepresso:aws-login (if MFA is enabled) or set up AWS CLI credentials.'
      : error.message;
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
```

- [ ] **Step 3: Verify the server still starts**

Run: `node -e "import('./mcp/cloud-dev-server.mjs').catch(e=>{console.error(e.message);process.exit(1)})" & sleep 2; kill %1 2>/dev/null; echo "started ok"`
Expected: `started ok` with no import error. (It will block on stdio; the kill is expected.)

- [ ] **Step 4: Commit**

```bash
git add mcp/cloud-dev-server.mjs
git commit -m "feat(aws): cloud-dev MCP returns MFA_REQUIRED on credential errors"
```

---

## Task 11: PostToolUse:Bash hook — AWS-deny detection

**Files:**
- Modify: `scripts/post-tool-git-watcher.mjs`

- [ ] **Step 1: Add imports**

```js
import { loadConfig } from './lib/config.mjs';
import { getSessionFile, readCache, isSessionValid, shouldPromptMfa } from './lib/aws-session.mjs';
```

- [ ] **Step 2: Insert AWS detection BEFORE the `if (!session)` gate**

In `main()`, immediately after `const output = ...;` and before `const session = readSession();`, insert:

```js
    // AWS MFA reactive trigger — runs regardless of PR/session state.
    const cfg = loadConfig();
    if (cfg.aws?.enabled && /(^|\s)aws\s/.test(command)) {
      const cacheValid = isSessionValid(readCache(getSessionFile(cfg)));
      if (shouldPromptMfa(output, { cacheValid })) {
        process.stdout.write(JSON.stringify({
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: '[Codepresso] An `aws` command was blocked because the MFA session is missing/expired. Run /codepresso:aws-login to refresh, then retry the command.',
          },
        }));
        return;
      }
    }
```

- [ ] **Step 3: Manual smoke test (simulated blocked aws output)**

First temporarily enable aws in a throwaway global config is overkill; instead assert the guard is wired by checking the code path with aws disabled returns continue:true:

Run: `echo '{"toolInput":{"command":"aws s3 ls"},"toolOutput":"... with an explicit deny ..."}' | node scripts/post-tool-git-watcher.mjs`
Expected: `{"continue":true}` (aws.enabled is false by default, so no injection — confirms the gate).

- [ ] **Step 4: Commit**

```bash
git add scripts/post-tool-git-watcher.mjs
git commit -m "feat(aws): PostToolUse detects MFA-blocked aws commands"
```

---

## Task 12: aws-login skill

**Files:**
- Create: `skills/aws-login/SKILL.md`

- [ ] **Step 1: Write the skill**

````markdown
---
name: aws-login
description: Refresh the short-lived AWS MFA session for the Codepresso plugin. Use when an AWS call (cloud-dev MCP, `aws` CLI, or another AWS MCP) is blocked with MFA_REQUIRED / explicit-deny / ExpiredToken, or when the user asks to "aws login" / "refresh aws session" / "MFA 세션 갱신".
---

# aws-login

Mint a 1-hour MFA-backed AWS session and cache it so every AWS channel works.

## When to invoke
- A tool returned `MFA_REQUIRED`, or a `aws` command failed with `explicit deny` / `ExpiredToken` / `CredentialsProviderError`.
- The user explicitly asks to refresh / log in.

## Procedure

1. Check status:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/aws-cli.mjs" status
   ```
   - If `enabled` is false → tell the user to run `/codepresso:setup` first (AWS MFA not configured). Stop.
   - If `sessionValid` is true → no refresh needed; tell the user and retry their original action.
   - If `mfaSerial` is null → tell the user to register a virtual TOTP device, then run setup again. Stop.

2. Ask the user for their **6-digit MFA code** (use AskUserQuestion or a direct prompt). Do not store it.

3. Refresh:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/aws-cli.mjs" refresh --token-code <CODE>
   ```
   - `ok:true` → session refreshed (report only the expiration, never secret values). Retry the user's original AWS action.
   - `error:BAD_OR_DENIED_CODE` → ask for a fresh code and retry (max 2 attempts).
   - `error:TEMP_SESSION` → tell the user to run from a normal shell (not inside temporary credentials).
   - `error:NO_MFA_SERIAL` → register a virtual TOTP, then `/codepresso:setup`.

## Never
- Never echo `SecretAccessKey` / `SessionToken` / the MFA code.
- Never run `setup` automatically — it edits `~/.aws`. Only `/codepresso:setup` does that with user intent.
````

- [ ] **Step 2: Verify skill file is valid markdown with frontmatter**

Run: `head -5 skills/aws-login/SKILL.md`
Expected: shows `---` frontmatter with `name: aws-login`.

- [ ] **Step 3: Commit**

```bash
git add skills/aws-login/SKILL.md
git commit -m "feat(aws): aws-login refresh skill"
```

---

## Task 13: Wire setup + docs + full suite + manual runbook

**Files:**
- Modify: `skills/setup/SKILL.md` (add an AWS MFA step), `CLAUDE.md` (document the feature + config), `.claude-plugin/plugin.json` (only if skills require explicit registration — check first)

- [ ] **Step 1: Check whether skills need explicit registration**

Run: `grep -n "skills" .claude-plugin/plugin.json || echo "no explicit skill list — auto-discovered"`
Expected: either a skills array (add `aws-login`) or the auto-discovered note (no change needed).

- [ ] **Step 2: Add an AWS MFA step to `skills/setup/SKILL.md`**

Append a section instructing setup to offer AWS MFA configuration:

```markdown
## AWS MFA session (optional)

If the team enforces MFA on AWS access, offer to configure the credential_process bridge:

1. Confirm a virtual TOTP MFA device is registered for the user's IAM user (passkey alone is not enough for CLI).
2. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/aws-cli.mjs" setup`
   - This backs up `~/.aws/credentials` and `~/.aws/config` (`.codepresso.bak`), relocates the `[default]` long-term key to `[codepresso-source]`, writes a `[default]` `credential_process` profile, detects the MFA serial, and flips `aws.enabled`.
3. Report the result. If `mfaSerial` is null, tell the user to register a TOTP and re-run.
```

- [ ] **Step 3: Document the feature in `CLAUDE.md`**

Add a "Decision" entry (after Decision 12) describing the AWS MFA session helper, the `aws` config section, the credential_process bridge, the reactive trigger (cloud-dev MCP + PostToolUse), and 1h sessions. Add the `aws` block to the Configuration Schema section. Add the new files to the Architecture tree (`scripts/aws-cli.mjs`, `scripts/aws-cred-process.mjs`, `scripts/lib/aws-session.mjs`, `scripts/lib/aws-ini.mjs`, `skills/aws-login/`).

- [ ] **Step 4: Run the full test suite**

Run: `node --test tests/lib/*.test.mjs`
Expected: PASS — all existing tests plus the new `aws-session` (9), `aws-ini` (2), `aws-cred-process` (2).

- [ ] **Step 5: Commit**

```bash
git add skills/setup/SKILL.md CLAUDE.md .claude-plugin/plugin.json
git commit -m "docs(aws): wire setup, document MFA session helper"
```

- [ ] **Step 6: Manual runbook (human-run, requires real AWS + MFA)**

Document/execute the end-to-end check (cannot be unit-tested):
1. Register a virtual TOTP for the IAM user (keep the passkey).
2. `node scripts/aws-cli.mjs setup` → confirm backups created, `[codepresso-source]` present, `[default]` credential_process written, `mfaSerial` detected, `enabled:true`.
3. With no valid cache: `aws s3 ls` → AccessDenied/credential error (credential_process exits 1).
4. `node scripts/aws-cli.mjs refresh --token-code <6 digits>` → `ok:true`.
5. `aws s3 ls` → succeeds. `node scripts/aws-cli.mjs status` → `sessionValid:true`.
6. cloud-dev tool with expired cache → returns `MFA_REQUIRED`; after refresh, retry succeeds.
7. Rollback note: restore `~/.aws/*.codepresso.bak` if anything looks wrong.

---

## Self-Review

**Spec coverage:**
- credential_process bridge → Tasks 5, 9 (config wiring), 1 (defaults). ✓
- Universal coverage via `[default]` → Task 9. ✓
- Reactive trigger (MCP + bash) → Tasks 10, 11. ✓
- 1h sessions → Task 1 (`sessionTtlSeconds: 3600`), Task 8. ✓
- mfaSerial autodetect → Tasks 3 (parse), 7 (detect-mfa), 9 (setup). ✓
- Cache chmod 600 / no secret output / redaction → Tasks 2, 3, 5, 8. ✓
- enabled gate / rollout safety → Tasks 1, 10, 11. ✓
- Edge cases (wrong code, temp session, passkey-only, expiry skew, atomic write, false-positive guard) → Tasks 2, 4, 8. ✓
- Setup invasiveness w/ backups → Task 9. ✓
- Testing (no real AWS) → Tasks 2-6 unit tests; Task 13 manual runbook. ✓
- Org-policy track excluded → not in plan (correct). ✓

**Type consistency:** Library function names used identically across tasks — `getSessionFile`, `readCache`, `isSessionValid`, `parseStsSessionToken`, `parseMfaSerial`, `toCredentialProcessOutput`, `redact`, `shouldPromptMfa`, `isMfaCredentialError`, `writeCache`, `renameSection`, `upsertSectionKV`. CLI commands consistent: `status`/`detect-mfa`/`refresh`/`setup`. Config keys consistent: `aws.{enabled,sourceProfile,mfaSerial,sessionTtlSeconds,sessionFile,region}`.

**Placeholder scan:** No TBD/TODO; every code step shows full code.
