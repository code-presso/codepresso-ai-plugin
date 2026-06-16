# Google Calendar in Daily Chat & Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show my timed appointments (today's in the morning greeting, tomorrow's in the evening summary) by reading my primary Google Calendar via the `gws` CLI, filtering out all-day/other-calendar noise.

**Architecture:** A new pure-logic-plus-DI library `scripts/lib/calendar.mjs` (mirrors `gws.mjs`) does calendar fetch + filter + format. `daily-chat-greeting.mjs` inserts a `📅 오늘 일정` block right after the date header; `daily-chat-summary.mjs` appends a `📅 내일 일정` block at the end. Config gains `googleChat.calendar`.

**Tech Stack:** Node.js ESM `.mjs`, `gws` CLI (read-only `calendar +agenda` / `calendarList list`), `node:test` + `node:assert/strict`, `Intl.DateTimeFormat` for KST time rendering.

**Conventions (verified against codebase):**
- Tests: `tests/lib/<name>.test.mjs`, run via `npm test` (`node --test tests/lib/*.test.mjs`). Use `import { describe, it } from 'node:test'` and `import assert from 'node:assert/strict'`.
- gws DI pattern: exported functions take an optional `runner = defaultRunner` where `defaultRunner(cmd)` = `execSync(cmd, { shell: 'bash', timeout: 15000, stdio: [...] }).toString()`. Tests pass a canned `runner`.
- Config: `DEFAULT_CONFIG` in `scripts/lib/config.mjs`; `mergeSections` deep-merges one level inside a section, so `googleChat.calendar` sub-keys merge correctly.
- Failure mode: calendar errors must never crash a bookend — return `[]`/`null` and omit the section.

---

## File Structure

- **Create** `scripts/lib/calendar.mjs` — calendar fetch (gws), pure filter, pure formatting.
- **Create** `tests/lib/calendar.test.mjs` — unit tests for pure functions + DI-seam functions.
- **Modify** `scripts/lib/config.mjs` — add `googleChat.calendar` default + validation.
- **Modify** `scripts/daily-chat-greeting.mjs` — fetch today's events, insert section after date header.
- **Modify** `scripts/daily-chat-summary.mjs` — fetch tomorrow's events, append section at end.
- **Modify** `CLAUDE.md` — Decision #6 + config schema doc.

---

## Task 1: `calendar.mjs` — pure filter `filterMyTimedEvents`

**Files:**
- Create: `scripts/lib/calendar.mjs`
- Test: `tests/lib/calendar.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/calendar.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterMyTimedEvents } from '../../scripts/lib/calendar.mjs';

const PRIMARY = 'kyeongwook.ma@codepresso.kr';

const SAMPLE = [
  { calendar: '부재 일정', start: '2026-06-16', end: '2026-06-17', summary: '🌴 [최정희] 휴가' },
  { calendar: 'on call 대응', start: '2026-06-15', end: '2026-06-22', summary: '온콜' },
  { calendar: '부재 일정', start: '2026-06-16T04:00:00Z', end: '2026-06-16T08:00:00Z', summary: '🌴 [양지현] 휴가' },
  { calendar: PRIMARY, start: '2026-06-16T10:00:00+09:00', end: '2026-06-16T11:00:00+09:00', summary: '주간미팅' },
  { calendar: '커뮤니티 공간 예약', start: '2026-06-16T11:00:00+09:00', end: '2026-06-16T12:00:00+09:00', summary: '제품본부' },
  { calendar: PRIMARY, start: '2026-06-16T09:00:00+09:00', end: '2026-06-16T10:00:00+09:00', summary: 'AXMOS 주간 미팅' },
];

describe('filterMyTimedEvents', () => {
  it('keeps only timed events on the primary calendar, sorted by start', () => {
    const out = filterMyTimedEvents(SAMPLE, PRIMARY);
    assert.equal(out.length, 2);
    assert.equal(out[0].summary, 'AXMOS 주간 미팅'); // 09:00 sorts before 10:00
    assert.equal(out[1].summary, '주간미팅');
  });

  it('drops all-day (date-only) events even on the primary calendar', () => {
    const allDayPrimary = [{ calendar: PRIMARY, start: '2026-06-16', end: '2026-06-17', summary: '종일' }];
    assert.deepEqual(filterMyTimedEvents(allDayPrimary, PRIMARY), []);
  });

  it('returns [] for non-array input or missing primary', () => {
    assert.deepEqual(filterMyTimedEvents(null, PRIMARY), []);
    assert.deepEqual(filterMyTimedEvents(SAMPLE, null), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `filterMyTimedEvents` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/lib/calendar.mjs`:

