# Inbox Task Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a feature that scans Gmail + Google Chat for action-item messages, lets the user approve them via paginated `AskUserQuestion`, creates Notion task pages with due dates via the official Notion connector, and surfaces overdue + due-today tasks in the existing morning Google Chat greeting.

**Architecture:** A Claude-driven scan routine (markdown skill) is the orchestrator. It invokes the official `mcp__claude_ai_Gmail` and `mcp__claude_ai_Notion` connectors, plus a thin Node CLI (`scripts/inbox-cli.mjs`) for the deterministic bits — seen-ID dedup, candidate JSONL persistence, schema cache, and `gws`-based Chat fetch. The morning trigger is a one-liner injection into the existing `SessionStart` hook (`additionalContext`). Reminder pings extend the existing `daily-chat-greeting.mjs`.

**Tech Stack:** Node.js 20 ESM, `node:test` + `node:assert/strict`, `gws` CLI, Claude.ai official Gmail + Notion connectors (MCP), existing Codepresso plugin libraries (`lib/redactor.mjs`, `lib/config.mjs`, `lib/gws.mjs`, `lib/logger.mjs`).

**Spec:** `docs/superpowers/specs/2026-05-16-inbox-task-tracker-design.md`

---

## File Structure

| File | Created/Modified | Responsibility |
|------|------------------|----------------|
| `scripts/lib/config.mjs` | Modified | Adds `inbox.*` to defaults + `KNOWN_KEYS` + validation branch. |
| `scripts/lib/inbox-state.mjs` | Created | Pure functions: seen-IDs CRUD with prune, candidate JSONL CRUD, schema cache CRUD, `shouldRunInboxScan` gating, `formatReminderSections` formatter. No subprocesses. |
| `scripts/lib/gws.mjs` | Modified | Adds `fetchChatUnread({ spaceIds, sinceIso, maxPerSpace, runner? })` with injectable runner for tests. |
| `scripts/inbox-cli.mjs` | Created | Thin CLI dispatcher invoked from the skill. Subcommands: `prep`, `redact`, `stage`, `complete`, `schema-cache`. Delegates to lib. |
| `scripts/session-start.mjs` | Modified | Adds a branch that injects an inbox-scan instruction into `additionalContext` when `inbox.enabled && shouldRunInboxScan(...) === true`, then marks the daily flag. |
| `scripts/daily-chat-greeting.mjs` | Modified | Extends the Haiku prompt to query Notion for overdue + due-today tasks and embeds the formatted sections in the Chat message. |
| `skills/scan-inbox/SKILL.md` | Created | The scan routine procedure Claude follows. Invokes Gmail connector then CLI prep then Chat fetch then CLI redact then classify then CLI stage then `AskUserQuestion` pages then Notion create then CLI complete. |
| `skills/setup/SKILL.md` | Modified | Adds Step 11 "Inbox scan setup (optional)" — Gmail auth probe, Notion DB property auto-create, flip `inbox.enabled`. |
| `tests/lib/inbox-state.test.mjs` | Created | Unit tests for every public function in `inbox-state.mjs`. |
| `tests/lib/gws-fetch.test.mjs` | Created | Unit test for `fetchChatUnread` with an injected runner. |
| `tests/lib/config.test.mjs` | Modified | Adds tests asserting `inbox` defaults + validation warnings. |
| `tests/lib/inbox-cli.test.mjs` | Created | Smoke test that spawns the CLI for each subcommand against tmp dirs. |
| `CLAUDE.md` | Modified | Documents the inbox flow, new state files, and new hook behaviors. |

Runtime state files (no code, just data):
- `.codepresso/state/codepresso-inbox-seen.json`
- `.codepresso/state/codepresso-inbox-candidates.jsonl`
- `.codepresso/state/codepresso-inbox-cache.json`
- `~/.codepresso/inbox-last-run.json`
- `~/.codepresso/logs/inbox-<YYYY-MM-DD>.log`

---

## Task 1: Add `inbox` section to config

**Files:**
- Modify: `scripts/lib/config.mjs`
- Modify: `tests/lib/config.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/config.test.mjs`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, validateConfig } from '../../scripts/lib/config.mjs';

