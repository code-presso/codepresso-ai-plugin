# Codepresso Plugin — Development Guide

## Overview

Codepresso is a **team workflow plugin** for Claude Code that provides GitHub PR activity logging, prompt quality scoring, git operation tracking, Notion task sync, and optional deployment integration. It runs alongside oh-my-claudecode (OMC) with zero conflicts.

**Version:** 0.1.0
**Runtime:** Node.js >= 20, ESM modules
**Dependencies:** `@modelcontextprotocol/sdk`

---

## Architecture

```
codepresso-plugin/
├── hooks/hooks.json               # 5 hook declarations (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse:Bash, Stop)
├── scripts/
│   ├── lib/                        # Shared libraries (config, stdin, git, batching, scoring)
│   │   ├── stdin.mjs              # Timeout-protected stdin reader (5s timeout)
│   │   ├── config.mjs             # Two-level config loader (global + per-project merge)
│   │   ├── git-utils.mjs          # Branch/PR detection via `gh` CLI
│   │   ├── pr-comment.mjs         # JSONL batch queue + flush logic + PR labels
│   │   ├── prompt-scorer.mjs      # Anthropic API for 0-10 scoring (configurable model)
│   │   ├── redactor.mjs           # Sensitive data redaction (11 patterns + custom)
│   │   ├── rate-limiter.mjs       # PR comment rate limiting (hourly + session)
│   │   ├── logger.mjs             # Debug logger (writes to ~/.codepresso/logs/)
│   │   ├── analytics.mjs          # Analytics persistence (sessions.jsonl)
│   │   ├── notion-tasks.mjs       # Notion task fetcher with unique ID extraction
│   │   ├── sprint-context.mjs     # Sprint > Epic > Task hierarchy fetcher with PROPERTY_TYPES
│   │   ├── status-transitions.mjs # Task/Epic status transitions with Notion API
│   │   └── inbox-state.mjs        # Seen-ID dedup, candidate JSONL, schema cache, gating + formatter helpers
│   ├── session-start.mjs          # SessionStart hook: detect branch/PR, fetch Notion tasks, daily greeting, cache state
│   ├── daily-chat-greeting.mjs   # Detached process: send weekday morning Google Chat greeting (Notion tasks + GitHub PRs)
│   ├── daily-chat-summary.mjs     # Evening (18:00) summary: today's commits + merged/closed PRs + in-progress tasks, Claude-summarized
│   ├── user-prompt-logger.mjs     # UserPromptSubmit hook: batch prompts silently
│   ├── pre-tool-notion-inject.mjs # PreToolUse hook: task picker + PR title enforcement
│   ├── post-tool-git-watcher.mjs  # PostToolUse:Bash hook: detect git commit/push
│   ├── session-end.mjs            # Stop hook: force-flush remaining batch
│   ├── score-and-post.mjs         # Detached process: score batch + post PR comment
│   ├── backfill-flush.mjs         # Detached: flush pending + sidecar entries when PR is discovered
│   ├── handle-merge-transition.mjs # Detached: PR merge → task complete → epic cascade
│   └── inbox-cli.mjs              # CLI dispatcher invoked by the scan-inbox skill (prep/redact/stage/complete/schema-cache)
├── skills/
│   ├── setup/SKILL.md             # Interactive setup wizard
│   ├── log/SKILL.md               # Manual PR summary posting
│   ├── status/SKILL.md            # Plugin status and diagnostics
│   ├── notion-sync/SKILL.md       # Notion task query/update
│   ├── deploy/SKILL.md            # Deploy trigger (optional)
│   ├── dashboard/SKILL.md         # Team analytics dashboard
│   ├── sprint-dashboard/SKILL.md  # Sprint progress dashboard
│   ├── sprint-retro/SKILL.md      # Sprint retrospective report
│   ├── generate-epic/SKILL.md    # Epic PRD document generation
│   ├── daily-chat/SKILL.md      # Morning Google Chat greeting (manual trigger)
│   ├── daily-summary/SKILL.md   # Evening Google Chat summary (manual or 18:00 cron trigger)
│   └── scan-inbox/SKILL.md        # Inbox triage routine (Gmail + Chat → Notion tasks with due dates)
├── tests/lib/                     # Unit tests (node:test + node:assert)
├── mcp/
│   └── notion-server.mjs          # MCP server exposing 9 Notion API tools (5 base + 4 sprint)
├── templates/workflows/           # GitHub Actions templates (ECS, CodePipeline)
├── .claude-plugin/plugin.json     # Plugin manifest
├── .mcp.json                      # MCP server declaration
└── package.json
```