```js
import { execSync } from 'node:child_process';
import { createLogger } from './logger.mjs';

const logger = createLogger('calendar');

/**
 * Keep only timed events (start has a time component) on the primary calendar,
 * sorted ascending by start. Pure.
 * @param {Array<{calendar:string,start:string,end:string,summary:string}>} events
 * @param {string|null} primarySummary  The primary calendar's summary (== account email).
 * @returns {Array} filtered + sorted events
 */
export function filterMyTimedEvents(events, primarySummary) {
  if (!Array.isArray(events) || !primarySummary) return [];
  return events
    .filter((e) => e && e.calendar === primarySummary && String(e.start || '').includes('T'))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 `filterMyTimedEvents` tests green).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/calendar.mjs tests/lib/calendar.test.mjs
git commit -m "feat(calendar): add filterMyTimedEvents pure filter"
```

---

## Task 2: `calendar.mjs` — `formatEventTime`

**Files:**
- Modify: `scripts/lib/calendar.mjs`
- Test: `tests/lib/calendar.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/calendar.test.mjs`:

```js
import { formatEventTime } from '../../scripts/lib/calendar.mjs';

describe('formatEventTime', () => {
  it('renders +09:00 datetimes in KST HH:MM–HH:MM', () => {
    assert.equal(
      formatEventTime('2026-06-16T09:00:00+09:00', '2026-06-16T10:00:00+09:00'),
      '09:00–10:00',
    );
  });

  it('converts a Z (UTC) datetime to KST', () => {
    // 04:00Z == 13:00 KST
    assert.equal(
      formatEventTime('2026-06-16T04:00:00Z', '2026-06-16T05:30:00Z'),
      '13:00–14:30',
    );
  });

  it('returns start-only when end is missing', () => {
    assert.equal(formatEventTime('2026-06-16T09:00:00+09:00', null), '09:00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `formatEventTime` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/lib/calendar.mjs`:

```js
const KST_FMT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Seoul',
});

function hhmm(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return KST_FMT.format(d); // en-GB 24h => "HH:MM"
}

/**
 * Render an event time range in KST as "HH:MM–HH:MM" (en-dash).
 * Start-only when end is falsy/invalid. Pure.
 */
export function formatEventTime(startIso, endIso) {
  const start = hhmm(startIso);
  const end = endIso ? hhmm(endIso) : '';
  if (start && end) return `${start}–${end}`;
  return start;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. (Note: `en-GB` 2-digit hour renders `09:00`, not `9:00`.)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/calendar.mjs tests/lib/calendar.test.mjs
git commit -m "feat(calendar): add formatEventTime KST renderer"
```

---

## Task 3: `calendar.mjs` — `formatCalendarSection`

**Files:**
- Modify: `scripts/lib/calendar.mjs`
- Test: `tests/lib/calendar.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/calendar.test.mjs`:

```js
import { formatCalendarSection } from '../../scripts/lib/calendar.mjs';

const EVENTS = [
  { start: '2026-06-16T09:00:00+09:00', end: '2026-06-16T10:00:00+09:00', summary: 'AXMOS 주간 미팅' },
  { start: '2026-06-16T10:00:00+09:00', end: '2026-06-16T11:00:00+09:00', summary: '주간미팅' },
];

describe('formatCalendarSection', () => {
  it('builds a titled block with one line per event', () => {
    const out = formatCalendarSection(EVENTS, { title: '오늘 일정' });
    assert.ok(out.includes('📅 *오늘 일정*'));
    assert.ok(out.includes('• 09:00–10:00 AXMOS 주간 미팅'));
    assert.ok(out.includes('• 10:00–11:00 주간미팅'));
  });

  it('caps at maxEvents and adds an overflow line', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      start: `2026-06-16T0${i}:00:00+09:00`, end: `2026-06-16T0${i}:30:00+09:00`, summary: `e${i}`,
    }));
    const out = formatCalendarSection(many, { title: 'T', maxEvents: 3 });
    assert.equal((out.match(/•/g) || []).length, 3);
    assert.ok(out.includes('외 2건'));
  });

  it('returns emptyText line when empty and emptyText provided', () => {
    const out = formatCalendarSection([], { title: '오늘 일정', emptyText: '_없음_' });
    assert.ok(out.includes('📅 *오늘 일정*'));
    assert.ok(out.includes('_없음_'));
  });

  it('returns "" when empty and no emptyText', () => {
    assert.equal(formatCalendarSection([], { title: '내일 일정' }), '');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `formatCalendarSection` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/lib/calendar.mjs`:

