# codepresso-plugin — Team Workflow Plugin for Claude Code

## Context

The team uses Notion + GitHub for tracking work and PRs across multiple projects. They want a standalone Claude Code plugin (installed alongside OMC) that:
1. Captures user prompts and posts them as GitHub PR comments (activity trail)
2. Detects git commits/pushes and logs them to PRs
3. Integrates with Notion for task status sync
4. Works across all team projects without forking OMC

---

## Developer Daily Workflow

This is how a developer's day looks using Codepresso + OMC together:

### Morning: Pick up work

```
Developer opens terminal
│
├─ cd ~/projects/my-app
├─ claude                                    ← Start Claude Code session
│   └─ [Codepresso] No PR detected.         ← SessionStart hook (on main branch)
│
├─ "what are my Notion tasks?"               ← Natural language
│   └─ /codepresso:notion-sync              ← Skill auto-invoked or manually
│       ├─ Queries Notion DB via MCP tool
│       └─ Shows:
│           1. [TASK-42] Fix auth token expiry (In Progress)
│           2. [TASK-55] Add CSV export       (To Do)
│           3. [TASK-61] Update API docs      (To Do)
│
├─ "I'll work on TASK-42"
│   └─ Codepresso updates Notion: TASK-42 → "In Progress"
│       Creates branch: fix/task-42-auth-token-expiry
│       Opens PR draft via `gh pr create --draft`
│
│   [Codepresso] PR #87 detected. Prompts will be logged.   ← PR now exists
```

### Working: Code with full traceability

```
├─ "fix the token refresh logic in src/auth/middleware.ts"
│   ├─ OMC: delegates to executor agent, implements fix
│   └─ Codepresso: silently appends prompt to batch queue
│
├─ "add tests for the edge case where token is null"
│   ├─ OMC: delegates to executor, writes tests
│   └─ Codepresso: appends to batch queue
│
├─ "run tests"
│   ├─ OMC: runs test suite
│   └─ Codepresso: appends to batch queue
│
│   ⏱ 60 seconds pass (batch interval)
│   └─ Codepresso flushes batch → posts grouped comment to PR #87:
│
│       ### 🤖 Claude Code Activity Log
│       | Time (UTC) | Prompt |
│       |------------|--------|
│       | 09:15:02   | fix the token refresh logic in src/auth/middleware.ts |
│       | 09:17:33   | add tests for the edge case where token is null |
│       | 09:19:45   | run tests |
│
├─ Claude commits: "fix(auth): handle null token in refresh"
│   └─ Codepresso PostToolUse hook detects git commit
│       Posts to PR #87:
│       ### 🤖 Git Activity
│       **Commit:** `a1b2c3d` — fix(auth): handle null token in refresh
│
├─ Claude pushes to remote
│   └─ Codepresso posts: **Pushed to remote**
```

### Review: Manual summary before requesting review

```
├─ "/codepresso:log"                         ← Developer manually triggers
│   └─ Posts structured summary to PR #87:
│       ### 🤖 Session Summary
│       #### What was done:
│       1. Fixed token refresh in src/auth/middleware.ts
│       2. Added null-token edge case tests
│       3. All 47 tests passing
│       #### Files modified:
│       - src/auth/middleware.ts (modified)
│       - tests/auth/middleware.test.ts (new)
│
├─ "/code-review"                            ← OMC skill: automated review
├─ "mark PR as ready for review"
│   └─ gh pr ready 87
```

### End of day: Close out

```
├─ "update notion that task-42 is in review"
│   └─ Codepresso updates Notion: TASK-42 → "In Review"
│       Adds PR link to Notion page
│
├─ "what's next for tomorrow?"
│   └─ /codepresso:notion-sync
│       Shows remaining tasks:
│       - [TASK-55] Add CSV export (To Do)
│       - [TASK-61] Update API docs (To Do)
│
└─ exit
    └─ Session ends. All activity is on the PR for team visibility.
```

### What the team sees on the PR

When a reviewer opens PR #87, they see the full story:

