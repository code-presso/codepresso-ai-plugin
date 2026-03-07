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
│   │   └── status-transitions.mjs # Task/Epic status transitions with Notion API
│   ├── session-start.mjs          # SessionStart hook: detect branch/PR, fetch Notion tasks, daily greeting, cache state
│   ├── daily-chat-greeting.mjs   # Detached process: send daily Google Chat greeting with Notion tasks
│   ├── user-prompt-logger.mjs     # UserPromptSubmit hook: batch prompts silently
│   ├── pre-tool-notion-inject.mjs # PreToolUse hook: task picker + PR title enforcement
│   ├── post-tool-git-watcher.mjs  # PostToolUse:Bash hook: detect git commit/push
│   ├── session-end.mjs            # Stop hook: force-flush remaining batch
│   ├── score-and-post.mjs         # Detached process: score batch + post PR comment
│   ├── backfill-flush.mjs         # Detached: flush pending + sidecar entries when PR is discovered
│   └── handle-merge-transition.mjs # Detached: PR merge → task complete → epic cascade
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
│   └── daily-chat/SKILL.md      # Daily Google Chat greeting (manual trigger)
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
User Prompt → UserPromptSubmit hook → detect branch change → redact secrets → enriched batch entry (.jsonl)
                                          ↓                       ↑ { timestamp, prompt, sessionId, branch, prNumber }
                                     branch changed?
                                     → update session, reset notionContextShown, spawn PR resolver
                                          ↓ (interval/size trigger + rate limit check)
                                     groupByPr() → per-PR flush
                                          ↓
                                     score-and-post.mjs (detached, per PR group)
                                          ↓
                                     API scoring → PR comment via `gh` → apply PR labels (per-PR, first flush)

Session Start → SessionStart hook → resolve gitRoot → detect branch → find PR → fetch Notion tasks → daily greeting check → cache state
Daily Greeting → first session of day? → read ~/.codepresso/daily-greeting.json → spawn daily-chat-greeting.mjs (detached)
              → format in-progress tasks → gws chat spaces messages create → update lastDate
First Tool  → PreToolUse hook → inject task picker (AskUserQuestion) → user selects task → save to branch-keyed file
Branch Switch → user-prompt-logger detects → reset notionContextShown → PreToolUse re-injects picker for new branch
PR Create   → PreToolUse hook → detect `gh pr create` → read task for current branch → enforce "[TSK-XXXX] title"
PR Create   → PostToolUse:Bash hook → extract PR number from output URL → update session.prNumber
              → spawn backfill-flush.mjs → flush batch + sidecar (pre-PR planning prompts) to new PR
Git Commit  → PostToolUse:Bash hook → verify branch matches session → detached `gh pr comment`
Session End → Stop hook → groupByPr() → force-flush per PR group
              → pending entries (no PR) written to branch sidecar (codepresso-prepr-{branch}.jsonl)
Next Session (same branch, PR now exists) → SessionStart detects sidecar → spawn backfill-flush.mjs
              → sidecar entries prepended to first flush → cleared after successful post

Sprint Start → SessionStart hook → parallel fetch [tasks, sprint+epics] → in-memory cross-reference → cache in session
First Tool  → PreToolUse hook → hierarchical picker (grouped by epic) → user selects task → save with epicId/epicUniqueId
PR Create   → PreToolUse hook → enforce "[GP-XXXX][TSK-XXXX] title" format (epic-aware)
PR Merge    → PostToolUse:Bash hook → detect `gh pr merge` → spawn handle-merge-transition.mjs
              → mark task "완료" (status type) → check epic tasks → auto-mark epic "배포 완료" (select type)