describe('inbox config defaults', () => {
  it('exposes inbox section with disabled-by-default master switch', () => {
    const cfg = loadConfig(mkdtempSync(join(tmpdir(), 'cp-cfg-')), {
      globalConfigPath: join(tmpdir(), 'nonexistent-global.json'),
    });
    assert.equal(cfg.inbox.enabled, false);
    assert.equal(cfg.inbox.sources.gmail.enabled, true);
    assert.equal(cfg.inbox.sources.gmail.lookbackHours, 24);
    assert.equal(cfg.inbox.sources.chat.enabled, true);
    assert.deepEqual(cfg.inbox.sources.chat.spaceIds, []);
    assert.ok(Array.isArray(cfg.inbox.ignoreSenders));
    assert.equal(cfg.inbox.classifier.maxCandidatesPerScan, 10);
    assert.equal(cfg.inbox.notion.dueDateProperty, '마감일');
    assert.equal(cfg.inbox.notion.defaultDueOption, 'Tomorrow');
    assert.equal(cfg.inbox.reminder.showOverdue, true);
    assert.equal(cfg.inbox.reminder.showDueToday, true);
    assert.equal(cfg.inbox.reminder.maxPerSection, 5);
  });

  it('merges project-level inbox overrides without dropping defaults', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cp-cfg-'));
    writeFileSync(
      join(cwd, '.codepresso.json'),
      JSON.stringify({ inbox: { enabled: true, classifier: { maxCandidatesPerScan: 5 } } }),
    );
    const cfg = loadConfig(cwd, { globalConfigPath: join(tmpdir(), 'nonexistent-global.json') });
    assert.equal(cfg.inbox.enabled, true);
    assert.equal(cfg.inbox.classifier.maxCandidatesPerScan, 5);
    assert.equal(cfg.inbox.notion.dueDateProperty, '마감일');
    rmSync(cwd, { recursive: true, force: true });
  });

  it('does not flag inbox as an unknown config key', () => {
    const warnings = validateConfig({ inbox: { enabled: true } });
    assert.equal(warnings.filter((w) => w.includes('Unknown config key: "inbox"')).length, 0);
  });

  it('flags inbox.enabled type error', () => {
    const warnings = validateConfig({ inbox: { enabled: 'yes' } });
    assert.ok(warnings.some((w) => w.includes('inbox.enabled') && w.includes('boolean')));
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
node --test tests/lib/config.test.mjs
```
Expected: 4 new failures (`inbox` is `undefined`, validation does not produce inbox warnings).

- [ ] **Step 3: Add the `inbox` section to `DEFAULT_CONFIG`**

In `scripts/lib/config.mjs`, after the `googleChat: { ... }` block (around line 98) and before `excludePatterns`, insert:

```javascript
  inbox: {
    enabled: false,
    sources: {
      gmail: {
        enabled: true,
        lookbackHours: 24,
        query: 'in:inbox is:unread -category:promotions -category:social',
        maxResults: 30,
      },
      chat: {
        enabled: true,
        lookbackHours: 24,
        spaceIds: [],
        maxPerSpace: 20,
      },
    },
    ignoreSenders: ['noreply@', 'notifications@github\\.com', 'no-reply@'],
    classifier: { maxCandidatesPerScan: 10 },
    notion: {
      taskDatabaseId: null,
      dueDateProperty: '마감일',
      defaultDueOption: 'Tomorrow',
    },
    reminder: { showOverdue: true, showDueToday: true, maxPerSection: 5 },
  },
```

- [ ] **Step 4: Add `inbox` to `KNOWN_KEYS`**

In `validateConfig`, update the `KNOWN_KEYS` array to include `'inbox'`:

```javascript
const KNOWN_KEYS = ['github', 'notion', 'prLogging', 'scoring', 'deploy', 'redaction', 'rateLimit', 'analytics', 'prLabels', 'trivialFilter', 'epicDocs', 'cloudDev', 'googleChat', 'inbox', 'excludePatterns', 'debug'];
```

- [ ] **Step 5: Add `inbox` validation branch**

Append before the `if (config.excludePatterns...)` block:

```javascript
  if (config.inbox) {
    if (typeof config.inbox.enabled !== 'undefined' && typeof config.inbox.enabled !== 'boolean') {
      warnings.push(`inbox.enabled should be boolean, got ${typeof config.inbox.enabled}`);
    }
    if (config.inbox.classifier && typeof config.inbox.classifier.maxCandidatesPerScan === 'number'
        && config.inbox.classifier.maxCandidatesPerScan <= 0) {
      warnings.push(`inbox.classifier.maxCandidatesPerScan must be > 0, got ${config.inbox.classifier.maxCandidatesPerScan}`);
    }
    if (config.inbox.ignoreSenders && !Array.isArray(config.inbox.ignoreSenders)) {
      warnings.push(`inbox.ignoreSenders should be an array, got ${typeof config.inbox.ignoreSenders}`);
    }
  }
```

- [ ] **Step 6: Run tests to verify pass**

```bash
node --test tests/lib/config.test.mjs
```
Expected: PASS, all tests green.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/config.mjs tests/lib/config.test.mjs
git commit -m "feat(config): add inbox section defaults + validation"
```

---

## Task 2: Create `lib/inbox-state.mjs` — seen-IDs CRUD

**Files:**
- Create: `scripts/lib/inbox-state.mjs`
- Create: `tests/lib/inbox-state.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/inbox-state.test.mjs`:

```javascript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSeen, saveSeen, markSeen } from '../../scripts/lib/inbox-state.mjs';

describe('inbox-state seen-IDs', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'cp-inbox-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('returns empty defaults when seen file is missing', () => {
    const seen = loadSeen(tmp);
    assert.deepEqual(seen.gmail, []);
    assert.deepEqual(seen.chat, []);
    assert.equal(seen.lastScannedAt, null);
  });

  it('roundtrips through saveSeen/loadSeen', () => {
    saveSeen(tmp, {
      gmail: [{ id: 'm1', at: new Date().toISOString() }],
      chat: [{ id: 'c1', at: new Date().toISOString() }],
      lastScannedAt: '2026-05-16T09:00:00+09:00',
    });
    const seen = loadSeen(tmp);
    assert.equal(seen.gmail.length, 1);
    assert.equal(seen.gmail[0].id, 'm1');
    assert.equal(seen.lastScannedAt, '2026-05-16T09:00:00+09:00');
  });

  it('markSeen appends new IDs and is idempotent', () => {
    markSeen(tmp, 'gmail', ['m1', 'm2']);
    markSeen(tmp, 'gmail', ['m2', 'm3']);
    const seen = loadSeen(tmp);
    const ids = seen.gmail.map((e) => e.id).sort();
    assert.deepEqual(ids, ['m1', 'm2', 'm3']);
  });

  it('prunes entries older than 30 days on save', () => {
    const oldIso = new Date(Date.now() - 31 * 86400 * 1000).toISOString();
    const newIso = new Date().toISOString();
    saveSeen(tmp, {
      gmail: [{ id: 'old', at: oldIso }, { id: 'new', at: newIso }],
      chat: [],
      lastScannedAt: newIso,
    });
    const seen = loadSeen(tmp);
    const ids = seen.gmail.map((e) => e.id);
    assert.deepEqual(ids, ['new']);
  });

  it('does not leave a temp file behind after successful save', () => {
    saveSeen(tmp, { gmail: [], chat: [], lastScannedAt: null });
    assert.equal(existsSync(join(tmp, '.codepresso', 'state', 'codepresso-inbox-seen.json.tmp')), false);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
node --test tests/lib/inbox-state.test.mjs
```
Expected: FAIL with `Cannot find module .../scripts/lib/inbox-state.mjs`.

- [ ] **Step 3: Implement `inbox-state.mjs` (seen-IDs only)**

Create `scripts/lib/inbox-state.mjs`:

```javascript
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const PRUNE_DAYS = 30;

function stateDir(cwd) {
  return join(cwd, '.codepresso', 'state');
}

function seenPath(cwd) {
  return join(stateDir(cwd), 'codepresso-inbox-seen.json');
}

function readJsonSafe(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
  renameSync(tmp, path);
}

export function loadSeen(cwd) {
  return readJsonSafe(seenPath(cwd), { gmail: [], chat: [], lastScannedAt: null });
}

export function saveSeen(cwd, seen) {
  const cutoff = Date.now() - PRUNE_DAYS * 86400 * 1000;
  const prune = (entries) => (entries || []).filter((e) => {
    const at = e?.at ? Date.parse(e.at) : 0;
    return at >= cutoff;
  });
  writeJsonAtomic(seenPath(cwd), {
    gmail: prune(seen.gmail),
    chat: prune(seen.chat),
    lastScannedAt: seen.lastScannedAt || null,
  });
}

export function markSeen(cwd, source, ids) {
  if (!ids?.length) return;
  const seen = loadSeen(cwd);
  const existing = new Set((seen[source] || []).map((e) => e.id));
  const at = new Date().toISOString();
  for (const id of ids) {
    if (!existing.has(id)) {
      seen[source].push({ id, at });
      existing.add(id);
    }
  }
  seen.lastScannedAt = at;
  saveSeen(cwd, seen);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
node --test tests/lib/inbox-state.test.mjs
```
Expected: PASS, 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/inbox-state.mjs tests/lib/inbox-state.test.mjs
git commit -m "feat(inbox): add seen-IDs CRUD for inbox dedup"
```

---

## Task 3: Candidate JSONL CRUD in `inbox-state.mjs`

**Files:**
- Modify: `scripts/lib/inbox-state.mjs`
- Modify: `tests/lib/inbox-state.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/inbox-state.test.mjs`:

```javascript
import { appendCandidates, readCandidates, removeCandidatesByIds } from '../../scripts/lib/inbox-state.mjs';

describe('inbox-state candidate JSONL', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'cp-inbox-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('readCandidates returns [] when file is missing', () => {
    assert.deepEqual(readCandidates(tmp), []);
  });

  it('appendCandidates appends one line per candidate', () => {
    appendCandidates(tmp, [
      { id: 'g1', source: 'gmail', summary: 'A' },
      { id: 'g2', source: 'gmail', summary: 'B' },
    ]);
    const got = readCandidates(tmp);
    assert.equal(got.length, 2);
    assert.equal(got[0].id, 'g1');
    assert.equal(got[1].summary, 'B');
  });

  it('appendCandidates is additive across calls (preserves leftovers)', () => {
    appendCandidates(tmp, [{ id: 'g1', source: 'gmail', summary: 'A' }]);
    appendCandidates(tmp, [{ id: 'g2', source: 'gmail', summary: 'B' }]);
    assert.equal(readCandidates(tmp).length, 2);
  });

  it('removeCandidatesByIds removes matching entries and leaves others', () => {
    appendCandidates(tmp, [
      { id: 'g1', source: 'gmail', summary: 'A' },
      { id: 'g2', source: 'gmail', summary: 'B' },
      { id: 'c1', source: 'chat', summary: 'C' },
    ]);
    removeCandidatesByIds(tmp, ['g1', 'c1']);
    const got = readCandidates(tmp);
    assert.equal(got.length, 1);
    assert.equal(got[0].id, 'g2');
  });

  it('removeCandidatesByIds with empty array is a no-op', () => {
    appendCandidates(tmp, [{ id: 'g1', source: 'gmail', summary: 'A' }]);
    removeCandidatesByIds(tmp, []);
    assert.equal(readCandidates(tmp).length, 1);
  });

  it('removeCandidatesByIds with no remaining entries leaves an empty file', () => {
    appendCandidates(tmp, [{ id: 'g1', source: 'gmail', summary: 'A' }]);
    removeCandidatesByIds(tmp, ['g1']);
    assert.deepEqual(readCandidates(tmp), []);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
node --test tests/lib/inbox-state.test.mjs
```
Expected: FAIL with `appendCandidates is not exported`.

- [ ] **Step 3: Implement candidate CRUD**

Append to `scripts/lib/inbox-state.mjs`:

```javascript
function candidatesPath(cwd) {
  return join(stateDir(cwd), 'codepresso-inbox-candidates.jsonl');
}

export function appendCandidates(cwd, candidates) {
  if (!candidates?.length) return;
  mkdirSync(stateDir(cwd), { recursive: true });
  const lines = candidates.map((c) => JSON.stringify(c)).join('\n') + '\n';
  appendFileSync(candidatesPath(cwd), lines, 'utf-8');
}

export function readCandidates(cwd) {
  const path = candidatesPath(cwd);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function removeCandidatesByIds(cwd, ids) {
  if (!ids?.length) return;
  const toRemove = new Set(ids);
  const kept = readCandidates(cwd).filter((c) => !toRemove.has(c.id));
  const path = candidatesPath(cwd);
  if (kept.length === 0) {
    writeFileSync(path, '', 'utf-8');
    return;
  }
  const body = kept.map((c) => JSON.stringify(c)).join('\n') + '\n';
  mkdirSync(stateDir(cwd), { recursive: true });
  const tmp = `${path}.tmp.${randomUUID()}`;
  writeFileSync(tmp, body, 'utf-8');
  renameSync(tmp, path);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
node --test tests/lib/inbox-state.test.mjs
```
Expected: PASS, 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/inbox-state.mjs tests/lib/inbox-state.test.mjs
git commit -m "feat(inbox): add candidate JSONL CRUD"
```

---

## Task 4: Schema cache + scan-gating helper + reminder formatter

**Files:**
- Modify: `scripts/lib/inbox-state.mjs`
- Modify: `tests/lib/inbox-state.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/inbox-state.test.mjs`:

```javascript
import {
  loadSchemaCache, saveSchemaCache, isSchemaCacheStale,
  shouldRunInboxScan,
  formatReminderSections,
} from '../../scripts/lib/inbox-state.mjs';

describe('inbox-state schema cache', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'cp-inbox-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('returns null when no cache exists', () => {
    assert.equal(loadSchemaCache(tmp), null);
  });

  it('roundtrips through save/load', () => {
    saveSchemaCache(tmp, { taskDb: { id: 'db1', titleProp: '이름', statusProp: '상태' } });
    const got = loadSchemaCache(tmp);
    assert.equal(got.taskDb.titleProp, '이름');
    assert.ok(got.taskDb.fetchedAt);
  });

  it('isSchemaCacheStale flags caches older than 7 days', () => {
    const stale = { taskDb: { fetchedAt: new Date(Date.now() - 8 * 86400 * 1000).toISOString() } };
    const fresh = { taskDb: { fetchedAt: new Date().toISOString() } };
    assert.equal(isSchemaCacheStale(stale), true);
    assert.equal(isSchemaCacheStale(fresh), false);
    assert.equal(isSchemaCacheStale(null), true);
  });
});

describe('inbox-state shouldRunInboxScan', () => {
  const baseConfig = { inbox: { enabled: true } };

  it('returns false when inbox.enabled is false', () => {
    assert.equal(shouldRunInboxScan({ inbox: { enabled: false } }, '2026-05-13', null, 3), false);
  });

  it('returns false on Saturday (dayOfWeek=6) and Sunday (0)', () => {
    assert.equal(shouldRunInboxScan(baseConfig, '2026-05-16', null, 6), false);
    assert.equal(shouldRunInboxScan(baseConfig, '2026-05-17', null, 0), false);
  });

  it('returns true on a weekday when lastRunDate is missing', () => {
    assert.equal(shouldRunInboxScan(baseConfig, '2026-05-13', null, 3), true);
  });

  it('returns false when lastRunDate equals today', () => {
    assert.equal(shouldRunInboxScan(baseConfig, '2026-05-13', '2026-05-13', 3), false);
  });

  it('returns true when lastRunDate is an older weekday', () => {
    assert.equal(shouldRunInboxScan(baseConfig, '2026-05-18', '2026-05-15', 1), true);
  });
});

describe('inbox-state formatReminderSections', () => {
  it('returns empty string when both buckets empty', () => {
    assert.equal(formatReminderSections([], [], { maxPerSection: 5 }), '');
  });

  it('renders overdue with days-late and due-today bullet sections', () => {
    const todayMs = Date.parse('2026-05-13T00:00:00+09:00');
    const overdue = [
      { title: 'Send Q3 budget', uniqueId: 'TSK-12345', dueDate: '2026-05-10T18:00:00+09:00' },
    ];
    const dueToday = [
      { title: 'Review onboarding', uniqueId: 'TSK-12346', dueDate: '2026-05-13T18:00:00+09:00' },
    ];
    const out = formatReminderSections(overdue, dueToday, { maxPerSection: 5, now: todayMs });
    assert.ok(out.includes('Overdue (1)'));
    assert.ok(out.includes('TSK-12345'));
    assert.ok(out.includes('days late') || out.includes('day late'));
    assert.ok(out.includes('Due today (1)'));
    assert.ok(out.includes('TSK-12346'));
  });

  it('caps bullets per section and shows "... and N more" tail', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      title: `T${i}`, uniqueId: `TSK-${i}`, dueDate: '2026-05-13T18:00:00+09:00',
    }));
    const out = formatReminderSections([], rows, { maxPerSection: 5, now: Date.parse('2026-05-13T00:00:00+09:00') });
    assert.ok(out.includes('... and 2 more'));
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
node --test tests/lib/inbox-state.test.mjs
```
Expected: FAIL with missing-export errors for the new symbols.

- [ ] **Step 3: Implement the three helpers**

Append to `scripts/lib/inbox-state.mjs`:

```javascript
const SCHEMA_TTL_DAYS = 7;

function schemaCachePath(cwd) {
  return join(stateDir(cwd), 'codepresso-inbox-cache.json');
}

export function loadSchemaCache(cwd) {
  return readJsonSafe(schemaCachePath(cwd), null);
}

export function saveSchemaCache(cwd, cache) {
  const stamped = {
    ...cache,
    taskDb: { ...cache.taskDb, fetchedAt: new Date().toISOString() },
  };
  writeJsonAtomic(schemaCachePath(cwd), stamped);
}

export function isSchemaCacheStale(cache) {
  if (!cache?.taskDb?.fetchedAt) return true;
  const age = Date.now() - Date.parse(cache.taskDb.fetchedAt);
  return age > SCHEMA_TTL_DAYS * 86400 * 1000;
}

export function shouldRunInboxScan(config, todayDate, lastRunDate, dayOfWeek) {
  if (!config?.inbox?.enabled) return false;
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  if (lastRunDate && lastRunDate === todayDate) return false;
  return true;
}

export function formatReminderSections(overdue, dueToday, opts) {
  const max = opts.maxPerSection ?? 5;
  const nowMs = opts.now ?? Date.now();
  const lines = [];

  const renderBullet = (row, withDaysLate = false) => {
    const id = row.uniqueId ? `[${row.uniqueId}] ` : '';
    if (withDaysLate) {
      const daysLate = Math.floor((nowMs - Date.parse(row.dueDate)) / (86400 * 1000));
      const suffix = daysLate <= 0 ? '' : ` — ${daysLate} day${daysLate === 1 ? '' : 's'} late`;
      return `  • ${id}${row.title}${suffix}`;
    }
    return `  • ${id}${row.title}`;
  };

  if (overdue.length > 0) {
    lines.push(`🔥 Overdue (${overdue.length}):`);
    overdue.slice(0, max).forEach((r) => lines.push(renderBullet(r, true)));
    if (overdue.length > max) lines.push(`  ... and ${overdue.length - max} more`);
  }

  if (dueToday.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(`⏰ Due today (${dueToday.length}):`);
    dueToday.slice(0, max).forEach((r) => lines.push(renderBullet(r, false)));
    if (dueToday.length > max) lines.push(`  ... and ${dueToday.length - max} more`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
node --test tests/lib/inbox-state.test.mjs
```
Expected: PASS, 22 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/inbox-state.mjs tests/lib/inbox-state.test.mjs
git commit -m "feat(inbox): add schema cache + scan-gating helper + reminder formatter"
```

---

## Task 5: Add `fetchChatUnread` to `lib/gws.mjs`

**Files:**
- Modify: `scripts/lib/gws.mjs`
- Create: `tests/lib/gws-fetch.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/gws-fetch.test.mjs`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchChatUnread } from '../../scripts/lib/gws.mjs';

describe('gws.fetchChatUnread', () => {
  it('shells out one gws invocation per space and merges results', () => {
    const calls = [];
    const runner = (cmd) => {
      calls.push(cmd);
      if (cmd.includes('spaces/A')) {
        return JSON.stringify({ messages: [{ name: 'spaces/A/messages/1', text: 'hi A',
          sender: { displayName: 'Mira' }, createTime: '2026-05-16T08:00:00Z' }] });
      }
      return JSON.stringify({ messages: [{ name: 'spaces/B/messages/2', text: 'hi B',
        sender: { displayName: 'Park' }, createTime: '2026-05-16T08:05:00Z' }] });
    };
    const out = fetchChatUnread({
      spaceIds: ['A', 'B'],
      sinceIso: '2026-05-15T00:00:00Z',
      maxPerSpace: 20,
      runner,
    });
    assert.equal(out.length, 2);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes('spaces/A'));
    assert.ok(out[0].id.startsWith('spaces/A/messages/'));
    assert.equal(out[0].source, 'chat');
    assert.equal(out[1].from, 'Park');
  });

  it('returns [] when spaceIds is empty', () => {
    const out = fetchChatUnread({ spaceIds: [], sinceIso: 'x', maxPerSpace: 20, runner: () => '' });
    assert.deepEqual(out, []);
  });

  it('skips a space whose runner throws', () => {
    const runner = (cmd) => {
      if (cmd.includes('spaces/BAD')) throw new Error('gws: 403');
      return JSON.stringify({ messages: [{ name: 'spaces/OK/messages/1', text: 't',
        sender: { displayName: 'X' }, createTime: '2026-05-16T08:00:00Z' }] });
    };
    const out = fetchChatUnread({ spaceIds: ['BAD', 'OK'], sinceIso: 'x', maxPerSpace: 20, runner });
    assert.equal(out.length, 1);
    assert.ok(out[0].id.includes('spaces/OK'));
  });

  it('returns [] if every runner call fails', () => {
    const out = fetchChatUnread({
      spaceIds: ['A'], sinceIso: 'x', maxPerSpace: 20,
      runner: () => { throw new Error('ENOENT'); },
    });
    assert.deepEqual(out, []);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
node --test tests/lib/gws-fetch.test.mjs
```
Expected: FAIL with `fetchChatUnread is not exported`.

- [ ] **Step 3: Implement `fetchChatUnread` in `gws.mjs`**

Append to `scripts/lib/gws.mjs`:

```javascript
function defaultRunner(cmd) {
  return execSync(cmd, { shell: 'bash', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

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
```

- [ ] **Step 4: Run test to verify pass**

```bash
node --test tests/lib/gws-fetch.test.mjs
```
Expected: PASS, 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/gws.mjs tests/lib/gws-fetch.test.mjs
git commit -m "feat(gws): add fetchChatUnread for inbox scan"
```

---

## Task 6: Create `scripts/inbox-cli.mjs` — CLI dispatcher

**Files:**
- Create: `scripts/inbox-cli.mjs`
- Create: `tests/lib/inbox-cli.test.mjs`

- [ ] **Step 1: Write the failing smoke tests**

Create `tests/lib/inbox-cli.test.mjs`:

```javascript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', '..', 'scripts', 'inbox-cli.mjs');

function run(args, { cwd, input } = {}) {
  return execFileSync('node', [CLI, ...args], {
    cwd, encoding: 'utf-8',
    input: input ?? undefined,
    stdio: input != null ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  });
}

describe('inbox-cli', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'cp-cli-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('prep emits seen + leftovers JSON', () => {
    const out = JSON.parse(run(['prep'], { cwd: tmp }));
    assert.deepEqual(out.seen.gmail, []);
    assert.deepEqual(out.seen.chat, []);
    assert.deepEqual(out.leftovers, []);
  });

  it('redact strips Anthropic keys from stdin', () => {
    const out = run(['redact'], { cwd: tmp, input: 'token sk-ant-api03-abcdefghijklmnopqrstuv0123' });
    assert.ok(!out.includes('sk-ant-'));
    assert.ok(out.includes('[REDACTED_API_KEY]'));
  });

  it('stage appends candidates and marks seen', () => {
    const payload = JSON.stringify({
      candidates: [{ id: 'g1', source: 'gmail', summary: 'A' }],
      sourceIds: { gmail: ['g1'], chat: [] },
    });
    run(['stage'], { cwd: tmp, input: payload });
    const out = JSON.parse(run(['prep'], { cwd: tmp }));
    assert.equal(out.leftovers.length, 1);
    assert.equal(out.leftovers[0].id, 'g1');
    assert.equal(out.seen.gmail.length, 1);
  });

  it('complete removes accepted + rejected candidates', () => {
    run(['stage'], { cwd: tmp, input: JSON.stringify({
      candidates: [{ id: 'g1', source: 'gmail' }, { id: 'g2', source: 'gmail' }],
      sourceIds: { gmail: ['g1', 'g2'], chat: [] },
    })});
    run(['complete'], { cwd: tmp, input: JSON.stringify({ accepted: ['g1'], rejected: ['g2'] }) });
    const out = JSON.parse(run(['prep'], { cwd: tmp }));
    assert.equal(out.leftovers.length, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
node --test tests/lib/inbox-cli.test.mjs
```
Expected: FAIL — `Cannot find module .../scripts/inbox-cli.mjs`.

- [ ] **Step 3: Implement the CLI**

Create `scripts/inbox-cli.mjs`:

```javascript
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  loadSeen, markSeen,
  readCandidates, appendCandidates, removeCandidatesByIds,
  loadSchemaCache, saveSchemaCache,
} from './lib/inbox-state.mjs';
import { loadConfig } from './lib/config.mjs';
import { redactSecrets } from './lib/redactor.mjs';

const cwd = process.cwd();

function readStdin() {
  try {
    return readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

function parseJsonStdin() {
  const raw = readStdin();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`inbox-cli: invalid JSON on stdin: ${err.message}\n`);
    process.exit(2);
  }
}

const cmd = process.argv[2];

switch (cmd) {
  case 'prep': {
    const config = loadConfig(cwd);
    process.stdout.write(JSON.stringify({
      seen: loadSeen(cwd),
      leftovers: readCandidates(cwd),
      config: config.inbox || {},
      notion: { taskDb: config.notion?.databases?.task || null, userId: config.notion?.userId || null },
    }, null, 2));
    break;
  }
  case 'redact': {
    const text = readStdin();
    const config = loadConfig(cwd);
    const extra = config.redaction?.extraPatterns || [];
    process.stdout.write(redactSecrets(text, extra));
    break;
  }
  case 'stage': {
    const { candidates = [], sourceIds = {} } = parseJsonStdin();
    appendCandidates(cwd, candidates);
    if (sourceIds.gmail?.length) markSeen(cwd, 'gmail', sourceIds.gmail);
    if (sourceIds.chat?.length) markSeen(cwd, 'chat', sourceIds.chat);
    process.stdout.write(JSON.stringify({ staged: candidates.length }));
    break;
  }
  case 'complete': {
    const { accepted = [], rejected = [] } = parseJsonStdin();
    removeCandidatesByIds(cwd, [...accepted, ...rejected]);
    process.stdout.write(JSON.stringify({ removed: accepted.length + rejected.length }));
    break;
  }
  case 'schema-cache': {
    const sub = process.argv[3];
    if (sub === 'get') {
      const cache = loadSchemaCache(cwd);
      process.stdout.write(JSON.stringify(cache, null, 2));
    } else if (sub === 'set') {
      saveSchemaCache(cwd, parseJsonStdin());
      process.stdout.write('{"ok":true}');
    } else {
      process.stderr.write('schema-cache requires get|set\n');
      process.exit(2);
    }
    break;
  }
  default:
    process.stderr.write(`Usage: inbox-cli <prep|redact|stage|complete|schema-cache>\n`);
    process.exit(2);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
node --test tests/lib/inbox-cli.test.mjs
```
Expected: PASS, 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/inbox-cli.mjs tests/lib/inbox-cli.test.mjs
git commit -m "feat(inbox): add inbox-cli dispatcher for the scan-inbox skill"
```

---

## Task 7: Create `skills/scan-inbox/SKILL.md`

**Files:**
- Create: `skills/scan-inbox/SKILL.md`

No automated test — the skill is procedural prompt content. Validation is manual.

- [ ] **Step 1: Create the directory**

```bash
mkdir -p skills/scan-inbox
```

- [ ] **Step 2: Create the skill file**

Create `skills/scan-inbox/SKILL.md` with the following content (copy verbatim):

````markdown
---
name: codepresso:scan-inbox
description: Scan Gmail + Google Chat for action-item messages, present a triage picker, create Notion tasks with due dates.
---

# scan-inbox

Triages messages from Gmail and Google Chat that look like action items, and turns the user-approved ones into Notion tasks with explicit due dates.

## When to invoke

- Automatically when `session-start.mjs` injects the instruction `Morning inbox routine: invoke the codepresso:scan-inbox skill` into `additionalContext`.
- Manually when the user runs `/codepresso:scan-inbox`.

If `inbox.enabled` is `false` in config, emit `Inbox scan not enabled. Run /codepresso:setup to configure.` and exit.

## Procedure

### Step 1 — Load prep state

Run from the project root:

```bash
node scripts/inbox-cli.mjs prep
```

Parse the JSON output:
- `seen` — message IDs already triaged (do not re-fetch these).
- `leftovers` — candidates from a previous interrupted run (carry forward to Step 5).
- `config` — `inbox.*` settings.
- `notion` — `{ taskDb, userId }`.

If `config.enabled` is false, abort with the message above.

### Step 2 — Fetch Gmail (if `config.sources.gmail.enabled`)

Use `mcp__claude_ai_Gmail` to list messages matching `config.sources.gmail.query`, constrained to the last `config.sources.gmail.lookbackHours` hours. Cap at `config.sources.gmail.maxResults`.

For each message capture: `id`, `from`, `subject`, `snippet`, `permalink`.

If the connector returns "not authenticated", skip and emit `🔐 Gmail connector not authenticated — run mcp__claude_ai_Gmail__authenticate to enable.`

### Step 3 — Fetch Chat (if `config.sources.chat.enabled`)

Compute `sinceIso = now - lookbackHours`. Run:

```bash
node -e "import('./scripts/lib/gws.mjs').then(m => { const out = m.fetchChatUnread({ spaceIds: <JSON of space IDs>, sinceIso: '<sinceIso>', maxPerSpace: <maxPerSpace> }); process.stdout.write(JSON.stringify(out)); })"
```

If the result is `[]` due to gws issues, emit `🔐 gws CLI unavailable — Chat fetch skipped.`

### Step 4 — Filter & dedup

Combine Gmail + Chat into one candidate list. Drop a message if:
- Its `id` is in `seen.gmail` or `seen.chat`.
- Its `from` matches any pattern in `config.ignoreSenders` (regex).
- Gmail header `Auto-Submitted` is present.

### Step 5 — Add leftover candidates

Merge `leftovers` from Step 1 into the candidate list.

### Step 6 — Redact snippets

For each candidate, pipe its `snippet` through:

```bash
echo "<snippet>" | node scripts/inbox-cli.mjs redact
```

Replace the snippet with the redacted output (≤ 500 chars).

### Step 7 — Classify with Claude itself

Build a single batched prompt:

```
For each entry, return JSON: { "index": N, "isTask": <bool>, "summary": "<≤80 char imperative>", "reason": "<phrase>" }. Output ONLY a JSON array.

1. From: <from> | Subject: <subject>
   Snippet: <snippet>
2. ...
```

Drop entries where `isTask` is false. Cap survivors at `config.classifier.maxCandidatesPerScan`.

### Step 8 — Stage candidates

Build the staging payload:

```json
{
  "candidates": [<surviving candidates>],
  "sourceIds": { "gmail": [<all fetched gmail ids>], "chat": [<all fetched chat ids>] }
}
```

Include EVERY fetched ID in `sourceIds` (accepted + rejected by classifier).

```bash
echo '<payload JSON>' | node scripts/inbox-cli.mjs stage
```

If the resulting candidate list is empty, emit `📭 Inbox empty — nothing to triage.` and exit.

### Step 9 — Approval loop (paginated AskUserQuestion)

For each batch of up to 4 candidates:

Use `AskUserQuestion` with `multiSelect: true`:
- header: `Inbox triage`
- question: `Pick the ones to turn into Notion tasks:`
- options: up to 4 candidates `{ label: <summary>, description: "<source> · <from> · <subject>" }` plus `{ label: "Skip rest", description: "Stop triaging" }`

If "Skip rest", break out. Remaining candidates stay in the JSONL.

### Step 10 — Per-accepted due date

For each accepted candidate, single-select `AskUserQuestion`:
- header: `Due date`
- question: `Due date for: <summary>`
- options:
  - `Today (EOD)` → today @ 18:00 local
  - `Tomorrow` → tomorrow @ 09:00 local
  - `This Friday` → upcoming Friday @ 18:00 local
  - `Next Monday` → next Monday @ 09:00 local

For "Other", parse `YYYY-MM-DD` or natural phrases. Default timezone is `process.env.TZ` or `Asia/Seoul`.

### Step 11 — Resolve Notion DB schema (cached)

Run:

```bash
node scripts/inbox-cli.mjs schema-cache get
```

If the result is `null` or `taskDb.fetchedAt` is older than 7 days:
- Use `mcp__claude_ai_Notion__notion-fetch` on `notion.taskDb` to read the property schema.
- Identify the title, status (`type: "status"`), assignee (`type: "people"`), and due-date (`type: "date"`, name = `config.notion.dueDateProperty`).
- Save the cache:

```bash
echo '{"taskDb":{"id":"<dbid>","titleProp":"<name>","statusProp":"<name>","assigneeProp":"<name>","dueDateProp":"<name>"}}' | node scripts/inbox-cli.mjs schema-cache set
```

### Step 12 — Create Notion pages

For each accepted candidate, call `mcp__claude_ai_Notion__notion-create-pages` with:

```json
{
  "parent": { "database_id": "<taskDb.id>" },
  "properties": {
    "<titleProp>": { "title": [{ "text": { "content": "<summary>" } }] },
    "<statusProp>": { "status": { "name": "할 일" } },
    "<assigneeProp>": { "people": [{ "id": "<notion.userId>" }] },
    "<dueDateProp>": { "date": { "start": "<chosen ISO8601 with TZ>" } }
  },
  "children": [
    { "object": "block", "type": "paragraph", "paragraph": { "rich_text": [
      { "type": "text", "text": { "content": "Source: " } },
      { "type": "text", "text": { "content": "<from> — <subject>", "link": { "url": "<sourceUrl>" } } }
    ]}},
    { "object": "block", "type": "paragraph", "paragraph": { "rich_text": [
      { "type": "text", "text": { "content": "<redacted snippet>" } }
    ]}}
  ]
}
```

If the create call fails with a property-name mismatch, delete the schema cache file, re-run Step 11, and retry once. On second failure, leave the candidate in the JSONL and surface a warning.

### Step 13 — Finalize state

```bash
echo '{"accepted":[<ids>],"rejected":[<ids>]}' | node scripts/inbox-cli.mjs complete
```

This removes them from the JSONL. Unreached candidates (Skip rest, terminal close) stay.

### Step 14 — Confirm

Emit a single summary line:

```
✅ Created N tasks in Notion: [TSK-XXX], [TSK-XXY], ...
```

If `uniqueId`s are not available, fall back to titles. If zero were created, emit `📭 No tasks created.`.

## Failure handling

| Failure | Behavior |
|---------|----------|
| `inbox.enabled` false | Abort with setup hint. |
| Gmail connector not authed | Skip Gmail, continue Chat. |
| `gws` missing / unauth | Skip Chat, continue Gmail. |
| Notion schema fetch fails | Use stale cache if any; else abort create. |
| Notion create property mismatch | Invalidate cache, retry once. |
| User picks "Skip rest" | Remaining candidates stay in JSONL. |
| Zero candidates after filter/classify | Silent exit with empty-inbox notice. |
````

- [ ] **Step 3: Verify the file is well-formed**

```bash
head -5 skills/scan-inbox/SKILL.md
```
Expected: first line `---`, contains `name: codepresso:scan-inbox`.

- [ ] **Step 4: Commit**

```bash
git add skills/scan-inbox/SKILL.md
git commit -m "feat(inbox): add scan-inbox skill procedure"
```

---

## Task 8: Extend `session-start.mjs` to inject the morning scan instruction

**Files:**
- Modify: `scripts/session-start.mjs`

The gating helper `shouldRunInboxScan` was already added and tested in Task 4. This task wires it in.

- [ ] **Step 1: Add the import**

Near the existing `./lib/...` imports in `scripts/session-start.mjs`, add:

```javascript
import { shouldRunInboxScan } from './lib/inbox-state.mjs';
```

- [ ] **Step 2: Add daily-flag helpers**

Near the existing `GREETING_STATE_FILE` constant (around line 24), add:

```javascript
const INBOX_LAST_RUN_FILE = join(homedir(), '.codepresso', 'inbox-last-run.json');

function readInboxLastRunDate() {
  try {
    const raw = readFileSync(INBOX_LAST_RUN_FILE, 'utf-8');
    return JSON.parse(raw).lastDate || null;
  } catch {
    return null;
  }
}

function markInboxScanScheduled(todayDate) {
  try {
    mkdirSync(dirname(INBOX_LAST_RUN_FILE), { recursive: true });
    writeFileSync(INBOX_LAST_RUN_FILE, JSON.stringify({ lastDate: todayDate }, null, 2), 'utf-8');
  } catch (err) {
    log.error(`Failed to update inbox-last-run: ${err.message}`);
  }
}

function todayLocalDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
```

Ensure `mkdirSync`, `readFileSync`, `writeFileSync` are imported from `node:fs`, and `dirname` from `node:path`. If any are missing, add them to the existing imports.

- [ ] **Step 3: Inject the scan instruction**

In the same scope as the existing daily-greeting block (around line 215), add AFTER the greeting check:

```javascript
    // Inbox scan instruction (first weekday session of the day, when enabled)
    const today = todayLocalDate();
    const dayOfWeek = new Date().getDay();
    const inboxLastRun = readInboxLastRunDate();
    if (shouldRunInboxScan(config, today, inboxLastRun, dayOfWeek)) {
      contextParts.push(
        '[Codepresso] Morning inbox routine: invoke the codepresso:scan-inbox skill to triage Gmail + Chat for action-item messages.'
      );
      markInboxScanScheduled(today);
      log.info(`Inbox scan instruction injected (today=${today})`);
    }
```

- [ ] **Step 4: Manual smoke test**

```bash
echo '{}' | node scripts/session-start.mjs | jq '.additionalContext // ""' | head -5
```
With `inbox.enabled: false` (default), no inbox line.

To verify positive case, flip it temporarily:

```bash
node -e "const fs=require('fs'),p=require('os').homedir()+'/.codepresso/config.json';const c=JSON.parse(fs.readFileSync(p,'utf-8'));c.inbox={enabled:true};fs.writeFileSync(p,JSON.stringify(c,null,2));"
rm -f ~/.codepresso/inbox-last-run.json
echo '{}' | node scripts/session-start.mjs | jq -r '.additionalContext'
```

Expected: output contains `[Codepresso] Morning inbox routine: ...`. Revert `inbox.enabled` to `false` after.

If running on a weekend, this test will not fire — the gating helper rejects Sat/Sun.

- [ ] **Step 5: Commit**

```bash
git add scripts/session-start.mjs
git commit -m "feat(inbox): inject morning scan instruction in session-start hook"
```

---

## Task 9: Extend `daily-chat-greeting.mjs` with reminder sections

**Files:**
- Modify: `scripts/daily-chat-greeting.mjs`

The formatter `formatReminderSections` was already added and tested in Task 4.

- [ ] **Step 1: Inspect the existing message-assembly block**

```bash
grep -n 'sendChatMessage\|claude.*haiku\|body\s*=\|message\s*=' scripts/daily-chat-greeting.mjs | head -20
```

Locate the variable name used for the final message body and the place where `sendChatMessage` is called.

- [ ] **Step 2: Add the imports**

Near the top of `scripts/daily-chat-greeting.mjs`, add:

```javascript
import { Client as NotionClient } from '@notionhq/client';
import { formatReminderSections } from './lib/inbox-state.mjs';
```

- [ ] **Step 3: Add the Notion query helper**

After the imports but before `main` (or near the other helper functions in the file), add:

```javascript
async function queryReminderTasks(config) {
  const apiKey = config.notion?.apiKey;
  const dbId = config.inbox?.notion?.taskDatabaseId || config.notion?.databases?.task;
  const userId = config.notion?.userId;
  const dueProp = config.inbox?.notion?.dueDateProperty || '마감일';
  const assigneeProp = config.notion?.assigneeProperty || 'Assignee';
  const empty = { overdue: [], dueToday: [] };
  if (!apiKey || !dbId || !userId) return empty;

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  try {
    const client = new NotionClient({ auth: apiKey });
    const resp = await client.databases.query({
      database_id: dbId,
      filter: {
        and: [
          { property: assigneeProp, people: { contains: userId } },
          { property: '상태', status: { does_not_equal: '완료' } },
          { property: dueProp, date: { on_or_before: todayEnd.toISOString() } },
        ],
      },
      page_size: 50,
    });
    const overdue = [];
    const dueToday = [];
    for (const page of resp.results) {
      const props = page.properties || {};
      const titleProp = Object.values(props).find((p) => p.type === 'title');
      const title = titleProp?.title?.map((t) => t.plain_text).join('') || '(untitled)';
      const dueRaw = props[dueProp]?.date?.start;
      if (!dueRaw) continue;
      const uniqueIdProp = Object.values(props).find((p) => p.type === 'unique_id');
      const uniqueId = uniqueIdProp?.unique_id
        ? `${uniqueIdProp.unique_id.prefix}-${uniqueIdProp.unique_id.number}`
        : null;
      const row = { title, uniqueId, dueDate: dueRaw };
      if (Date.parse(dueRaw) < todayStartMs) overdue.push(row);
      else dueToday.push(row);
    }
    return { overdue, dueToday };
  } catch (err) {
    log.error(`Reminder query failed: ${err.message}`);
    return empty;
  }
}
```

- [ ] **Step 4: Wire the reminder sections into the message body**

Find the block that assembles the final Chat message body. Just before calling `sendChatMessage(...)`, add:

```javascript
    const reminderConfig = config.inbox?.reminder || {};
    if (config.inbox?.enabled && (reminderConfig.showOverdue || reminderConfig.showDueToday)) {
      const { overdue, dueToday } = await queryReminderTasks(config);
      const filteredOverdue = reminderConfig.showOverdue ? overdue : [];
      const filteredDueToday = reminderConfig.showDueToday ? dueToday : [];
      const reminderText = formatReminderSections(
        filteredOverdue,
        filteredDueToday,
        { maxPerSection: reminderConfig.maxPerSection ?? 5 },
      );
      if (reminderText) {
        message = message ? `${message}\n\n${reminderText}` : reminderText;
      }
    }
```

Replace `message` with whatever variable the existing script uses to assemble the body.

- [ ] **Step 5: Manual smoke test**

If you have `inbox.enabled: true` + Notion API key set + a task DB with the due-date property, generate a payload and run the script:

```bash
ls .codepresso/state/codepresso-greeting-*.json 2>/dev/null | head -1
node scripts/daily-chat-greeting.mjs <payload-path> 2>&1 | tail -20
```

Expected: no errors. The Chat message includes the new sections when there are overdue/due-today tasks.

- [ ] **Step 6: Commit**

```bash
git add scripts/daily-chat-greeting.mjs
git commit -m "feat(inbox): add overdue + due-today reminder sections to morning greeting"
```

---

## Task 10: Extend `skills/setup/SKILL.md` with the inbox setup sub-step

**Files:**
- Modify: `skills/setup/SKILL.md`

- [ ] **Step 1: Inspect existing wizard structure**

```bash
cat skills/setup/SKILL.md
```

Note the last step number used. The new step appended below assumes it's step 11; adjust if the existing wizard already uses that number.

- [ ] **Step 2: Append the new step**

Append to `skills/setup/SKILL.md`:

```markdown
### Step 11: Inbox scan setup (optional)

Ask the user: `"Enable inbox task tracker (scans Gmail + Chat for action items)? [y/N]"`. If `n`, skip this step.

#### 11.1 Gmail connector

Verify `mcp__claude_ai_Gmail` is authenticated:
1. Call `mcp__claude_ai_Gmail__authenticate`. If already authenticated, continue. Otherwise complete OAuth via `mcp__claude_ai_Gmail__complete_authentication`.
2. Confirm by listing 1 message from inbox.

If unable, emit `⚠️ Gmail not authed — inbox will use Chat only until you re-run setup.` and continue to 11.4.

#### 11.2 Notion task database schema

Ask the user for the task database ID (default to existing `notion.databases.task`). Save to `inbox.notion.taskDatabaseId` if different.

Fetch the database schema via `mcp__claude_ai_Notion__notion-fetch`:
- If a property with type `date` and name matching `inbox.notion.dueDateProperty` (default `마감일`) exists, continue to 11.3.
- If absent, prompt: `"Add date property '마감일' to your task DB? [Y/n]"`.
  - If yes: call `mcp__claude_ai_Notion__notion-update-data-source` with `{ "data_source_id": "<dbid>", "properties": { "마감일": { "date": {} } } }`.
  - If no: prompt for the existing property name and save to `inbox.notion.dueDateProperty`.

#### 11.3 Reminder configuration (one-time manual step)

Emit verbatim:

```
📅 One-time Notion setup needed for native reminders:
   1. Open your task database in Notion.
   2. Click the "마감일" property header.
   3. Click "Edit property".
   4. Toggle on "Remind me".
   5. Set "On day at 9am" (or your preferred reminder offset).

   You can skip this — the plugin's morning Chat ping will still surface
   overdue + due-today tasks regardless.
```

#### 11.4 Chat space IDs

Ask: `"Which Chat space IDs should the scan watch? (comma-separated, or Enter for DMs only)"`. Save to `inbox.sources.chat.spaceIds`.

#### 11.5 Flip the master switch

Update `~/.codepresso/config.json` to set `inbox.enabled: true`.

Emit `✅ Inbox scan enabled. Run /codepresso:scan-inbox to try it now, or wait for tomorrow morning.`
```

- [ ] **Step 3: Commit**

```bash
git add skills/setup/SKILL.md
git commit -m "feat(setup): add inbox scan setup sub-step"
```

---

## Task 11: Update `CLAUDE.md` with inbox flow documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add to architecture file tree**

In the `## Architecture` directory tree:
- After the `scripts/lib/` listing, add: `│   │   ├── inbox-state.mjs        # Seen-ID dedup, candidate JSONL, schema cache, gating + formatter helpers`
- After the `scripts/` script listing, add: `│   ├── inbox-cli.mjs              # CLI dispatcher invoked by the scan-inbox skill (prep/redact/stage/complete/schema-cache)`
- In the `skills/` listing, add: `│   ├── scan-inbox/SKILL.md        # Inbox triage routine (Gmail + Chat → Notion tasks with due dates)`

- [ ] **Step 2: Add a Data Flow line**

After the existing `Weekday 18:03` data-flow line, add:

```
Inbox scan      → /codepresso:scan-inbox OR morning session-start instruction
                → claude_ai_Gmail + gws fetchChatUnread → filter by seen-IDs
                → classify in-conversation → inbox-cli stage → AskUserQuestion (paginated)
                → per-task due date → claude_ai_Notion create-pages → inbox-cli complete
```

- [ ] **Step 3: Add a Design Decision entry**

After the existing "11. Sprint Workflow" decision, add:

```markdown
### 12. Inbox Task Tracker — Claude-Driven Routine

Tasks arriving via Gmail or Google Chat are surfaced by a markdown skill (`skills/scan-inbox/SKILL.md`) that Claude follows in-conversation. Deterministic state ops (seen-ID dedup, candidate persistence, schema cache, redaction) are isolated in `scripts/lib/inbox-state.mjs` and exposed via `scripts/inbox-cli.mjs` — the skill calls the CLI for any state mutation. Source fetching uses the official `mcp__claude_ai_Gmail` connector for email and `gws` CLI for Chat. Notion writes use the official `mcp__claude_ai_Notion` connector. The morning trigger is a single `additionalContext` line injected by `session-start.mjs` on the first weekday session of the day (gated by `~/.codepresso/inbox-last-run.json`). Reminders for due-today + overdue tasks are appended to the existing `daily-chat-greeting.mjs` Chat message via `formatReminderSections`. The entire feature ships behind `inbox.enabled: false` until the setup wizard flips it.
```

- [ ] **Step 4: Add new rows to the State Files table**

Append to the `## State Files` table:

```
| `codepresso-inbox-seen.json` | JSON | Dedup: source IDs already triaged. Pruned to 30 days on every write. |
| `codepresso-inbox-candidates.jsonl` | JSONL | Pending candidates between scan and approval. Survives across interrupted runs. |
| `codepresso-inbox-cache.json` | JSON | Cached Notion task-DB property names. 7-day TTL. |
```

Under the `Daily greeting state` table:

```
| `inbox-last-run.json` | JSON | Last date the inbox scan instruction was injected (`{ lastDate: "YYYY-MM-DD" }`) |
```

- [ ] **Step 5: Add `inbox` to the Configuration Schema example**

In the `## Configuration Schema` JSONC block, after the `googleChat` block, add:

```jsonc
  "inbox": {
    "enabled": false,
    "sources": {
      "gmail": { "enabled": true, "lookbackHours": 24, "query": "in:inbox is:unread -category:promotions -category:social", "maxResults": 30 },
      "chat":  { "enabled": true, "lookbackHours": 24, "spaceIds": [], "maxPerSpace": 20 }
    },
    "ignoreSenders": ["noreply@", "notifications@github\\.com", "no-reply@"],
    "classifier": { "maxCandidatesPerScan": 10 },
    "notion": { "taskDatabaseId": null, "dueDateProperty": "마감일", "defaultDueOption": "Tomorrow" },
    "reminder": { "showOverdue": true, "showDueToday": true, "maxPerSection": 5 }
  },
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): document inbox task tracker flow"
```

---

## Task 12: End-to-end verification

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass. New tests contribute:
- `tests/lib/config.test.mjs` — 4 new tests for inbox config
- `tests/lib/inbox-state.test.mjs` — 22 tests
- `tests/lib/gws-fetch.test.mjs` — 4 tests
- `tests/lib/inbox-cli.test.mjs` — 4 tests

- [ ] **Step 2: Lint the skill markdown via spot check**

```bash
grep -c 'mcp__claude_ai_Gmail' skills/scan-inbox/SKILL.md
grep -c 'mcp__claude_ai_Notion' skills/scan-inbox/SKILL.md
grep -c 'inbox-cli' skills/scan-inbox/SKILL.md
```
Expected: each `> 0`.

- [ ] **Step 3: Manual smoke (optional, requires real auth)**

If Gmail connector and Notion key are set up locally, flip `inbox.enabled: true` in `~/.codepresso/config.json`, then in a Claude Code session run `/codepresso:scan-inbox` and walk through the picker. Verify Notion pages get created with due dates. Revert `inbox.enabled` after testing.

- [ ] **Step 4: No additional commit unless smoke test reveals a fix**

If green, the feature is complete and ready to merge.

---

## Notes for the implementer

- **No new MCP servers**. Gmail + Notion use official Claude.ai connectors; the existing `codepresso-notion` MCP is not used for inbox writes.
- **Notion `time_zone` field**: optional. The connector accepts ISO8601 with offset (e.g. `2026-05-17T09:00:00+09:00`).
- **`gws` Chat subcommand**: implementation uses `gws chat spaces messages list --parent spaces/<id> --filter '<f>'`. If your local `gws` rejects this, run `gws chat --help` and adjust the command string in `lib/gws.mjs`. Tests use an injected runner so they will not regress.
- **Idempotency**: Tasks 2 + 4 mark source IDs seen at scan time. Tasks 3 + 6 keep unreached candidates in JSONL for next run.
- **Test isolation**: every test creates its own `mkdtempSync` and cleans up in `afterEach`. No `~/.codepresso/` pollution.
- **Observability deferred**: The spec calls for a daily rotated log at `~/.codepresso/logs/inbox-<date>.log` and an `inbox_scan` analytics event in `sessions.jsonl`. These are intentionally **not** in this plan — they are orthogonal nice-to-haves that can land in a follow-up PR once the feature is working end-to-end. If the implementer wants to add them, the hooks are `lib/logger.mjs` (createLogger) and `lib/analytics.mjs` — wire calls into `scripts/inbox-cli.mjs` `stage` and `complete` subcommands.