```
PR #87: Fix auth token expiry [TASK-42]

Comments:
┌──────────────────────────────────────────────────┐
│ 🤖 Claude Code Activity Log                     │
│ 09:15 fix the token refresh logic...             │
│ 09:17 add tests for the edge case...             │
│ 09:19 run tests                                  │
├──────────────────────────────────────────────────┤
│ 🤖 Git Activity                                 │
│ Commit: a1b2c3d — fix(auth): handle null token   │
├──────────────────────────────────────────────────┤
│ 🤖 Session Summary                              │
│ Fixed token refresh, added tests, 47/47 passing  │
│ Files: middleware.ts, middleware.test.ts          │
└──────────────────────────────────────────────────┘
```

This gives reviewers full context of **what the developer asked Claude to do**, not just what code changed. The Notion board stays in sync automatically.

### Key flow summary

```
Notion (tasks)  ──pull──→  Developer + Claude Code  ──push──→  GitHub PR (comments)
     ↑                            │                                    │
     └────── status sync ─────────┘                                    │
     └────── PR link ──────────────────────────────────────────────────┘
```

---

## Directory Structure

```
codepresso-plugin/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── hooks/
│   └── hooks.json               # Hook declarations
├── scripts/
│   ├── lib/
│   │   ├── stdin.mjs            # Timeout-protected stdin reader
│   │   ├── git-utils.mjs        # Branch/PR detection utilities
│   │   ├── config.mjs           # Config loader (global + per-project merge)
│   │   └── pr-comment.mjs       # Batched PR comment posting
│   ├── user-prompt-logger.mjs   # UserPromptSubmit hook — captures prompts
│   ├── post-tool-git-watcher.mjs # PostToolUse:Bash hook — detects git ops
│   └── session-start.mjs        # SessionStart hook — detects PR, caches state
├── skills/
│   ├── log/SKILL.md             # Manual "post summary to PR" skill
│   ├── notion-sync/SKILL.md     # Notion task sync skill
│   └── setup/SKILL.md           # Interactive setup wizard
├── mcp/
│   └── notion-server.mjs        # MCP server exposing Notion API tools
├── .mcp.json                    # MCP server declaration
├── .claude/
│   └── settings.local.json      # Enable MCP servers
├── package.json
└── README.md
```

---

## Implementation Steps

### Step 1: Scaffold the plugin

Create core config files that Claude Code uses to discover and load the plugin.

**`.claude-plugin/plugin.json`:**
```json
{
  "name": "codepresso",
  "version": "0.1.0",
  "description": "Team workflow - GitHub PR logging + Notion sync",
  "author": { "name": "Team" },
  "skills": "./skills/",
  "mcpServers": "./.mcp.json"
}
```

**`hooks/hooks.json`:**
```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/user-prompt-logger.mjs\"",
        "timeout": 3
      }]
    }],
    "PostToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/post-tool-git-watcher.mjs\"",
        "timeout": 3
      }]
    }],
    "SessionStart": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs\"",
        "timeout": 5
      }]
    }]
  }
}
```

**`.mcp.json`:**
```json
{
  "mcpServers": {
    "notion": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/notion-server.mjs"]
    }
  }
}
```

**`.claude/settings.local.json`:**
```json
{
  "enableAllProjectMcpServers": true
}
```

**`package.json`:**
```json
{
  "name": "codepresso-plugin",
  "version": "0.1.0",
  "description": "Team workflow plugin for Claude Code - GitHub PR logging + Notion sync",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20.0.0" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.25.3",
    "@notionhq/client": "^2.2.0"
  }
}
```

---

### Step 2: Build shared libraries (`scripts/lib/`)

#### `scripts/lib/stdin.mjs` — Timeout-protected stdin reader

Reuse exact pattern from OMC's `scripts/lib/stdin.mjs`:
- Read all chunks from stdin with a 5-second timeout
- Return empty string on error or timeout
- Prevent process hangs

#### `scripts/lib/config.mjs` — Config loader

```
loadConfig(cwd):
  1. Read ~/.codepresso/config.json (global)
  2. Read <cwd>/.codepresso.json (per-project)
  3. Shallow merge per section: project overrides global
  4. Return merged config object
```

Config schema:

