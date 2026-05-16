# Inbox Task Tracker — Design

**Status**: Approved, ready for implementation plan
**Date**: 2026-05-16
**Owner**: <email>

## Problem

Tasks asked of me in email and Google Chat slip through the cracks. They never make it into Notion, so they get forgotten and have no due date or reminder.

## Goal

Surface action items hiding in Gmail and Google Chat, let me convert the real ones into Notion tasks with explicit due dates, and remind me about due-today + overdue items in my existing morning Google Chat greeting.

## Non-goals

- Full email/chat client UX. We only triage incoming items, not reply.
- Auto-creating Notion tasks without confirmation. Every task is user-approved.
- Real-time scanning. Once-a-day morning sweep plus on-demand command is enough.
- Other sources (Slack, Linear, Teams). Adapter shape leaves the door open but they are out of scope.

## Design decisions (already settled)

| Decision | Choice |
|----------|--------|
| Sources | Gmail + Google Chat |
| Detection | Hybrid — Claude suggests, user confirms |
| Trigger | Morning scan (Mon–Fri 1st session) + on-demand `/codepresso:scan-inbox` |
| Review UX | `AskUserQuestion` picker in Claude Code, paginated 4-at-a-time |
| Due date | User picks per task from {Today EOD, Tomorrow, This Friday, Next Monday, Custom} |
| Reminder | Notion native date-property reminder **+** morning Chat ping (overdue + due-today) |
| Gmail access | Official `mcp__claude_ai_Gmail` connector |
| Notion writes | Official `mcp__claude_ai_Notion` connector |
| Chat access | Existing `gws` CLI |
| Notion DB property | Auto-create the due-date date property during `/codepresso:setup` |
| "Seen" tracking | Marked at scan time, so rejections also stick |
| Candidate cap | 10 per scan after classification |

## Architecture

```
Mon–Fri 1st session                              On-demand
        │                                               │
        ▼                                               ▼
  session-start.mjs                          /codepresso:scan-inbox
  (injects additionalContext)                (slash command)
        │                                               │
        └──────────────────┬────────────────────────────┘
                           ▼
            Claude executes the scan routine
            (skills/scan-inbox/SKILL.md)
            ┌────────────────────────────────────────────┐
            │ 1. Fetch Gmail (claude_ai_Gmail)           │
            │ 2. Fetch Chat unread (gws via lib helper)  │
            │ 3. Filter against seen-IDs file            │
            │ 4. Classify (Claude itself, single batch)  │
            │ 5. AskUserQuestion multi-select (paginated)│
            │ 6. AskUserQuestion due date per accepted   │
            │ 7. Create Notion pages (claude_ai_Notion)  │
            │ 8. Update seen-IDs + truncate JSONL        │
            └────────────────────────────────────────────┘

Independent reminder pass
        │
        ▼
  daily-chat-greeting.mjs  (extended)
        │
        ▼
  claude -p (Haiku):
    query Notion for assignee=me AND status!=완료 AND dueDate<=today
    + craft motivational phrase
        │
        ▼
  gws chat messages create
  (greeting now has: in-progress, my PRs, review PRs,
                     🔥 overdue, ⏰ due today, motivational line)
```

The "logic" of the scan lives in a skill markdown procedure that Claude follows. Only the deterministic, non-LLM parts are Node code (seen-ID dedup, `gws` invocation, candidate JSONL CRUD).

## Files added or touched

| File | Change |
|------|--------|
| `skills/scan-inbox/SKILL.md` | **New.** The scan routine procedure. |
| `scripts/session-start.mjs` | **Extend.** Mon–Fri first-of-day inject `additionalContext` instructing Claude to run the scan routine, only when `inbox.enabled`. |
| `scripts/daily-chat-greeting.mjs` | **Extend.** Add 🔥 overdue + ⏰ due-today sections via the same Haiku subprocess. |
| `scripts/lib/inbox-state.mjs` | **New, small.** Seen-ID JSON CRUD, candidate JSONL CRUD, `gws` Chat fetch wrapper. |
| `skills/setup/SKILL.md` | **Extend.** Add inbox-setup sub-step: Gmail-connector auth check, Notion DB schema probe + due-date property auto-create, optional space-IDs prompt, flip `inbox.enabled`. |
| `scripts/lib/config.mjs` | **Extend.** Default values for the new `inbox` section. |
| `tests/lib/inbox-state.test.mjs` | **New.** Unit tests for seen-ID add/prune + candidate JSONL CRUD. |
| `.codepresso.json` schema | New `inbox` section (see below). |
| `CLAUDE.md` | Document the new flow, state files, hook behaviors. |

