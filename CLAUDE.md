# Codepresso Plugin — Development Guide

## Overview

Codepresso is a **team workflow plugin** for Claude Code that provides Notion task sync, sprint workflow automation, git operation tracking on PRs, daily Google Chat bookends, and optional deployment integration. It runs alongside oh-my-claudecode (OMC) with zero conflicts.

**Version:** 0.1.0
**Runtime:** Node.js >= 20, ESM modules
**Dependencies:** `@modelcontextprotocol/sdk`

---

## Architecture

```
codepresso-plugin/
├── hooks/hooks.json               # 3 hook declarations (SessionStart, PreToolUse, PostToolUse:Bash)
├── scripts/
│   ├── lib/                        # Shared libraries
│   │   ├── stdin.mjs              # Timeout-protected stdin reader
│   │   ├── config.mjs             # Two-level config loader (global + per-project merge)
│   │   ├── git-utils.mjs          # Branch/PR detection via `gh` CLI
│   │   ├── git-root.mjs           # Resolve git root for monorepo/submodule support
│   │   ├── logger.mjs             # Debug logger (writes to ~/.codepresso/logs/)
│   │   ├── notion-tasks.mjs       # Notion task fetcher with unique ID extraction
│   │   ├── sprint-context.mjs     # Sprint > Epic > Task hierarchy fetcher
│   │   ├── status-transitions.mjs # Task/Epic status transitions with Notion API
│   │   ├── gws.mjs                # Google Chat / gws CLI helpers
│   │   └── inbox-state.mjs        # Seen-ID dedup, candidate JSONL, schema cache, gating + formatter helpers
│   ├── session-start.mjs          # SessionStart hook: detect branch/PR, fetch Notion tasks, daily greeting
│   ├── daily-chat-greeting.mjs    # Detached: weekday morning Google Chat greeting
│   ├── daily-chat-summary.mjs     # Evening summary script (manual or scheduled)
│   ├── pre-tool-notion-inject.mjs # PreToolUse hook: task picker + PR title enforcement
│   ├── post-tool-git-watcher.mjs  # PostToolUse:Bash hook: PR commit comment + merge transition
│   ├── handle-merge-transition.mjs # Detached: PR merge → task complete → epic cascade
│   └── inbox-cli.mjs              # CLI dispatcher invoked by the scan-inbox skill (prep/redact/stage/complete/schema-cache)
├── skills/
│   ├── setup/SKILL.md             # Interactive setup wizard
│   ├── status/SKILL.md            # Plugin status and diagnostics
│   ├── notion-sync/SKILL.md       # Notion task query/update
│   ├── deploy/SKILL.md            # Deploy trigger (optional)
│   ├── sprint-dashboard/SKILL.md  # Sprint progress dashboard
│   ├── sprint-retro/SKILL.md      # Sprint retrospective report
│   ├── generate-epic/SKILL.md     # Epic PRD document generation
│   ├── daily-chat/SKILL.md        # Morning Google Chat greeting (manual trigger)
│   ├── daily-summary/SKILL.md     # Evening Google Chat summary (manual or 18:00 cron trigger)
│   └── scan-inbox/SKILL.md        # Inbox triage routine (Gmail + Chat → Notion tasks with due dates)
├── tests/lib/                     # Unit tests (node:test + node:assert)
├── mcp/
│   └── notion-server.mjs          # MCP server exposing Notion API tools
├── templates/workflows/           # GitHub Actions templates (ECS, CodePipeline)
├── .claude-plugin/plugin.json     # Plugin manifest
├── .mcp.json                      # MCP server declaration
└── package.json
```

### Data Flow

```
Session Start → SessionStart hook → resolve gitRoot → detect branch → find PR → fetch Notion tasks → (Mon-Fri + first-of-day) spawn daily-chat-greeting → cache state
First Tool → PreToolUse hook → inject task picker (AskUserQuestion) → user selects task → save to file
Git Commit → PostToolUse:Bash hook → if PR exists: detached `gh pr comment` with commit info
PR Merge → PostToolUse:Bash hook → detect `gh pr merge` → spawn handle-merge-transition.mjs
Weekday 18:03 (session cron) → `/codepresso:daily-summary` → daily-chat-summary.mjs → claude -p summary → gws send
Inbox scan      → /codepresso:scan-inbox OR morning session-start instruction
                → claude_ai_Gmail + gws fetchChatUnread → filter by seen-IDs
                → classify in-conversation → inbox-cli stage → AskUserQuestion (paginated)
                → per-task due date → claude_ai_Notion create-pages → inbox-cli complete
```

---

## Key Design Decisions

### 1. Silent Hook Pattern
All hooks return `{ continue: true }`. SessionStart only emits short, on-demand `additionalContext` strings (PR detection, Notion task list, sprint info). PreToolUse can block on `gh pr create` to enforce Notion link discipline (see Decision 4).