**Global `~/.codepresso/config.json`:**
```json
{
  "github": {
    "token": null
  },
  "notion": {
    "apiKey": null,
    "defaultDatabaseId": null
  },
  "prLogging": {
    "enabled": true,
    "trackGitOps": true,
    "batchIntervalSeconds": 60,
    "maxBatchSize": 10,
    "truncatePromptLength": 500
  }
}
```

**Per-project `.codepresso.json`** (committed to repo, no secrets):
```json
{
  "prLogging": {
    "enabled": true,
    "batchIntervalSeconds": 30
  },
  "notion": {
    "databaseId": "abc123-def456"
  },
  "excludePatterns": [
    "^/oh-my-claudecode:",
    "^(cancelomc|stopomc)$"
  ]
}
```

#### `scripts/lib/git-utils.mjs` — Git/PR detection

```
getCurrentBranch(cwd):
  execSync('git rev-parse --abbrev-ref HEAD', { cwd })

findPrForBranch(branch, cwd):
  execSync('gh pr list --head <branch> --json number,url --limit 1', { cwd })
  parse JSON, return { number, url } or null

getRepoSlug(cwd):
  execSync('gh repo view --json nameWithOwner -q .nameWithOwner', { cwd })
```

#### `scripts/lib/pr-comment.mjs` — Batched PR comment posting

```
Architecture:
  [prompt] → appendToBatch() → .codepresso/state/codepresso-batch.jsonl
                                        ↓
  flushIfReady() checks:
    - Timer expired? (.codepresso/state/codepresso-flush-timer.json)
    - Batch full? (>= maxBatchSize)
                                        ↓
    YES → read batch, group by PR, format comment, spawn detached `gh pr comment`
          clear batch file, update timer

Key design:
  - JSONL file as queue (append-only, atomic)
  - Detached child process for `gh` CLI (never blocks hook)
  - Timer file tracks lastFlush timestamp
  - Fire-and-forget: hook returns immediately
```

---

### Step 3: Build hook scripts

#### `scripts/session-start.mjs` — SessionStart hook

Runs once per session:
1. Load config via `loadConfig(cwd)`
2. Check `prLogging.enabled`
3. Detect branch via `getCurrentBranch(cwd)`
4. If branch != main/master, find PR via `findPrForBranch(branch, cwd)`
5. Cache `{ branch, prNumber, prUrl, startedAt }` to `.codepresso/state/codepresso-session.json`
6. Return additionalContext: `[Codepresso] PR #42 detected. Prompts will be logged.`

#### `scripts/user-prompt-logger.mjs` — UserPromptSubmit hook

Runs on every prompt (MUST be fast, <3s):
1. Read stdin, extract prompt from `data.prompt || data.message?.content`
2. Load config, check `prLogging.enabled`
3. Read cached session state from `.codepresso/state/codepresso-session.json`
4. If no prNumber cached → return `{ continue: true }` (skip silently)
5. Check prompt against `excludePatterns` — skip OMC commands
6. Append `{ timestamp, prompt, sessionId, prNumber }` to batch file
7. Call `flushIfReady()` — non-blocking
8. Return `{ continue: true }` — NO additionalContext (silent, no noise)

#### `scripts/post-tool-git-watcher.mjs` — PostToolUse:Bash hook

Runs on Bash tool executions only:
1. Read stdin, extract `tool_input.command` and `tool_response`
2. Check if command matches `git push` or `git commit`
3. If not a git op → return `{ continue: true }`
4. Load config, check `prLogging.trackGitOps`
5. Read session state for prNumber
6. Extract commit hash/message from output
7. Spawn detached `gh pr comment` with formatted git activity comment
8. Return with brief additionalContext: `[Codepresso] Commit logged to PR #42`

---

### Step 4: PR comment templates

#### Batched prompt log (grouped):
```markdown
### :robot: Claude Code Activity Log

**Session:** `abc123` | **Branch:** `feature/auth-refactor`

| Time (UTC) | Prompt |
|------------|--------|
| 14:32:05 | Fix the authentication middleware to handle expired tokens |
| 14:33:12 | Add unit tests for the token refresh logic |
| 14:35:44 | Run the test suite and fix any failures |

---
<sub>Logged by Codepresso v0.1.0</sub>
```