### Data Flow

```
User Prompt → UserPromptSubmit hook → skip if main branch → redact secrets → batch entry (.jsonl)
                                          ↓ { timestamp, prompt, sessionId }
                                     (interval/size trigger + rate limit check)
                                          ↓
                                     score-and-post.mjs (detached)
                                          ↓
                                     API scoring → PR comment via `gh` → apply PR labels

Session Start → SessionStart hook → resolve gitRoot → detect branch → find PR → fetch Notion tasks → (Mon-Fri + first-of-day) spawn daily-chat-greeting → cache state
Weekday 18:03 (session cron) → `/codepresso:daily-summary` → daily-chat-summary.mjs → gather commits/PRs/Notion → claude -p summary → gws send
Session End → Stop hook → force-flush → if PR exists: post (merging sidecar) → if no PR: write to sidecar
PR Create → PostToolUse:Bash hook → extract PR number → update session → spawn backfill-flush.mjs
Git Commit → PostToolUse:Bash hook → verify PR exists → detached `gh pr comment`
First Tool → PreToolUse hook → inject task picker (AskUserQuestion) → user selects task → save to file
PR Merge → PostToolUse:Bash hook → detect `gh pr merge` → spawn handle-merge-transition.mjs
Inbox scan      → /codepresso:scan-inbox OR morning session-start instruction
                → claude_ai_Gmail + gws fetchChatUnread → filter by seen-IDs
                → classify in-conversation → inbox-cli stage → AskUserQuestion (paginated)
                → per-task due date → claude_ai_Notion create-pages → inbox-cli complete
```

---

## Key Design Decisions

### 1. Silent Hook Pattern
All hooks return `{ continue: true }`. The UserPromptSubmit hook does **NOT** inject `additionalContext` — it only appends to the batch file. This prevents noise in the LLM context and avoids conflicts with OMC hooks.

### 2. Detached Process for Scoring
`score-and-post.mjs` runs as a detached child process (`child_process.spawn` with `detached: true, stdio: 'ignore'`). This ensures hooks return within their timeout (3s for prompts, 5s for session start) while scoring and posting happen asynchronously.

### 3. JSONL Batch Queue
Prompts are appended to `.codepresso/state/codepresso-batch.jsonl` as atomic line writes. Flushing reads the entire file, processes it, then truncates. This avoids race conditions and is crash-safe.

### 4. Two-Level Config Merge
`defaults ← ~/.codepresso/config.json ← .codepresso.json`. Merge is **shallow per-section**: project values override global values within each top-level key but don't replace entire sections. See `scripts/lib/config.mjs:mergeSections()`.

### 5. Notion–GitHub Auto-Linking via PR Title
The PreToolUse hook extracts Notion's `unique_id` property (e.g., `TSK-9945`) from task pages and enforces a `[UNIQUE-ID] description` PR title format. When `gh pr create` is detected without the Notion ID prefix, the hook **blocks** the command and instructs Claude to re-run with the correct format. It reads the selected task to determine the required prefix. This enables Notion's GitHub integration to automatically link PRs to tasks.

**No-task enforcement:** When `gh pr create` runs without a selected task, the hook blocks and emits a pick-or-create `AskUserQuestion` flow (top 3 active tasks + "Create new from PR title"). Picking an existing task transitions it to 진행 중; picking "Create new" calls `notion_create_page` against `notion.databases.task` with title from `--title`, status `할 일`, and assignee from `notion.userId`. The selected/created task is written to `codepresso-selected-task.json` and `gh pr create` is retried with the `[UNIQUE-ID]` prefix. Falls through silently when Notion is unconfigured.

### 6. OMC Coexistence
- State files: all prefixed `codepresso-*` in `.codepresso/state/`
- Config: separate path `~/.codepresso/config.json` (not `~/.claude/`)
- Skills: all use `codepresso:` prefix
- Exclude patterns: regex-based filtering of OMC commands from logs