```js
/**
 * Build a Google-Chat-friendly calendar section. Pure.
 * @param {Array} events  already filtered + sorted
 * @param {{title:string, emptyText?:string, maxEvents?:number}} opts
 * @returns {string} the section text, or '' when empty and no emptyText
 */
export function formatCalendarSection(events, { title, emptyText, maxEvents = 8 } = {}) {
  const list = Array.isArray(events) ? events : [];
  if (list.length === 0) {
    if (!emptyText) return '';
    return [`📅 *${title}*`, emptyText].join('\n');
  }
  const lines = [`📅 *${title}*`];
  const shown = list.slice(0, maxEvents);
  for (const e of shown) {
    lines.push(`• ${formatEventTime(e.start, e.end)} ${e.summary || '(제목 없음)'}`);
  }
  if (list.length > maxEvents) lines.push(`_외 ${list.length - maxEvents}건_`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all `formatCalendarSection` tests green).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/calendar.mjs tests/lib/calendar.test.mjs
git commit -m "feat(calendar): add formatCalendarSection formatter"
```

---

## Task 4: `calendar.mjs` — gws fetchers + `getMyTimedEvents` orchestrator (DI seam)

**Files:**
- Modify: `scripts/lib/calendar.mjs`
- Test: `tests/lib/calendar.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/calendar.test.mjs`:

```js
import { getMyTimedEvents } from '../../scripts/lib/calendar.mjs';

const PRIMARY2 = 'me@codepresso.kr';

function makeRunner({ failAgenda = false } = {}) {
  return (cmd) => {
    if (cmd.includes('calendarList list')) {
      return JSON.stringify({ items: [
        { id: 'roomcal', summary: '커뮤니티 공간 예약' },
        { id: PRIMARY2, summary: PRIMARY2, primary: true },
      ] });
    }
    if (cmd.includes('+agenda')) {
      if (failAgenda) throw new Error('gws: not authed');
      return JSON.stringify({ count: 2, events: [
        { calendar: PRIMARY2, start: '2026-06-16T10:00:00+09:00', end: '2026-06-16T11:00:00+09:00', summary: 'mine' },
        { calendar: '커뮤니티 공간 예약', start: '2026-06-16T12:00:00+09:00', end: '2026-06-16T13:00:00+09:00', summary: 'room' },
      ] });
    }
    return '{}';
  };
}

describe('getMyTimedEvents', () => {
  it('auto-detects primary and returns only my timed events', () => {
    const cfg = { googleChat: { calendar: { enabled: true } } };
    const out = getMyTimedEvents({ when: 'today', config: cfg, runner: makeRunner() });
    assert.equal(out.length, 1);
    assert.equal(out[0].summary, 'mine');
  });

  it('honors an explicit calendarId override (skips calendarList)', () => {
    const cfg = { googleChat: { calendar: { enabled: true, calendarId: PRIMARY2 } } };
    let listCalled = false;
    const runner = (cmd) => {
      if (cmd.includes('calendarList')) { listCalled = true; }
      return makeRunner()(cmd);
    };
    const out = getMyTimedEvents({ when: 'tomorrow', config: cfg, runner });
    assert.equal(out.length, 1);
    assert.equal(listCalled, false);
  });

  it('returns [] when calendar disabled', () => {
    const cfg = { googleChat: { calendar: { enabled: false } } };
    assert.deepEqual(getMyTimedEvents({ when: 'today', config: cfg, runner: makeRunner() }), []);
  });

  it('returns [] when agenda fetch throws', () => {
    const cfg = { googleChat: { calendar: { enabled: true } } };
    assert.deepEqual(getMyTimedEvents({ when: 'today', config: cfg, runner: makeRunner({ failAgenda: true }) }), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `getMyTimedEvents` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/lib/calendar.mjs`:

```js
function defaultRunner(cmd) {
  return execSync(cmd, { shell: 'bash', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

/**
 * Resolve the primary calendar's summary (== account email) via gws calendarList.
 * Returns null on any failure.
 */
export function fetchPrimaryCalendarSummary(runner = defaultRunner) {
  try {
    const raw = runner('gws calendar calendarList list --format json');
    const parsed = JSON.parse(raw || '{}');
    const items = parsed.items || parsed || [];
    const primary = (Array.isArray(items) ? items : []).find((i) => i && i.primary === true);
    return primary ? primary.summary || primary.id || null : null;
  } catch (err) {
    logger.warn(`fetchPrimaryCalendarSummary failed: ${err.message}`);
    return null;
  }
}

/**
 * Fetch agenda events for today|tomorrow. `calendarId` (optional) filters server-side.
 * Returns [] on any failure.
 * @param {{ when:'today'|'tomorrow', calendarId?:string|null, runner?:Function }} opts
 */
export function fetchAgenda({ when, calendarId = null, runner = defaultRunner }) {
  const flag = when === 'tomorrow' ? '--tomorrow' : '--today';
  let cmd = `gws calendar +agenda ${flag} --format json`;
  if (calendarId) cmd += ` --calendar '${String(calendarId).replace(/'/g, "")}'`;
  try {
    const raw = runner(cmd);
    const parsed = JSON.parse(raw || '{}');
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch (err) {
    logger.warn(`fetchAgenda(${when}) failed: ${err.message}`);
    return [];
  }
}

/**
 * High-level: resolve primary (config override → auto-detect), fetch agenda, filter
 * to my timed events. Returns [] on disabled/any failure. Never throws.
 * @param {{ when:'today'|'tomorrow', config:object, runner?:Function }} opts
 */
export function getMyTimedEvents({ when, config, runner = defaultRunner }) {
  const cal = config?.googleChat?.calendar;
  if (!cal || cal.enabled === false) return [];
  try {
    const override = cal.calendarId || null;
    const primarySummary = override || fetchPrimaryCalendarSummary(runner);
    if (!primarySummary) return [];
    const events = fetchAgenda({ when, calendarId: override, runner });
    const filtered = filterMyTimedEvents(events, primarySummary);
    const max = typeof cal.maxEvents === 'number' ? cal.maxEvents : 8;
    return filtered.slice(0, max);
  } catch (err) {
    logger.warn(`getMyTimedEvents failed: ${err.message}`);
    return [];
  }
}
```

> Note on the override path: when `calendarId` is set, `+agenda --calendar <id>` filters server-side, but the returned events' `calendar` field still equals the calendar summary. To keep `filterMyTimedEvents` working in both paths, the override value is used as `primarySummary`. The live primary calendar's id **and** summary are both the account email, so this matches. (If a team member sets a non-email group-id as `calendarId`, document that they should set it to the calendar's *summary*, not its opaque id — see CLAUDE.md note in Task 7.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all `getMyTimedEvents` tests green).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/calendar.mjs tests/lib/calendar.test.mjs
git commit -m "feat(calendar): add gws fetchers and getMyTimedEvents orchestrator"
```

---

## Task 5: Config default + validation for `googleChat.calendar`