```

---

## Key Design Decisions

### 1. Silent Hook Pattern
All hooks return `{ continue: true }`. The UserPromptSubmit hook does **NOT** inject `additionalContext` — it only appends to the batch file. This prevents noise in the LLM context and avoids conflicts with OMC hooks.

### 2. Detached Process for Scoring
`score-and-post.mjs` runs as a detached child process (`child_process.spawn` with `detached: true, stdio: 'ignore'`). This ensures hooks return within their timeout (3s for prompts, 5s for session start) while scoring and posting happen asynchronously.

### 3. JSONL Batch Queue
Prompts are appended to `.omc/state/codepresso-batch.jsonl` as atomic line writes. Flushing reads the entire file, processes it, then truncates. This avoids race conditions and is crash-safe.

### 4. Two-Level Config Merge
`defaults ← ~/.codepresso/config.json ← .codepresso.json`. Merge is **shallow per-section**: project values override global values within each top-level key but don't replace entire sections. See `scripts/lib/config.mjs:mergeSections()`.

### 5. Notion–GitHub Auto-Linking via PR Title
The PreToolUse hook extracts Notion's `unique_id` property (e.g., `TSK-9945`) from task pages and enforces a `[UNIQUE-ID] description` PR title format. When `gh pr create` is detected without the Notion ID prefix, the hook **blocks** the command and instructs Claude to re-run with the correct format. This enables Notion's GitHub integration to automatically link PRs to tasks.

### 6. OMC Coexistence
- State files: all prefixed `codepresso-*` in `.omc/state/`
- Config: separate path `~/.codepresso/config.json` (not `~/.claude/`)
- Skills: all use `codepresso:` prefix
- Exclude patterns: regex-based filtering of OMC commands from logs

### 7. Monorepo / Submodule Support
The plugin resolves `gitRoot` via `git rev-parse --show-toplevel` at session start and passes it to all git/gh operations. When the top-level repo is on a main branch (no PR), the session-start hook enumerates submodules and checks each for non-main branches with open PRs. The first match becomes the session's primary PR context (`gitRoot`, `branch`, `prNumber`), enabling prompt logging and git activity tracking for submodule PRs. The `activeSubmodule` field in session state tracks which submodule was selected.

### 8. Multi-PR Session Handling
A single Claude session can span multiple PRs when the user switches branches. The plugin detects branch changes and routes prompts to the correct PR:

**Branch-change detection** (`user-prompt-logger.mjs`): On each prompt, calls `getCurrentBranch()` (~50ms) and compares to `session.branch`. On mismatch: updates session state, clears `prNumber` (triggers lazy PR detection), resets `notionContextShown` (re-triggers task picker), and spawns a detached PR resolver for the new branch.

**Enriched batch entries**: Each batch entry now carries `{ branch, prNumber }` alongside `timestamp`, `prompt`, `sessionId`. Entries are batched even with null `prNumber` (backfilled during flush).

**Group-flush** (`pr-comment.mjs:groupByPr()`): At flush time, entries are grouped by `prNumber`. Backfill rules:
- Entry has explicit `prNumber` → grouped directly
- Entry branch matches session branch, null `prNumber` → backfilled from `session.prNumber`
- Legacy entry (no branch/prNumber fields) → falls back to `session.prNumber`
- Entry for a closed PR (`session.closedPrs`) → discarded
- Unresolvable entries → kept as "pending" (written back to batch file, not lost)

**Per-PR labels**: `labelsApplied` changed from `boolean` → `{ [prNumber]: true }` map. Backward compat: boolean `true` is treated as `{ _legacy: true }`.

**Closed PR tracking**: When `isPrOpen()` returns false during flush, the PR is added to `session.closedPrs[]` array. Future entries for that PR are silently discarded.

**Branch-keyed Notion tasks** (`pre-tool-notion-inject.mjs`): The selected task file changed from singleton `{ id, title, uniqueId }` to branch-keyed map `{ "branch-name": { id, title, uniqueId } }`. PR title enforcement reads the task for the current branch. Legacy singleton format is auto-migrated on read.

**Branch-aware git comments** (`post-tool-git-watcher.mjs`): Before posting, checks `getCurrentBranch()` against `session.branch`. Skips the comment if branches differ (the session's `prNumber` belongs to a different branch).

### 9. Daily Google Chat Greeting
On the first Claude session of each day, the plugin sends a Google Chat message to a configured space with the user's in-progress Notion tasks. Detection uses `~/.codepresso/daily-greeting.json` which stores `{ lastDate: "YYYY-MM-DD" }`. The greeting is sent via a detached process (`daily-chat-greeting.mjs`) using the `gws` CLI (Google Workspace CLI) with OAuth, so messages appear as the user's profile (not a bot). The message groups tasks into "진행 중" (in progress) and "대기 중" (waiting) sections. Requires `googleChat.enabled: true` and `googleChat.spaceId` in config. The `gws` CLI must be authenticated with `chat.messages.create` scope.

### 10. Pre-PR Prompt Capture — Sidecar Pattern
Users typically plan before creating a PR. Without special handling, all prompts from the planning phase would be lost because `session.prNumber` is null and `forceFlush` at session end had no PR to post to.

**Sidecar file** (`codepresso-prepr-{branch-slug}.jsonl` in `.omc/state/`): A per-branch JSONL file that persists prompts made before a PR exists. The slug is derived by replacing non-alphanumeric characters with `-` and lowercasing (max 80 chars).

**Three capture paths:**

1. **Same-session PR creation** (`post-tool-git-watcher.mjs`): When `gh pr create` succeeds, the output contains the PR URL (e.g. `https://github.com/org/repo/pull/42`). The hook extracts the PR number, updates `session.prNumber`, and spawns `backfill-flush.mjs` — which calls `forceFlush` with the now-known PR number, merging batch + sidecar into one comment.