### 7. Monorepo / Submodule Support
The plugin resolves `gitRoot` via `git rev-parse --show-toplevel` at session start and passes it to all git/gh operations. When the top-level repo is on a main branch (no PR), the session-start hook enumerates submodules and checks each for non-main branches with open PRs. The first match becomes the session's primary PR context (`gitRoot`, `branch`, `prNumber`), enabling prompt logging and git activity tracking for submodule PRs. The `activeSubmodule` field in session state tracks which submodule was selected.

### 9. Daily Google Chat Bookends (Mon–Fri)

The plugin sends two Google Chat messages per workday to the configured space, both as the authenticated user (not a bot) via the `gws` CLI.

**Morning greeting (`daily-chat-greeting.mjs`)** — first weekday session of the day:
- Triggered by `session-start.mjs` when `isWeekday() && isFirstSessionOfDay() && notionTasks`
- Daily detection: `~/.codepresso/daily-greeting.json` (`{ lastDate: "YYYY-MM-DD" }`). `lastDate` is only updated after a fire, so a Monday session still fires even if the previous `lastDate` was Friday.
- Weekday guard: `getDay() ∈ {1..5}`. Sat/Sun sessions never spawn the greeting and do not update `lastDate`.
- Content: three sections — in-progress Notion tasks, my open PRs (`gh search prs --author @me --state open`), PRs awaiting my review (`gh search prs --review-requested @me --state open`). Runs in `gitRoot` passed from session-start. Plus a Claude-generated (Haiku) motivational one-liner.

**Evening summary (`daily-chat-summary.mjs`)** — Mon–Fri at 18:03:
- Scheduled by a session cron (`3 18 * * 1-5`) that fires `/codepresso:daily-summary`, which runs the script. Session-only — cron lives for the Claude session and auto-expires after 7 days.
- Weekday guard in the script itself as defense-in-depth for manual invocation.
- Gathers: today's commits (`git log --author=<git user.email> --since=<today 00:00>`), today's merged PRs (`gh search prs --author @me --merged-at <today>`), today's non-merged closed PRs (`gh search prs --author @me --state closed --closed <today>`), still-in-progress Notion tasks.
- Summarization: pipes a structured prompt to `claude -p --model haiku` for a 2–4 sentence Korean narrative. Falls back to a deterministic template if `claude` fails.
- Skips sending when there's zero activity (no commits, no closed PRs, no in-progress tasks).

**Config requirements** (same for both): `googleChat.enabled: true`, `googleChat.spaceId` set, `gws` authenticated with `chat.messages.create` scope. Morning additionally needs Notion configured; evening additionally needs `claude` CLI on PATH for quality summary (falls back otherwise).

**Manual triggers**: `codepresso:daily-chat` (morning) and `codepresso:daily-summary` (evening) — both work any day of the week.

### 10. Pre-PR Prompt Capture — Sidecar Pattern
Users typically plan before creating a PR. Without special handling, all prompts from the planning phase would be lost because `session.prNumber` is null and `forceFlush` at session end had no PR to post to.

**Sidecar file** (`codepresso-prepr-{branch-slug}.jsonl` in `.codepresso/state/`): A per-branch JSONL file that persists prompts made before a PR exists. The slug is derived by replacing non-alphanumeric characters with `-` and lowercasing (max 80 chars).

**Three capture paths:**

1. **Same-session PR creation** (`post-tool-git-watcher.mjs`): When `gh pr create` succeeds, the output contains the PR URL (e.g. `https://github.com/org/repo/pull/42`). The hook extracts the PR number, updates `session.prNumber`, and spawns `backfill-flush.mjs` — which calls `forceFlush` with the now-known PR number, merging batch + sidecar into one comment.

2. **Session-end persistence** (`pr-comment.mjs:forceFlush`): If the session ends before a PR exists, pending batch entries (those with no resolvable `prNumber`) are written to the branch sidecar instead of being discarded. They survive session boundaries.

3. **Cross-session recovery** (`session-start.mjs`): On the next session start, after detecting a PR for the current branch, the hook checks if a sidecar exists for that branch. If found, it spawns `backfill-flush.mjs` to retroactively post those planning prompts to the PR.