### 2. Two-Level Config Merge
`defaults ← ~/.codepresso/config.json ← .codepresso.json`. Merge is **shallow per-section**: project values override global values within each top-level key but don't replace entire sections. See `scripts/lib/config.mjs:mergeSections()`.

### 3. OMC Coexistence
- State files: all prefixed `codepresso-*` in `.codepresso/state/`
- Config: separate path `~/.codepresso/config.json` (not `~/.claude/`)
- Skills: all use `codepresso:` prefix

### 4. Notion–GitHub Auto-Linking via PR Title
The PreToolUse hook extracts Notion's `unique_id` property (e.g., `TSK-9945`) from task pages and enforces a `[UNIQUE-ID] description` PR title format. When `gh pr create` is detected without the Notion ID prefix, the hook **blocks** the command and instructs Claude to re-run with the correct format. This enables Notion's GitHub integration to automatically link PRs to tasks.

**No-task enforcement:** When `gh pr create` runs without a selected task, the hook blocks and emits a pick-or-create `AskUserQuestion` flow (top 3 active tasks + "Create new from PR title"). Picking an existing task transitions it to 진행 중; picking "Create new" calls `notion_create_page`. The selected/created task is written to `codepresso-selected-task.json` and `gh pr create` is retried with the `[UNIQUE-ID]` prefix. Falls through silently when Notion is unconfigured.

### 5. Monorepo / Submodule Support
The plugin resolves `gitRoot` via `git rev-parse --show-toplevel` at session start and passes it to all git/gh operations. When the top-level repo is on a main branch (no PR), the session-start hook enumerates submodules and checks each for non-main branches with open PRs. The first match becomes the session's primary PR context. The `activeSubmodule` field in session state tracks which submodule was selected.

### 6. Daily Google Chat Bookends (Mon–Fri)

The plugin sends two Google Chat messages per workday to the configured space, both as the authenticated user (not a bot) via the `gws` CLI.

**Morning greeting (`daily-chat-greeting.mjs`)** — first weekday session of the day:
- Triggered by `session-start.mjs` when `isWeekday() && isFirstSessionOfDay() && notionTasks`
- Daily detection: `~/.codepresso/daily-greeting.json` (`{ lastDate: "YYYY-MM-DD" }`)
- Content: in-progress Notion tasks, my open PRs, PRs awaiting my review, plus a Claude-generated (Haiku) motivational one-liner

**Evening summary (`daily-chat-summary.mjs`)** — Mon–Fri at 18:03:
- Scheduled by a session cron (`3 18 * * 1-5`) that fires `/codepresso:daily-summary`
- Gathers: today's commits, today's merged/closed PRs, still-in-progress Notion tasks
- Summarizes via `claude -p --model haiku` (deterministic fallback if `claude` is missing)

**Config requirements**: `googleChat.enabled: true`, `googleChat.spaceId` set, `gws` authenticated.

### 7. Sprint Workflow — Forward-Only Relations
The plugin uses Notion's forward relations exclusively (Sprint→Epic via `개발팀 에픽`, Epic→Task via `관계형 그룹`). The `PROPERTY_TYPES` constant in `sprint-context.mjs` centralizes all property names and types. **Critical:** Sprint and Epic DBs use `select` type for 상태, while Task DB uses `status` type — these require different Notion API shapes for updates.

### 12. Inbox Task Tracker — Claude-Driven Routine

Tasks arriving via Gmail or Google Chat are surfaced by a markdown skill (`skills/scan-inbox/SKILL.md`) that Claude follows in-conversation. Deterministic state ops (seen-ID dedup, candidate persistence, schema cache, redaction) are isolated in `scripts/lib/inbox-state.mjs` and exposed via `scripts/inbox-cli.mjs` — the skill calls the CLI for any state mutation. Source fetching uses the official `mcp__claude_ai_Gmail` connector for email and `gws` CLI for Chat. Notion writes use the official `mcp__claude_ai_Notion` connector. The morning trigger is a single `additionalContext` line injected by `session-start.mjs` on the first weekday session of the day (gated by `~/.codepresso/inbox-last-run.json`). Reminders for due-today + overdue tasks are appended to the existing `daily-chat-greeting.mjs` Chat message via `formatReminderSections`. The entire feature ships behind `inbox.enabled: false` until the setup wizard flips it.

---

## Hook Contracts

### SessionStart (`scripts/session-start.mjs`)
- **Timeout:** 5s
- **Output:** `{ continue: true, additionalContext?: string }`
- **Side effects:** Writes `.codepresso/state/codepresso-session.json` (gitRoot, activeSubmodule, branch, PR, Notion tasks with unique IDs, sprint context). Scans submodules for active PRs when top-level repo has none.
- **Failure mode:** Silent