**Files:**
- Modify: `scripts/lib/config.mjs:53-57` (googleChat default block)
- Modify: `scripts/lib/config.mjs` (validateConfig googleChat block, ~line 281)
- Test: `tests/lib/config.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/config.test.mjs` (inside the existing top-level `describe` or as a new one — match the file's existing style; use `loadConfig` with a temp global path or inspect defaults). Add:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../scripts/lib/config.mjs';

describe('googleChat.calendar defaults', () => {
  it('defaults calendar to enabled with auto-detect and maxEvents 8', () => {
    // load with a non-existent global path so only defaults apply
    const cfg = loadConfig(process.cwd(), { globalConfigPath: '/no/such/codepresso-config.json' });
    assert.equal(cfg.googleChat.calendar.enabled, true);
    assert.equal(cfg.googleChat.calendar.calendarId, null);
    assert.equal(cfg.googleChat.calendar.maxEvents, 8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `cfg.googleChat.calendar` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `scripts/lib/config.mjs`, change the `googleChat` default block (lines 53-57) to:

```js
  googleChat: {
    enabled: false,
    dailyGreeting: true,
    spaceId: null,                // Google Chat space ID (e.g., 'AAAAxxxxxxx')
    calendar: {
      enabled: true,              // show calendar sections (still requires googleChat.enabled)
      calendarId: null,           // null = auto-detect primary; or explicit calendar id/summary
      maxEvents: 8,               // cap lines per calendar section
    },
  },
```

Then add validation inside the existing `if (config.googleChat) { ... }` block in `validateConfig` (after the `spaceId` check, ~line 290):

```js
    const cal = config.googleChat.calendar;
    if (cal) {
      if (typeof cal.enabled !== 'undefined' && typeof cal.enabled !== 'boolean') {
        warnings.push(`googleChat.calendar.enabled should be boolean, got ${typeof cal.enabled}`);
      }
      if (cal.calendarId !== null && cal.calendarId !== undefined && typeof cal.calendarId !== 'string') {
        warnings.push(`googleChat.calendar.calendarId should be a string, got ${typeof cal.calendarId}`);
      }
      if (typeof cal.maxEvents !== 'undefined' && (typeof cal.maxEvents !== 'number' || cal.maxEvents <= 0)) {
        warnings.push(`googleChat.calendar.maxEvents should be a positive number, got ${cal.maxEvents}`);
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. Also confirm no pre-existing config tests broke.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/config.mjs tests/lib/config.test.mjs
git commit -m "feat(config): add googleChat.calendar defaults and validation"
```

---

## Task 6: Wire calendar into the morning greeting

**Files:**
- Modify: `scripts/daily-chat-greeting.mjs`

This is integration glue around the detached script. No unit test (the script reads a payload + shells out); verify via the manual smoke test in Step 3.

- [ ] **Step 1: Add the import and fetch**

In `scripts/daily-chat-greeting.mjs`, add to the imports (after the `formatReminderSections` import, line 20):

```js
import { getMyTimedEvents, formatCalendarSection } from './lib/calendar.mjs';
```

- [ ] **Step 2: Insert the section after the date header**

Change `formatMessage(tasks, prs, displayName)` to accept a `calendarSection` string and insert it right after the date header line and its blank line. Locate this block (lines 221-223):

```js
  lines.push(`📋 *${dateStr} (${dayStr})* 오늘의 작업 현황`);
  lines.push('');

  lines.push('*진행 중인 작업 (Notion):*');
```

Replace with:

```js
  lines.push(`📋 *${dateStr} (${dayStr})* 오늘의 작업 현황`);
  lines.push('');

  if (calendarSection) {
    lines.push(calendarSection);
    lines.push('');
  }

  lines.push('*진행 중인 작업 (Notion):*');
```

And update the signature (line 204):

```js
function formatMessage(tasks, prs, displayName, calendarSection) {
```

- [ ] **Step 3: Build the calendar section in `main` and pass it**

In `main()`, after `const prs = fetchGithubPrs(gitRoot);` (line 299) add:

```js
  const calendarEvents = getMyTimedEvents({ when: 'today', config });
  const calendarSection = formatCalendarSection(calendarEvents, {
    title: '오늘 일정',
    emptyText: '_없음_',
  });
```

Then update the `hasContent` guard (lines 301-303) so a day with only meetings still greets:

```js
  const hasContent = activeTasks.length > 0
    || (prs.authored && prs.authored.length > 0)
    || (prs.reviewRequested && prs.reviewRequested.length > 0)
    || calendarEvents.length > 0;
```

And update the `formatMessage` call (line 311):

```js
  const { text: baseMessage, taskCount } = formatMessage(activeTasks, prs, displayName, calendarSection);
```

- [ ] **Step 4: Smoke-test the formatting path (no send)**

Run a quick node check that the section renders against live gws (read-only):

```bash
node -e "import('./scripts/lib/calendar.mjs').then(async m => { const { loadConfig } = await import('./scripts/lib/config.mjs'); const ev = m.getMyTimedEvents({ when:'today', config: loadConfig() }); console.log(m.formatCalendarSection(ev, { title:'오늘 일정', emptyText:'_없음_' })); });"
```

Expected: prints `📅 *오늘 일정*` followed by my timed meetings (or `_없음_`), with NO vacation/on-call/room-booking lines.

- [ ] **Step 5: Commit**

```bash
git add scripts/daily-chat-greeting.mjs
git commit -m "feat(daily-chat): show today's calendar in morning greeting"
```

---

## Task 7: Wire calendar into the evening summary + docs

**Files:**
- Modify: `scripts/daily-chat-summary.mjs`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the import**

In `scripts/daily-chat-summary.mjs`, after the `sendChatMessage` import (line 17):

```js
import { getMyTimedEvents, formatCalendarSection } from './lib/calendar.mjs';
```

- [ ] **Step 2: Append the tomorrow section in `formatMessage`**

Change `formatMessage` to accept `calendarSection` and append it at the very end. Update the signature (line 194):

```js
function formatMessage({ displayName, summary, commits, merged, closedOnly, inProgress, calendarSection }) {
```

Before the final `return lines.join('\n').trim();` (line 237), add:

```js
  if (calendarSection) {
    lines.push('');
    lines.push(calendarSection);
  }
```

- [ ] **Step 3: Build and pass the section in `main`**

In `main()`, after the Notion `inProgress` fetch block (after line 271, before the `hasAnything` guard), add:

```js
  const calendarEvents = getMyTimedEvents({ when: 'tomorrow', config });
  const calendarSection = formatCalendarSection(calendarEvents, { title: '내일 일정' });
```

Update the `hasAnything` guard (line 273) so a day with only tomorrow-meetings still summarizes:

```js
  const hasAnything = commits.length || merged.length || closedOnly.length
    || inProgress.length || calendarEvents.length;
```

Update the `formatMessage` call (line 283):

```js
  const message = formatMessage({ displayName, summary, commits, merged, closedOnly, inProgress, calendarSection });
```

- [ ] **Step 4: Smoke-test (dry run, no send)**

```bash
CODEPRESSO_DRY_RUN=1 node scripts/daily-chat-summary.mjs
```

Expected: prints the dry-run message including a `📅 *내일 일정*` block (only if tomorrow has timed primary-calendar meetings; otherwise the block is absent). Note: exits early on weekends — if today is Sat/Sun, instead run the Step 4 smoke command from Task 6 with `when:'tomorrow'`.

- [ ] **Step 5: Update CLAUDE.md**

In `CLAUDE.md`, in "Decision #6 Daily Google Chat Bookends", add to both the morning and evening bullet lists:

- Morning greeting content list: add `, plus today's calendar meetings (📅 오늘 일정, my primary calendar only, timed events)`.
- Evening summary "Gathers:" line: add `, tomorrow's calendar meetings (📅 내일 일정)`.

Add a new line after the evening summary block:

```markdown
**Calendar source**: both bookends read the user's **primary** Google Calendar via `gws calendar +agenda` (read-only). Only *timed* events on the primary calendar are shown — all-day events (휴가/OOO, on-call, holidays) and other calendars (room bookings) are filtered out by `scripts/lib/calendar.mjs:filterMyTimedEvents`. Controlled by `googleChat.calendar.{enabled,calendarId,maxEvents}`. `calendarId` (when set) must be the calendar's **summary/email**, not an opaque group id, because events are matched by their `calendar` summary field.
```

Then update the Configuration Schema `googleChat` block to include the new `calendar` sub-object (mirror the default from Task 5).

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: ALL tests pass (calendar + config + pre-existing suites green).

- [ ] **Step 7: Commit**

```bash
git add scripts/daily-chat-summary.mjs CLAUDE.md
git commit -m "feat(daily-chat): show tomorrow's calendar in evening summary; docs"
```

---

## Self-Review

**Spec coverage:**
- `scripts/lib/calendar.mjs` with all 6 exports → Tasks 1-4. ✅
- `filterMyTimedEvents` rule (timed AND primary) → Task 1. ✅
- `formatEventTime` KST → Task 2. ✅
- `formatCalendarSection` (title/empty/cap) → Task 3. ✅
- Auto-detect primary + override + failure-safe → Task 4. ✅
- Morning section after date header, `_없음_` when empty → Task 6. ✅
- Evening section at end, omit when empty, not in LLM prompt → Task 7 (calendar built after summary, appended to message only). ✅
- Config `googleChat.calendar` defaults + validation → Task 5. ✅
- Tests file → Tasks 1-5. ✅
- CLAUDE.md Decision #6 + schema → Task 7. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✅

**Type consistency:** `getMyTimedEvents({ when, config, runner })`, `formatCalendarSection(events, { title, emptyText, maxEvents })`, `filterMyTimedEvents(events, primarySummary)`, `formatEventTime(startIso, endIso)`, `fetchAgenda({ when, calendarId, runner })`, `fetchPrimaryCalendarSummary(runner)` — names/signatures identical across Tasks 1-7. ✅

**Edge note:** Morning greeting's `formatMessage` is sync; calendar fetch happens in `main` (which is async) and the rendered string is passed in — no async added to `formatMessage`. ✅