**Sidecar merge during flush**: In both `flushIfReady` and `forceFlush`, the sidecar is read once before the PR loop, merged into the first successful flush (`[...sidecarEntries, ...batchEntries]`), then cleared. If multiple PR groups exist (rare), the sidecar is only merged into the first one.

**`scripts/backfill-flush.mjs`**: Minimal shared entry-point — reads session file, calls `forceFlush`. Spawned detached by both Fix 1 (post-tool) and Fix 3 (session-start).

### 11. Sprint Workflow — Forward-Only Relations
The plugin uses Notion's forward relations exclusively (Sprint→Epic via `개발팀 에픽`, Epic→Task via `관계형 그룹`). Reverse relation property names are fragile and user-editable. The `PROPERTY_TYPES` constant in `sprint-context.mjs` centralizes all property names and types for Sprint, Epic, and Task databases. **Critical:** Sprint and Epic DBs use `select` type for 상태, while Task DB uses `status` type — these require different Notion API shapes for updates.

### 12. Inbox Task Tracker — Claude-Driven Routine

Tasks arriving via Gmail or Google Chat are surfaced by a markdown skill (`skills/scan-inbox/SKILL.md`) that Claude follows in-conversation. Deterministic state ops (seen-ID dedup, candidate persistence, schema cache, redaction) are isolated in `scripts/lib/inbox-state.mjs` and exposed via `scripts/inbox-cli.mjs` — the skill calls the CLI for any state mutation. Source fetching uses the official `mcp__claude_ai_Gmail` connector for email and `gws` CLI for Chat. Notion writes use the official `mcp__claude_ai_Notion` connector. The morning trigger is a single `additionalContext` line injected by `session-start.mjs` on the first weekday session of the day (gated by `~/.codepresso/inbox-last-run.json`). Reminders for due-today + overdue tasks are appended to the existing `daily-chat-greeting.mjs` Chat message via `formatReminderSections`. The entire feature ships behind `inbox.enabled: false` until the setup wizard flips it.

---

## Hook Contracts

### SessionStart (`scripts/session-start.mjs`)
- **Timeout:** 5s
- **Input:** Standard hook stdin (session metadata)
- **Output:** `{ continue: true, additionalContext?: string }`
- **Side effects:** Writes `.codepresso/state/codepresso-session.json` (gitRoot, activeSubmodule, branch, PR, Notion tasks with unique IDs). Scans submodules for active PRs when top-level repo has none. If a PR is detected and a branch sidecar (`codepresso-prepr-{branch}.jsonl`) exists, spawns `backfill-flush.mjs` to retroactively post pre-PR planning prompts.
- **Failure mode:** Silent (returns `{ continue: true }` on error)

### PreToolUse (`scripts/pre-tool-notion-inject.mjs`)
- **Timeout:** 3s
- **Matcher:** `*` (all tools)
- **Input:** `hookInput.toolName` and `hookInput.toolInput` from stdin
- **Output:** `{ continue: true/false, hookSpecificOutput?: { hookEventName, additionalContext } }`
- **Behavior 1 — Task Picker:** On first tool use, injects cached Notion tasks as `additionalContext` with instructions for Claude to present an interactive `AskUserQuestion` picker. Filters out completed tasks, sorts by status. Includes Notion unique IDs (e.g., `TSK-9945`) when available.
- **Behavior 2 — PR Title Enforcement:** On `gh pr create` Bash commands, reads the selected task from `.codepresso/state/codepresso-selected-task.json`. If a task with a `uniqueId` is selected and the PR title doesn't include it, **blocks** the command (`continue: false`) and instructs Claude to prefix the title with the Notion ID for auto-linking.
- **Behavior 3 — PR Link Enforcement (no-task case):** On `gh pr create` when no task is selected, checks `notion.apiKey` and `notion.databases.task`. If both are configured, **blocks** and emits an `AskUserQuestion` instruction set: present the top 3 active tasks plus a "Create new task: '<PR title>'" option. Claude either calls `notion_update_page` (existing task → 진행 중) or `notion_create_page` (new task with title from PR `--title`, status `할 일`, assignee from `notion.userId`), writes `codepresso-selected-task.json`, then re-runs `gh pr create` with the `[UNIQUE-ID]` prefix. Falls through silently when Notion is unconfigured (graceful degradation).
- **Side effects:** Writes `notionContextShown` flag to session file; reads selected task file
- **Failure mode:** Silent (returns `{ continue: true }` on error)