#### Git operation:
```markdown
### :robot: Git Activity

**Commit:** `a1b2c3d` — Add token refresh middleware
**Time:** 2026-02-09T14:36:02Z

---
<sub>Logged by Codepresso v0.1.0</sub>
```

#### Manual summary (via `codepresso:log`):
```markdown
### :robot: Claude Code Session Summary

**Session:** `abc123` | **Duration:** ~15 minutes

#### What was done:
1. Implemented token refresh middleware in `src/auth/middleware.ts`
2. Added unit tests in `tests/auth/middleware.test.ts`
3. All tests passing (42 passed, 0 failed)

#### Files modified:
- `src/auth/middleware.ts` (new)
- `src/auth/types.ts` (modified)
- `tests/auth/middleware.test.ts` (new)

---
<sub>Logged by Codepresso v0.1.0</sub>
```

---

### Step 5: Build skills

#### `skills/setup/SKILL.md` — Interactive setup wizard
1. Check prerequisites: `gh auth status`, Node.js >= 20
2. Ask for Notion API key (optional, can skip)
3. Set PR logging preferences: batch interval, track git ops
4. Write `~/.codepresso/config.json`
5. Optionally configure current project: write `.codepresso.json`
6. Verify: `gh pr list --limit 1`

#### `skills/log/SKILL.md` — Manual PR summary
1. Read session state for PR number
2. Gather: `git diff --stat`, count files changed, summarize work
3. Format as structured PR comment
4. Post via `gh pr comment <number> --body "..."`

#### `skills/notion-sync/SKILL.md` — Notion task sync
1. Load config for Notion database ID
2. Query database using `notion_query_db` MCP tool
3. Present tasks as formatted list
4. User selects action: pull tasks / push status / link task
5. Execute via Notion MCP tools

---

### Step 6: Build Notion MCP server

`mcp/notion-server.mjs` — Standalone MCP server using `@modelcontextprotocol/sdk`.

Reads API key from `~/.codepresso/config.json` at startup.

**Exposed tools:**

| Tool | Description | Parameters |
|------|-------------|------------|
| `notion_query_db` | Query database with filters | `databaseId`, `filter?`, `sorts?` |
| `notion_create_page` | Create page in database | `databaseId`, `properties` |
| `notion_update_page` | Update page properties | `pageId`, `properties` |
| `notion_search` | Search by title | `query` |
| `notion_get_page` | Get page content | `pageId` |

---

## OMC Coexistence (No Conflicts)

| Concern | Design decision |
|---------|----------------|
| Both have UserPromptSubmit hooks | Both return `{ continue: true }`. Codepresso does NOT inject additionalContext on prompts — only appends to batch file silently |
| State file collision | All Codepresso files prefixed `codepresso-*` in `.codepresso/state/` |
| Config collision | OMC: `~/.claude/.omc-config.json` / Codepresso: `~/.codepresso/config.json` |
| Keyword collision | Codepresso has zero magic keywords. `excludePatterns` filters OMC commands from logs |
| Skill name collision | All Codepresso skills use `codepresso:` prefix |

---

## Installation

```bash
# Option A: Clone and install as plugin
git clone https://github.com/your-org/codepresso-plugin
cd codepresso-plugin && npm install
claude plugin add ./codepresso-plugin

# Option B: npm global install (once published)
npm install -g codepresso-plugin
claude plugin add codepresso-plugin

# Then run setup
# /codepresso:setup
```

---

## Verification Checklist

1. Start Claude Code on a branch with an open PR → verify `[Codepresso] PR #42 detected` message
2. Send 3-4 prompts, wait for batch interval → verify grouped comment appears on PR
3. Make a commit via Claude Code → verify commit comment appears on PR
4. Send `/oh-my-claudecode:help` → verify it does NOT appear in PR comments (excluded)
5. Run `codepresso:setup` → verify config files created correctly
6. Run `codepresso:notion-sync` → verify Notion database query works
7. Run OMC `autopilot` alongside Codepresso → verify no hook conflicts
