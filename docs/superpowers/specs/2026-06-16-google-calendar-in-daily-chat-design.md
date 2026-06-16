# Google Calendar in Daily Chat & Summary — Design

**Date:** 2026-06-16
**Status:** Approved (pending spec review)
**Author:** kyeongwookma (with Claude)

## Goal

Show *my timed appointments* (real meetings on my primary Google Calendar) in the two
existing daily Google Chat bookends:

- **Morning greeting** (`daily-chat-greeting.mjs`) — today's meetings.
- **Evening summary** (`daily-chat-summary.mjs`) — tomorrow's meetings (next-day prep).

Exclude all-day noise: teammate vacation (`부재 일정`), on-call (`on call 대응`), national
holidays (`대한민국의 휴일`), and other people's room bookings (`커뮤니티 공간 예약`).

## Context

Both bookend scripts are **detached Node processes** that cannot call MCP tools; they shell
out to the `gws` (Google Workspace) CLI. The CLI exposes a read-only agenda helper:

```
gws calendar +agenda --today  --format json
gws calendar +agenda --tomorrow --format json
```

Output shape:

```json
{ "count": 18, "events": [
  { "calendar": "kyeongwook.ma@codepresso.kr",
    "start": "2026-06-16T09:00:00+09:00", "end": "2026-06-16T10:00:00+09:00",
    "location": "", "summary": "AXMOS 주간 미팅" }
] }
```

Observed data characteristics (verified against the live account):

- **All-day events** have date-only `start`/`end` (e.g. `"2026-06-15"`, no `T`). These are
  vacation, on-call, and holidays.
- **Timed events** have an ISO datetime `start` (contains `T`).
- The `calendar` field equals that calendar's `summary`. The **primary** calendar's summary
  is the account email (verified via `gws calendar calendarList list` → item with
  `primary: true`).
- Room bookings and teammate timed-vacation are timed events but live on *other* calendars.

**Therefore the filter "my timed appointments" = `start` contains `T` AND `calendar === primarySummary`.**
This single rule drops every noise category in one pass.

## Architecture

### New shared library: `scripts/lib/calendar.mjs`

Mirrors `scripts/lib/gws.mjs`: a DI-friendly `runner` parameter (defaults to a real
`execSync`-via-bash wrapper) so pure logic is unit-testable and `gws`-calling functions
tolerate failure by returning `[]`/`null`.

| Export | Responsibility | Tested |
|--------|----------------|--------|
| `fetchPrimaryCalendarSummary(runner?)` | Run `gws calendar calendarList list --format json`; return the `summary` of the item with `primary === true` (or `null`). | indirectly |
| `fetchAgenda({ when, runner? })` | `when` ∈ `'today' \| 'tomorrow'`. Run `gws calendar +agenda --<when> --format json`; return `events[]` (or `[]`). | indirectly |
| `filterMyTimedEvents(events, primarySummary)` | Pure. Keep events where `String(start).includes('T')` and `calendar === primarySummary`. Sort by `start`. | ✅ |
| `formatEventTime(startIso, endIso)` | Pure. Return `"09:00–10:00"` rendered in `Asia/Seoul`. | ✅ |
| `formatCalendarSection(events, { title, emptyText, maxEvents })` | Pure. Build a `📅 *{title}*` block, one `• HH:MM–HH:MM 제목` line per event (capped at `maxEvents`, with `_외 N건_` overflow line). Returns `''` when `events` empty and `emptyText` is falsy; returns the `emptyText` line when provided. | ✅ |
| `getMyTimedEvents({ when, config, runner? })` | Orchestrator: resolve primary summary (config override → auto-detect), fetch agenda, filter. Returns `[]` on any failure. | indirectly |

The `gws` invocation reuses the same bash-shell technique as `gws.mjs` (Windows `gws.cmd`
needs `shell: 'bash'`). `calendarId` from config, when set, takes precedence over
auto-detection (and is passed to `+agenda --calendar <id>` to filter server-side).

### Morning greeting changes (`daily-chat-greeting.mjs`)