### UserPromptSubmit (`scripts/user-prompt-logger.mjs`)
- **Timeout:** 3s (CRITICAL — must be fast)
- **Input:** `hookInput.userPrompt` from stdin
- **Output:** `{ continue: true }` — never adds `additionalContext`
- **Side effects:** Appends entries `{ timestamp, prompt, sessionId }` to `.codepresso/state/codepresso-batch.jsonl`. May trigger flush via `flushIfReady()`.
- **Failure mode:** Silent

### PostToolUse:Bash (`scripts/post-tool-git-watcher.mjs`)
- **Timeout:** 3s
- **Matcher:** `Bash` only
- **Input:** `toolInput.command` and `toolOutput` from stdin
- **Output:** `{ continue: true, additionalContext?: string }`
- **Side effects:** Spawns detached `gh pr comment` for git operations when a PR exists. Detects `gh pr create`: extracts PR number from output URL, updates `session.prNumber`, spawns `backfill-flush.mjs` to post pre-PR planning prompts. Also detects `gh pr merge` commands and spawns `handle-merge-transition.mjs` as a detached process for Notion status transitions.
- **Failure mode:** Silent

### Stop (`scripts/session-end.mjs`)
- **Timeout:** 5s
- **Input:** Standard hook stdin
- **Output:** `{ continue: true }`
- **Side effects:** Force-flushes remaining batch entries. If a PR exists, flushes to it (merging sidecar entries). If no PR exists yet, pending entries are written to the branch sidecar (`codepresso-prepr-{branch}.jsonl`) for recovery in a future session.
- **Failure mode:** Silent

---

## State Files

All state lives in `.codepresso/state/` with `codepresso-` prefix:

| File | Format | Purpose |
|------|--------|---------|
| `codepresso-session.json` | JSON | Cached gitRoot, activeSubmodule, branch, PR number, session ID, Notion tasks (with uniqueId), `labelsApplied` (boolean), `sprintContext` (sprint/epic hierarchy), `sprintDatabases` (resolved DB IDs) |
| `codepresso-selected-task.json` | JSON | Selected Notion task (`{ id, title, uniqueId, epicId, epicUniqueId }`) |
| `codepresso-batch.jsonl` | JSONL | Pending prompt queue (redacted). Each entry: `{ timestamp, prompt, sessionId }`. |
| `codepresso-batch-timer.json` | JSON | Flush timer (`{ startedAt: epoch_ms }`) |
| `codepresso-flush-*.json` | JSON | Temporary scoring payloads (auto-cleaned) |
| `codepresso-flush.lock` | Text | Atomic flush lock (PID, stale after 30s) |
| `codepresso-rate-limit.json` | JSON | Rate limit state per PR (hourly + session counts) |
| `codepresso-merge-{N}.json` | JSON | Temporary payload for detached merge handler (auto-cleaned) |
| `codepresso-prepr-{branch}.jsonl` | JSONL | Branch sidecar: pre-PR planning prompts persisted across sessions. Written at session end when no PR exists; merged into first flush after PR is created; cleared after successful post. Branch name is slugified (non-alphanumeric → `-`, max 80 chars). |
| `codepresso-greeting-{ts}.json` | JSON | Temporary payload for daily greeting (auto-cleaned) |
| `codepresso-inbox-seen.json` | JSON | Dedup: source IDs already triaged. Pruned to 30 days on every write. |
| `codepresso-inbox-candidates.jsonl` | JSONL | Pending candidates between scan and approval. Survives across interrupted runs. |
| `codepresso-inbox-cache.json` | JSON | Cached Notion task-DB property names. 7-day TTL. |

**Daily greeting state** (separate location: `~/.codepresso/`):

| File | Format | Purpose |
|------|--------|---------|
| `daily-greeting.json` | JSON | Last greeting date (`{ lastDate: "YYYY-MM-DD" }`) |
| `inbox-last-run.json` | JSON | Last date the inbox scan instruction was injected (`{ lastDate: "YYYY-MM-DD" }`) |