### PreToolUse (`scripts/pre-tool-notion-inject.mjs`)
- **Timeout:** 3s
- **Matcher:** `*` (all tools)
- **Output:** `{ continue: true/false, hookSpecificOutput?: { hookEventName, additionalContext } }`
- **Behavior 1 — Task Picker:** On first tool use, injects cached Notion tasks as `additionalContext` with instructions for Claude to present an interactive `AskUserQuestion` picker.
- **Behavior 2 — PR Title Enforcement:** On `gh pr create` Bash commands, reads the selected task. If a task with a `uniqueId` is selected and the PR title doesn't include it, **blocks** the command.
- **Behavior 3 — PR Link Enforcement (no-task case):** On `gh pr create` without a selected task, blocks with a pick-or-create `AskUserQuestion`. Falls through silently when Notion is unconfigured.
- **Failure mode:** Silent

### PostToolUse:Bash (`scripts/post-tool-git-watcher.mjs`)
- **Timeout:** 3s
- **Matcher:** `Bash` only
- **Output:** `{ continue: true, additionalContext?: string }`
- **Side effects:** Spawns detached `gh pr comment` for git commits when a PR exists. Detects `gh pr merge` and spawns `handle-merge-transition.mjs` for Notion status transitions.
- **Failure mode:** Silent

---

## State Files

All state lives in `.codepresso/state/` with `codepresso-` prefix:

| File | Format | Purpose |
|------|--------|---------|
| `codepresso-session.json` | JSON | Cached gitRoot, activeSubmodule, branch, PR number, session ID, Notion tasks (with uniqueId), `sprintContext`, `sprintDatabases` |
| `codepresso-selected-task.json` | JSON | Selected Notion task (`{ id, title, uniqueId, epicId, epicUniqueId }`) |
| `codepresso-merge-{N}.json` | JSON | Temporary payload for detached merge handler (auto-cleaned) |
| `codepresso-greeting-{ts}.json` | JSON | Temporary payload for daily greeting (auto-cleaned) |
| `codepresso-inbox-seen.json` | JSON | Dedup: source IDs already triaged. Pruned to 30 days on every write. |
| `codepresso-inbox-candidates.jsonl` | JSONL | Pending candidates between scan and approval. Survives across interrupted runs. |
| `codepresso-inbox-cache.json` | JSON | Cached Notion task-DB property names. 7-day TTL. |

**Daily greeting state** (separate location: `~/.codepresso/`):

| File | Format | Purpose |
|------|--------|---------|
| `daily-greeting.json` | JSON | Last greeting date (`{ lastDate: "YYYY-MM-DD" }`) |
| `inbox-last-run.json` | JSON | Last date the inbox scan instruction was injected (`{ lastDate: "YYYY-MM-DD" }`) |

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
  "deploy": {
    "enabled": false,                              // Deploy disabled by default
    "method": null,                                // "ecs" | "codepipeline" | "workflow" | "custom"
    "awsRegion": null,
    "ecsCluster": null,
    "ecsService": null,
    "pipelineName": null
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
    "spaceId": null                                // Google Chat space ID (e.g., "AAAAxxxxxxx")
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
  "excludePatterns": [                             // Regex patterns (kept for future use)
    "^/",
    "(executed|registered)"
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
3. For long operations, spawn a detached child process (see `handle-merge-transition.mjs`)

### Adding a New Skill

1. Create `skills/<name>/SKILL.md` with:
   - Clear trigger phrases
   - Step-by-step instructions for the LLM
   - Required tools/commands
2. Use `codepresso:` prefix for the skill name

### Adding a New MCP Tool

1. Add tool definition in `mcp/notion-server.mjs` (or create a new server)
2. Register the server in `.mcp.json`
3. Ensure `.claude/settings.local.json` has `enableAllProjectMcpServers: true`

### Testing Hooks Locally

```bash
# Test session-start hook
echo '{}' | node scripts/session-start.mjs

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
- `node:` prefix for built-in modules
- Graceful error handling: catch-and-continue, never crash hooks
- No console.log in hooks (stdout is captured by Claude Code)
- Use `process.stderr.write()` for debug logging if needed

### Performance Rules

- **PreToolUse hook MUST complete in <3s** — stdin parse + file reads only, no network
- **SessionStart hook MUST complete in <5s** — one `gh` CLI call max
- **PostToolUse hook MUST complete in <3s** — spawn detached for `gh` calls
- Long-running work happens in detached child processes, never in hook

---

## External Dependencies

| Dependency | Required | Used For |
|-----------|----------|----------|
| `gh` CLI | Yes | PR detection, comment posting |
| Notion API key | No | Notion task sync features |
| AWS CLI | No | Deploy features (ECS, CodePipeline) |
| `gws` CLI | No | Daily Google Chat bookends |
| `claude` CLI | No | Morning motivational phrase and evening Haiku summary |

---

## Troubleshooting for Developers

### Hook not firing
- Check `hooks/hooks.json` is valid JSON
- Verify plugin is installed: `ls ~/.claude/plugins/codepresso`
- Restart Claude Code (hooks load at session start)

### State file corruption
- Delete `.codepresso/state/codepresso-*.json`
- Restart Claude Code to regenerate session state