No new MCP servers, no new cron jobs, no new state directories.

## Components

### `skills/scan-inbox/SKILL.md` — the routine

Markdown procedure invoked by either the morning hook or the slash command. The skill instructs Claude to:

1. **Gather inputs** (parallel where possible):
   - Read `.codepresso/state/codepresso-inbox-seen.json` (create if missing).
   - Read merged config for `inbox.*` settings.
   - Call `mcp__claude_ai_Gmail` with query `inbox.sources.gmail.query` (default `in:inbox is:unread newer_than:1d -category:promotions -category:social`), capped at `maxResults`.
   - Shell out to `gws` for each configured Chat space (or DMs if `spaceIds` empty), capped at `maxPerSpace`. Exact `gws` subcommand is encapsulated in `lib/inbox-state.mjs` so the skill stays agnostic.

2. **Filter & dedup**:
   - Drop message IDs already in seen file.
   - Drop senders matching `ignoreSenders` regex.
   - Drop Gmail messages with `Auto-Submitted` header.

3. **Classify in one batched call**:
   - Build a numbered list with sender, subject/preview, snippet (≤200 chars, redacted via existing `redactor.mjs`).
   - Claude produces JSON `[{ index, isTask, summary: "≤80 chars", reason: "phrase" }, ...]`.
   - Discard `isTask: false`.
   - Hard-cap accepted candidates at `inbox.classifier.maxCandidatesPerScan` (default 10).

4. **Stage candidates**:
   - Append surviving candidates to `codepresso-inbox-candidates.jsonl`.
   - Append all scanned source IDs (accepted **and** rejected) to seen-IDs file immediately, so rejecting once is sticky.

5. **Approval loop**:
   - Read the full candidate JSONL (newly-staged **plus** any leftovers from previous interrupted runs). This is how user-cancelled candidates resurface naturally — they stayed in the JSONL because they were never accepted or rejected.
   - If candidates empty → exit.
   - Otherwise present `AskUserQuestion` (`multiSelect: true`) in pages of 4, each page including a "Skip rest" pseudo-option.
   - For each accepted candidate, ask due date as single-select: `Today EOD` / `Tomorrow` / `This Friday` / `Next Monday` / Custom. Resolve to ISO8601 with the user's local timezone (`process.env.TZ` with `Asia/Seoul` fallback to match config-defined locale).

6. **Create Notion pages**:
   - Resolve task DB property names via `mcp__claude_ai_Notion__notion-fetch` schema lookup, cached 7 days in `codepresso-inbox-cache.json`.
   - Call `mcp__claude_ai_Notion__notion-create-pages` per accepted candidate with title (AI summary), status (`할 일`), assignee (`notion.userId`), due date (chosen ISO with TZ), and body containing source URL + redacted snippet.
   - On property-mismatch error, invalidate cache and retry once.

7. **Cleanup & confirm**:
   - Remove successfully-created candidates from JSONL.
   - Remove candidates the user explicitly **rejected** in the picker (including those dismissed via "Skip rest") — their source IDs are already in seen, so they will not resurface.
   - Do **not** remove candidates that were never reached (e.g., user closed terminal mid-flow) — they stay in JSONL and resurface on the next run.
   - Emit one summary line: `✅ Created N tasks in Notion: …`. If unique IDs are available in the create response, include them.

### `scripts/lib/inbox-state.mjs` — deterministic helpers

Plain ESM module, ~150 lines. Public functions:

- `loadSeen() → { gmail: string[], chat: string[], lastScannedAt: string | null }`
- `saveSeen(seen)` — atomic temp-file + rename, prunes entries older than 30 days per source.
- `appendCandidate(candidate)` / `readCandidates()` / `removeCandidatesByIds(ids[])`
- `fetchChatUnread({ spaceIds, lookbackHours, maxPerSpace }) → ChatMessage[]` — wraps `gws` invocation; on `gws` missing/unauth returns `[]` with a logged warning.
- `loadSchemaCache() / saveSchemaCache(cache)`

All file writes go through atomic temp + rename. All reads tolerate missing files (return defaults).

### `scripts/session-start.mjs` — morning injection

New branch added near the existing daily-greeting trigger:

```js
if (config.inbox?.enabled && isWeekday() && isFirstSessionOfDay() && shouldRunScan()) {
  output.hookSpecificOutput.additionalContext +=
    "\n\nMorning inbox routine: invoke the scan-inbox skill to triage Gmail + Chat.";
  markScanScheduled();
}
```

`shouldRunScan()` checks a `~/.codepresso/inbox-last-run.json` daily-flag file (mirrors the existing `daily-greeting.json` pattern) so the instruction injects at most once per day. `markScanScheduled()` updates it only after injection (not after Claude completes the scan — see edge cases).

### `scripts/daily-chat-greeting.mjs` — reminder integration

Existing `claude -p --model haiku` invocation is extended. Prompt now also instructs Haiku to call `mcp__claude_ai_Notion__notion-query-data-source` with this filter:

```
AND:
  - assignee contains <notion.userId>
  - status does_not_equal "완료"
  - dueDate on_or_before <today end>
```

Returned rows are split locally into Overdue (`dueDate < startOfToday`) and Due-today buckets, each capped at `inbox.reminder.maxPerSection` (default 5), then rendered as bullet lines in the greeting alongside the existing sections. If the query fails or `inbox.enabled` is false, sections are silently omitted.

### `skills/setup/SKILL.md` — inbox setup sub-step

New step in the existing wizard:

```
N. Inbox scan setup (optional, skip with "n")
  N.1 Gmail: check `mcp__claude_ai_Gmail` is authed; if not, run authenticate.
  N.2 Notion: probe task DB schema; if `inbox.notion.dueDateProperty`
      (default "마감일") is missing, create it via
      mcp__claude_ai_Notion__notion-update-data-source.
  N.3 Print one-time UI instruction: "Open task DB → click due-date property
      header → Edit property → enable 'Remind me' → 'On day at 9am'."
  N.4 Ask user for Chat space IDs to scan (Enter = DMs only).
  N.5 Set inbox.enabled = true in `~/.codepresso/config.json`.
```

## Data shapes

**`codepresso-inbox-seen.json`**
```json
{
  "gmail": ["18e1f...", "18e20..."],
  "chat": ["spaces/AAA.../messages/BBB...", "..."],
  "lastScannedAt": "2026-05-16T09:12:00+09:00"
}
```

**`codepresso-inbox-candidates.jsonl`** — one line per candidate:
```json
{"id":"18e1f...","source":"gmail","from":"Mira Lee <mira@codepresso.kr>","subject":"Re: Q3 review","summary":"Send Q3 budget numbers to finance","sourceUrl":"https://mail.google.com/mail/u/0/#inbox/18e1f...","snippet":"Hey, can you send the Q3 budget...","scannedAt":"2026-05-16T09:12:00+09:00"}
```

**`codepresso-inbox-cache.json`**
```json
{
  "taskDb": {
    "id": "<db-uuid>",
    "titleProp": "이름",
    "statusProp": "상태",
    "assigneeProp": "담당자",
    "dueDateProp": "마감일",
    "fetchedAt": "2026-05-16T09:12:00+09:00"
  }
}
```

## Configuration

Added to `defaults` in `scripts/lib/config.mjs`, mergeable from global + project config:

```jsonc
"inbox": {
  "enabled": false,
  "sources": {
    "gmail": {
      "enabled": true,
      "lookbackHours": 24,
      "query": "in:inbox is:unread -category:promotions -category:social",
      "maxResults": 30
    },
    "chat": {
      "enabled": true,
      "lookbackHours": 24,
      "spaceIds": [],
      "maxPerSpace": 20
    }
  },
  "ignoreSenders": ["noreply@", "notifications@github\\.com", "no-reply@"],
  "classifier": { "maxCandidatesPerScan": 10 },
  "notion": {
    "taskDatabaseId": null,
    "dueDateProperty": "마감일",
    "defaultDueOption": "Tomorrow"
  },
  "reminder": { "showOverdue": true, "showDueToday": true, "maxPerSection": 5 }
}
```