**Analytics data** (separate location: `~/.codepresso/analytics/`):

| File | Format | Purpose |
|------|--------|---------|
| `sessions.jsonl` | JSONL | Analytics records: flushes, git ops, session ends (~200B/record) |

---

## Configuration Schema

```jsonc
{
  "github": { "token": null },                    // Optional, falls back to `gh` CLI auth
  "notion": {
    "apiKey": null,                                // Notion Internal Integration Token (ntn_...)
    "defaultDatabaseId": null,                     // Default Notion DB for sync
    "userId": null,                                // Notion user ID (for filtering tasks by assignee)
    "displayName": null,                           // Display name (for auto-assigning created tasks)
    "assigneeProperty": "Assignee",                 // Name of the assignee property in the Notion DB
    "syncWindowDays": 14,                            // Query window in days (0 = no limit)
    "databases": {
      "sprint": null,                              // Sprint database ID
      "epic": null,                                // Epic database ID
      "task": null                                 // Task database ID
    },
    "sprintWorkflow": {
      "enabled": false,                            // Enable sprint automation (requires databases config)
      "autoTransition": true,                      // Auto-transition task to "진행 중" on selection
      "epicAutoComplete": true,                    // Auto-complete epic when all tasks done
      "prTitleFormat": "task"                      // PR title format: "task" → [TSK-XXX], "epic+task" → [GP-XXX][TSK-XXX]
    }
  },
  "prLogging": {
    "enabled": true,                               // Master switch for PR logging
    "trackGitOps": true,                           // Log git commit/push to PR
    "batchIntervalSeconds": 60,                    // Flush interval
    "maxBatchSize": 10,                            // Max prompts before forced flush
    "truncatePromptLength": 500                    // Char limit per prompt
  },
  "scoring": {
    "enabled": true,                               // Enable Haiku scoring (requires ANTHROPIC_API_KEY)
    "model": "claude-haiku-4-5-20251001"           // Scoring model
  },
  "deploy": {
    "enabled": false,                              // Deploy disabled by default
    "method": null,                                // "ecs" | "codepipeline" | "workflow" | "custom"
    "awsRegion": null,
    "ecsCluster": null,
    "ecsService": null,
    "pipelineName": null
  },
  "redaction": {
    "enabled": true,                               // Redact secrets before logging to disk/PR
    "extraPatterns": []                             // Additional regex patterns to redact
  },
  "rateLimit": {
    "maxCommentsPerHour": 10,                      // Max PR comments per hour per PR
    "maxCommentsPerSession": 50                    // Max PR comments per session per PR
  },
  "analytics": {
    "enabled": true,                               // Enable analytics data collection
    "retentionDays": 90                            // Days to retain analytics records
  },
  "prLabels": {
    "enabled": true,                               // Auto-label PRs on first flush
    "labels": ["ai-assisted"]                      // Labels to apply
  },
  "epicDocs": {
    "enabled": true,                               // Enable epic PRD generation
    "outputDir": "docs/prd",                       // Output directory relative to gitRoot
    "includeTaskDetails": true,                    // Include task table with status/assignee
    "customSections": []                           // Extra section headings to include
  },
  "googleChat": {
    "enabled": false,                              // Enable Google Chat integration
    "dailyGreeting": true,                         // Send daily task summary on first session
    "spaceId": null                                // Google Chat space ID (e.g., "AAQAxpZZ_aE")
  },
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
  "excludePatterns": [                             // Regex patterns to skip logging
    "^/oh-my-claudecode:",
    "^(cancelomc|stopomc)$"
  ],
  "debug": false                                   // Enable debug logging to ~/.codepresso/logs/
}
```

**Global config:** `~/.codepresso/config.json`
**Per-project override:** `.codepresso.json` (committed to repo, no secrets)

---

## Development Guidelines

### Adding a New Hook

1. Create script in `scripts/` following the pattern:
   - Import `readStdin` from `lib/stdin.mjs`
   - Import `loadConfig` from `lib/config.mjs`
   - Parse stdin JSON, extract relevant fields
   - Always return `{ continue: true }` (even on error)
   - Keep execution under the timeout