2. **Session-end persistence** (`pr-comment.mjs:forceFlush`): If the session ends before a PR exists, pending batch entries (those with no resolvable `prNumber`) are written to the branch sidecar instead of being discarded. They survive session boundaries.

3. **Cross-session recovery** (`session-start.mjs`): On the next session start, after detecting a PR for the current branch, the hook checks if a sidecar exists for that branch. If found, it spawns `backfill-flush.mjs` to retroactively post those planning prompts to the PR.

**Sidecar merge during flush**: In both `flushIfReady` and `forceFlush`, the sidecar is read once before the PR loop, merged into the first successful flush (`[...sidecarEntries, ...batchEntries]`), then cleared. If multiple PR groups exist (rare), the sidecar is only merged into the first one.

**`scripts/backfill-flush.mjs`**: Minimal shared entry-point — reads session file, calls `forceFlush`. Spawned detached by both Fix 1 (post-tool) and Fix 3 (session-start).

### 11. Sprint Workflow — Forward-Only Relations
The plugin uses Notion's forward relations exclusively (Sprint→Epic via `개발팀 에픽`, Epic→Task via `관계형 그룹`). Reverse relation property names are fragile and user-editable. The `PROPERTY_TYPES` constant in `sprint-context.mjs` centralizes all property names and types for Sprint, Epic, and Task databases. **Critical:** Sprint and Epic DBs use `select` type for 상태, while Task DB uses `status` type — these require different Notion API shapes for updates.

---

## Hook Contracts

### SessionStart (`scripts/session-start.mjs`)
- **Timeout:** 5s
- **Input:** Standard hook stdin (session metadata)
- **Output:** `{ continue: true, additionalContext?: string }`
- **Side effects:** Writes `.omc/state/codepresso-session.json` (gitRoot, activeSubmodule, branch, PR, Notion tasks with unique IDs). Scans submodules for active PRs when top-level repo has none. If a PR is detected and a branch sidecar (`codepresso-prepr-{branch}.jsonl`) exists, spawns `backfill-flush.mjs` to retroactively post pre-PR planning prompts.
- **Failure mode:** Silent (returns `{ continue: true }` on error)

### PreToolUse (`scripts/pre-tool-notion-inject.mjs`)
- **Timeout:** 3s
- **Matcher:** `*` (all tools)
- **Input:** `hookInput.toolName` and `hookInput.toolInput` from stdin
- **Output:** `{ continue: true/false, hookSpecificOutput?: { hookEventName, additionalContext } }`
- **Behavior 1 — Task Picker:** On first tool use, injects cached Notion tasks as `additionalContext` with instructions for Claude to present an interactive `AskUserQuestion` picker. Filters out completed tasks, sorts by status. Includes Notion unique IDs (e.g., `TSK-9945`) when available.
- **Behavior 2 — PR Title Enforcement:** On `gh pr create` Bash commands, reads the branch-keyed selected task from `.omc/state/codepresso-selected-task.json` for the current `session.branch`. If a task with a `uniqueId` is selected for that branch and the PR title doesn't include it, **blocks** the command (`continue: false`) and instructs Claude to prefix the title with the Notion ID for auto-linking.
- **Side effects:** Writes `notionContextShown` flag to session file; reads branch-keyed selected task file
- **Failure mode:** Silent (returns `{ continue: true }` on error)

### UserPromptSubmit (`scripts/user-prompt-logger.mjs`)
- **Timeout:** 3s (CRITICAL — must be fast)
- **Input:** `hookInput.userPrompt` from stdin
- **Output:** `{ continue: true }` — never adds `additionalContext`
- **Side effects:** Detects branch changes via `getCurrentBranch()` (~50ms). On branch switch: updates session (branch, prNumber=null, notionContextShown=false), spawns detached PR resolver. Appends enriched entries `{ timestamp, prompt, sessionId, branch, prNumber }` to `.omc/state/codepresso-batch.jsonl`. May trigger grouped flush via `flushIfReady()`.
- **Failure mode:** Silent