`inbox.notion.taskDatabaseId` falls back to the existing `notion.databases.task` when null.

## Error handling

| Failure | Behavior |
|---------|----------|
| Gmail connector not authenticated | Skip Gmail this run; hint `Run mcp__claude_ai_Gmail__authenticate`. Chat continues. |
| Gmail API error / rate limit | Log to `~/.codepresso/logs/inbox-<date>.log`, skip Gmail this run. |
| `gws` missing or unauth | Skip Chat this run; log warning. |
| Notion schema fetch fails | Use stale cache if present; otherwise abort the create step, leave candidate in JSONL. |
| Notion create fails (prop mismatch) | Invalidate cache, retry once. Second failure → leave in JSONL, warn in summary. |
| User cancels mid-approval | Already-created pages persist; remaining candidates stay in JSONL for next run. |
| Zero candidates after classification | Silent exit. |
| `inbox.enabled` false | Hook injects nothing; slash command emits setup hint. |
| Empty greeting reminder query | Sections omitted, rest of greeting unaffected. |

## Idempotency

- Dedup key: `<source>:<sourceId>`. Seen-IDs are marked at scan time (Section 2 step 4), so dismissals are sticky.
- Daily flag in `~/.codepresso/inbox-last-run.json` prevents double-injection on same day, even if user starts multiple Claude Code sessions before noon. The flag is set when the instruction is **injected**, not when the scan completes — this means: if the user dismisses the morning scan without running it, they won't get re-prompted today. The `/codepresso:scan-inbox` slash command is the explicit recovery path.

## Privacy

- All message bodies pass through `redactor.mjs` before reaching the classifier.
- Only redacted snippets (≤500 chars) are written to candidate JSONL. Full bodies are never persisted.
- Seen-IDs file contains only opaque message IDs.
- Source URLs (Gmail deep links, Chat message permalinks) are not redacted — they are not secret and are needed for the Notion page body.

## Testing

- **Unit**: `tests/lib/inbox-state.test.mjs` covers seen-ID add/prune, candidate JSONL CRUD, schema cache age check.
- **Local manual**: a `--dry-run` flag on `inbox-state.mjs` lists what would be fetched without writing — documented in `CLAUDE.md`.
- **Skill validation**: run `/codepresso:scan-inbox` against a known-empty inbox and verify no Notion pages created, no JSONL mutation.
- **Integration**: kept manual — connector-driven flows are too costly to mock comprehensively in CI.

## Observability

- Daily rotated log `~/.codepresso/logs/inbox-<YYYY-MM-DD>.log` retains 14 days.
- New analytics event `inbox_scan` in `~/.codepresso/analytics/sessions.jsonl`:
  ```json
  {"event":"inbox_scan","at":"…","candidatesFound":3,"accepted":2,"rejected":1,"errors":0}
  ```
  Surfaced in the `codepresso:dashboard` skill once the data accumulates.

## Open items punted to implementation

1. **`gws` Chat-list flags** — implementation needs a brief spike on `gws chat --help` to pick the right subcommand for unread + since-timestamp. Fallback: direct REST call to `chat.spaces.messages.list`.
2. **Notion `time_zone` field** on `date` properties — verify the connector accepts `time_zone: "Asia/Seoul"`. If not, normalize to UTC offset.
3. **Unique-ID return on create** — `notion-create-pages` may not return the `TSK-…` formula value synchronously. Success line falls back to title-only display if absent.

## Rollout

1. Land the spec + plan.
2. Implement behind `inbox.enabled: false` default — zero impact on existing users.
3. Self-dogfood for one week using `/codepresso:scan-inbox` on-demand only (morning hook off).
4. Flip morning hook on for self.
5. Document in CLAUDE.md + plugin README. Ship as v0.3.0.