2. Register in `hooks/hooks.json` with appropriate matcher and timeout
3. For long operations, spawn a detached child process (see `score-and-post.mjs`)

### Adding a New Skill

1. Create `skills/<name>/SKILL.md` with:
   - Clear trigger phrases
   - Step-by-step instructions for the LLM
   - Required tools/commands
2. Use `codepresso:` prefix for the skill name
3. Skills are markdown-driven — the LLM follows the SKILL.md instructions

### Adding a New MCP Tool

1. Add tool definition in `mcp/notion-server.mjs` (or create a new server)
2. Register the server in `.mcp.json`
3. Ensure `.claude/settings.local.json` has `enableAllProjectMcpServers: true`

### Testing Hooks Locally

```bash
# Test session-start hook
echo '{}' | node scripts/session-start.mjs

# Test user-prompt-logger with a mock prompt
echo '{"hookInput":{"userPrompt":"fix the auth bug"}}' | node scripts/user-prompt-logger.mjs

# Test pre-tool-notion-inject: gh pr create without Notion ID (should block)
echo '{"hookInput":{"toolName":"Bash","toolInput":{"command":"gh pr create --title \"Add feature\" --body \"test\""}}}' | node scripts/pre-tool-notion-inject.mjs

# Test pre-tool-notion-inject: gh pr create with Notion ID (should pass)
echo '{"hookInput":{"toolName":"Bash","toolInput":{"command":"gh pr create --title \"TSK-9945 Add feature\" --body \"test\""}}}' | node scripts/pre-tool-notion-inject.mjs

# Test git-watcher with a mock commit output
echo '{"toolInput":{"command":"git commit -m \"test\""},"toolOutput":"[main abc1234] test"}' | node scripts/post-tool-git-watcher.mjs
```

### Code Style

- ESM modules (`"type": "module"` in package.json)
- No TypeScript — plain `.mjs` for zero build step
- `node:` prefix for built-in modules (`node:fs`, `node:path`, etc.)
- Graceful error handling: catch-and-continue, never crash hooks
- No console.log in hooks (stdout is captured by Claude Code)
- Use `process.stderr.write()` for debug logging if needed

### Performance Rules

- **PreToolUse hook MUST complete in <3s** — stdin parse + file reads only, no network
- **UserPromptSubmit hook MUST complete in <3s** — no API calls, no network
- **SessionStart hook MUST complete in <5s** — one `gh` CLI call max
- **PostToolUse hook MUST complete in <3s** — spawn detached for `gh` calls
- Batch file operations use atomic append (no read-modify-write)
- Scoring happens in detached process, never in hook

---

## External Dependencies

| Dependency | Required | Used For |
|-----------|----------|----------|
| `gh` CLI | Yes | PR detection, comment posting |
| `ANTHROPIC_API_KEY` env var | No | Prompt quality scoring (graceful fallback) |
| Notion API key | No | Notion task sync features |
| AWS CLI | No | Deploy features (ECS, CodePipeline) |
| `gws` CLI | No | Daily Google Chat bookends (morning greeting + evening summary; OAuth sends as user profile) |
| `claude` CLI | No | Morning motivational phrase and evening Haiku-narrated summary (deterministic fallback if absent) |

---

## Troubleshooting for Developers

### Hook not firing
- Check `hooks/hooks.json` is valid JSON
- Verify plugin is installed: `ls ~/.claude/plugins/codepresso`
- Restart Claude Code (hooks load at session start)

### Batch not flushing
- Check `.codepresso/state/codepresso-batch.jsonl` exists and has content
- Verify timer: `.codepresso/state/codepresso-batch-timer.json`
- Lower `batchIntervalSeconds` for testing

### Scoring returning nulls
- Verify `ANTHROPIC_API_KEY` is set in environment
- Check model ID is valid in `scoring.model` config
- Test directly: `ANTHROPIC_API_KEY=... node -e "import('./scripts/lib/prompt-scorer.mjs').then(m => m.scorePrompts(['test']).then(console.log))"`

### State file corruption
- Delete `.codepresso/state/codepresso-*.json` and `.codepresso/state/codepresso-*.jsonl`
- Restart Claude Code to regenerate session state