### PostToolUse:Bash (`scripts/post-tool-git-watcher.mjs`)
- **Timeout:** 3s
- **Matcher:** `Bash` only
- **Input:** `toolInput.command` and `toolOutput` from stdin
- **Output:** `{ continue: true, additionalContext?: string }`
- **Side effects:** Checks `getCurrentBranch()` against `session.branch` — skips comment if branches differ. Spawns detached `gh pr comment` for git operations when branch matches. Detects `gh pr create` (checked **before** the `prNumber` guard): extracts PR number from output URL, updates `session.prNumber`, spawns `backfill-flush.mjs` to post pre-PR planning prompts. Also detects `gh pr merge` commands and spawns `handle-merge-transition.mjs` as a detached process for Notion status transitions.
- **Failure mode:** Silent

### Stop (`scripts/session-end.mjs`)
- **Timeout:** 5s
- **Input:** Standard hook stdin
- **Output:** `{ continue: true }`
- **Side effects:** Force-flushes remaining batch entries. If a PR exists, flushes to it (merging sidecar entries). If no PR exists yet, pending entries are written to the branch sidecar (`codepresso-prepr-{branch}.jsonl`) for recovery in a future session.
- **Failure mode:** Silent

---

## State Files

All state lives in `.omc/state/` with `codepresso-` prefix:

| File | Format | Purpose |
|------|--------|---------|
| `codepresso-session.json` | JSON | Cached gitRoot, activeSubmodule, branch, PR number, session ID, Notion tasks (with uniqueId), `labelsApplied` (per-PR map `{ [prNumber]: true }`), `closedPrs` (array of merged/closed PR numbers), `sprintContext` (sprint/epic hierarchy), `sprintDatabases` (resolved DB IDs) |
| `codepresso-selected-task.json` | JSON | Branch-keyed Notion task map (`{ "branch-name": { id, title, uniqueId, epicId, epicUniqueId } }`). Legacy singleton format auto-migrated on read. |
| `codepresso-batch.jsonl` | JSONL | Pending prompt queue (redacted). Each entry: `{ timestamp, prompt, sessionId, branch, prNumber }`. Legacy entries without branch/prNumber are supported via fallback. |
| `codepresso-batch-timer.json` | JSON | Flush timer (`{ startedAt: epoch_ms }`) |
| `codepresso-flush-*.json` | JSON | Temporary scoring payloads (auto-cleaned) |
| `codepresso-flush.lock` | Text | Atomic flush lock (PID, stale after 30s) |
| `codepresso-rate-limit.json` | JSON | Rate limit state per PR (hourly + session counts) |
| `codepresso-merge-{N}.json` | JSON | Temporary payload for detached merge handler (auto-cleaned) |
| `codepresso-prepr-{branch}.jsonl` | JSONL | Branch sidecar: pre-PR planning prompts persisted across sessions. Written at session end when no PR exists; merged into first flush after PR is created; cleared after successful post. Branch name is slugified (non-alphanumeric → `-`, max 80 chars). |
| `codepresso-greeting-{ts}.json` | JSON | Temporary payload for daily greeting (auto-cleaned) |

**Daily greeting state** (separate location: `~/.codepresso/`):

| File | Format | Purpose |
|------|--------|---------|
| `daily-greeting.json` | JSON | Last greeting date (`{ lastDate: "YYYY-MM-DD" }`) |

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
    "spaceId": null                                // Google Chat space ID (e.g., "<SPACE_ID>")
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
| `gws` CLI | No | Daily greeting messages (Google Workspace CLI with OAuth, sends as user profile) |

---

## Troubleshooting for Developers

### Hook not firing
- Check `hooks/hooks.json` is valid JSON
- Verify plugin is installed: `ls ~/.claude/plugins/codepresso`
- Restart Claude Code (hooks load at session start)

### Batch not flushing
- Check `.omc/state/codepresso-batch.jsonl` exists and has content
- Verify timer: `.omc/state/codepresso-batch-timer.json`
- Lower `batchIntervalSeconds` for testing

### Scoring returning nulls
- Verify `ANTHROPIC_API_KEY` is set in environment
- Check model ID is valid in `scoring.model` config
- Test directly: `ANTHROPIC_API_KEY=... node -e "import('./scripts/lib/prompt-scorer.mjs').then(m => m.scorePrompts(['test']).then(console.log))"`

### State file corruption
- Delete `.omc/state/codepresso-*.json` and `.omc/state/codepresso-*.jsonl`
- Restart Claude Code to regenerate session state