- After building the message, but positioned **immediately after the date header and before
  `진행 중인 작업`**, insert the `📅 *오늘 일정*` section.
- Implementation: `formatMessage` gains the calendar block as a parameter (events fetched in
  `main` so the function stays sync/pure-ish), inserted at the top position.
- Empty → `_없음_` line (greeting shows all sections for consistency).
- Gated by `config.googleChat?.calendar?.enabled !== false` and `googleChat.enabled`.
- Calendar fetch failure → section silently omitted (no crash; matches existing failure mode).

### Evening summary changes (`daily-chat-summary.mjs`)

- Append a `📅 *내일 일정*` section at the **end** of `formatMessage` (after
  `내일 이어서 할 작업`), built from `when: 'tomorrow'` events.
- Empty → section omitted (matches the script's existing conditional-section style).
- Calendar data is **not** added to the `claude` summary prompt — it is a deterministic
  appended block, so the LLM summary keeps focusing on commits/PRs/tasks.
- Same gating and silent-failure behavior as the greeting.

### Config

New optional block merged by the existing two-level loader (`config.mjs` `DEFAULTS` +
schema doc in `CLAUDE.md`):

```jsonc
"googleChat": {
  "enabled": false,
  "dailyGreeting": true,
  "spaceId": null,
  "calendar": {
    "enabled": true,        // show calendar sections (still requires googleChat.enabled)
    "calendarId": null,     // null = auto-detect primary; or explicit calendar id/email
    "maxEvents": 8          // cap lines per section
  }
}
```

`enabled: true` default means: once a teammate has `googleChat.enabled` and an authenticated
`gws`, the calendar section appears with no extra configuration. Auto-detection finds their
own primary calendar, so it is correct per-user without hardcoding any email.

## Data Flow

```
Morning  : session-start spawns daily-chat-greeting.mjs
           → getMyTimedEvents({when:'today'})  [calendarList + +agenda --today via gws]
           → filterMyTimedEvents → formatCalendarSection('오늘 일정')
           → inserted after date header, before tasks → gws chat send

Evening  : cron fires /codepresso:daily-summary → daily-chat-summary.mjs
           → getMyTimedEvents({when:'tomorrow'}) [+agenda --tomorrow via gws]
           → filterMyTimedEvents → formatCalendarSection('내일 일정')
           → appended after in-progress tasks → gws chat send
```

## Error Handling

- `gws` missing / unauthenticated / non-zero exit → `runner` throws → caught → `[]` →
  section omitted. Never crashes the bookend; the rest of the message still sends.
- `calendarList` has no `primary` item → `fetchPrimaryCalendarSummary` returns `null` →
  with no `calendarId` override, `getMyTimedEvents` returns `[]` (section omitted).
- Malformed JSON from `gws` → caught at parse → `[]`.
- Timezone: `formatEventTime` renders in `Asia/Seoul` via `Intl.DateTimeFormat`, so both
  `+09:00` and `Z` datetimes display in KST consistently.

## Testing

`tests/lib/calendar.test.js` (node:test + node:assert), covering the pure functions:

- `filterMyTimedEvents`:
  - drops all-day events (date-only `start`),
  - drops timed events on non-primary calendars (room booking, teammate vacation),
  - keeps timed events on the primary calendar,
  - sorts by `start`.
- `formatEventTime`: `+09:00` and `Z` inputs both render correct KST `HH:MM–HH:MM`.
- `formatCalendarSection`: non-empty block formatting, `maxEvents` cap + overflow line,
  empty with/without `emptyText`.

`gws`-calling functions are exercised through the `runner` DI seam with canned JSON, so no
network/CLI is needed in CI.

## Out of Scope (YAGNI)

- All-day event display (vacation/holiday awareness) — explicitly excluded by user choice.
- Multi-calendar selection / per-calendar coloring.
- Calendar data influencing the LLM summary text.
- Caching primary-calendar lookup across runs (one extra `gws` call in a detached process
  is negligible).
```
