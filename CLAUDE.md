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
├── hooks/hooks.json               # 4 hook declarations (SessionStart, UserPromptSubmit, PostToolUse:Bash, Stop)
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
│   │   └── qa-evaluator.mjs       # QA evaluation engine (5 dimensions, API + parsing)
│   ├── session-start.mjs          # SessionStart hook: detect branch/PR, cache state + headCommit
│   ├── user-prompt-logger.mjs     # UserPromptSubmit hook: batch prompts silently
│   ├── post-tool-git-watcher.mjs  # PostToolUse:Bash hook: detect git commit/push
│   ├── session-end.mjs            # Stop hook: force-flush remaining batch + spawn QA
│   ├── score-and-post.mjs         # Detached process: score batch + post PR comment
│   └── qa-runner.mjs              # Detached process: QA evaluation + PR comment
├── skills/
│   ├── setup/SKILL.md             # Interactive setup wizard
│   ├── log/SKILL.md               # Manual PR summary posting
│   ├── status/SKILL.md            # Plugin status and diagnostics
│   ├── notion-sync/SKILL.md       # Notion task query/update
│   ├── deploy/SKILL.md            # Deploy trigger (optional)
│   ├── dashboard/SKILL.md         # Team analytics dashboard
│   └── qa/SKILL.md                # Manual QA evaluation trigger
├── tests/lib/                     # Unit tests (node:test + node:assert)
├── mcp/
│   └── notion-server.mjs          # MCP server exposing 4 Notion API tools
├── templates/workflows/           # GitHub Actions templates (ECS, CodePipeline)
├── .claude-plugin/plugin.json     # Plugin manifest
├── .mcp.json                      # MCP server declaration
└── package.json
```

### Data Flow

```
User Prompt → UserPromptSubmit hook → redact secrets → batch queue (.jsonl)
                                          ↓ (interval/size trigger + rate limit check)
                                     score-and-post.mjs (detached)
                                          ↓
                                     API scoring → PR comment via `gh` → apply PR labels (first flush)

Git Commit → PostToolUse:Bash hook → detached `gh pr comment`

Session Start → SessionStart hook → detect branch → find PR → cache state + headCommit
Session End  → Stop hook → force-flush remaining batch → spawn QA runner (detached)
                                                              ↓
                                                         git diff (headCommit..HEAD)
                                                              ↓
                                                         API evaluation (5 dimensions)
                                                              ↓
                                                         Record qa_report → post PR comment
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

### 5. OMC Coexistence
- State files: all prefixed `codepresso-*` in `.omc/state/`
- Config: separate path `~/.codepresso/config.json` (not `~/.claude/`)
- Skills: all use `codepresso:` prefix
- Exclude patterns: regex-based filtering of OMC commands from logs

---

## Hook Contracts

### SessionStart (`scripts/session-start.mjs`)
- **Timeout:** 5s
- **Input:** Standard hook stdin (session metadata)
- **Output:** `{ continue: true, additionalContext?: string }`
- **Side effects:** Writes `.omc/state/codepresso-session.json`
- **Failure mode:** Silent (returns `{ continue: true }` on error)

### UserPromptSubmit (`scripts/user-prompt-logger.mjs`)
- **Timeout:** 3s (CRITICAL — must be fast)
- **Input:** `hookInput.userPrompt` from stdin
- **Output:** `{ continue: true }` — never adds `additionalContext`
- **Side effects:** Appends to `.omc/state/codepresso-batch.jsonl`, may spawn detached scorer
- **Failure mode:** Silent

### PostToolUse:Bash (`scripts/post-tool-git-watcher.mjs`)
- **Timeout:** 3s
- **Matcher:** `Bash` only
- **Input:** `toolInput.command` and `toolOutput` from stdin
- **Output:** `{ continue: true, additionalContext?: string }`
- **Side effects:** Spawns detached `gh pr comment` for git operations
- **Failure mode:** Silent

### Stop (`scripts/session-end.mjs`)
- **Timeout:** 5s
- **Input:** Standard hook stdin
- **Output:** `{ continue: true }`
- **Side effects:** Force-flushes remaining batch entries (prevents prompt loss)
- **Failure mode:** Silent

---

## State Files

All state lives in `.omc/state/` with `codepresso-` prefix:

| File | Format | Purpose |
|------|--------|---------|
| `codepresso-session.json` | JSON | Cached branch, PR number, session ID, labelsApplied flag |
| `codepresso-batch.jsonl` | JSONL | Pending prompt queue (redacted) |
| `codepresso-batch-timer.json` | JSON | Flush timer (`{ startedAt: epoch_ms }`) |
| `codepresso-flush-*.json` | JSON | Temporary scoring payloads (auto-cleaned) |
| `codepresso-flush.lock` | Text | Atomic flush lock (PID, stale after 30s) |
| `codepresso-rate-limit.json` | JSON | Rate limit state per PR (hourly + session counts) |
| `codepresso-qa-*.json` | JSON | Temporary QA payloads for detached runner (auto-cleaned) |

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
    "defaultDatabaseId": null                      // Default Notion DB for sync
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
  "qa": {
    "enabled": true,                               // Enable automated QA evaluation at session end
    "dimensions": [                                // Quality dimensions to evaluate
      "quality", "security", "testing", "documentation", "performance"
    ],
    "minScoreThreshold": 5,                        // Minimum acceptable score (0-10, warn-only)
    "postToPr": true,                              // Post QA report as PR comment
    "model": "claude-haiku-4-5-20251001",          // Model for QA evaluation
    "paths": []                                    // Path filters for monorepos (e.g. ["packages/api/**"])
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

### QA not running
- Verify `qa.enabled` is not `false` in config
- Ensure `ANTHROPIC_API_KEY` is set (required for API evaluation)
- Check that `headCommit` exists in `.omc/state/codepresso-session.json`
- Verify there are actual git changes since session start: `git diff <headCommit>..HEAD --stat`

---

## QA System

### Overview

Automated code quality evaluation that runs at session end and scores changes across 5 dimensions: quality, security, testing, documentation, and performance. Operates in **warn-only** mode (PR comments, never blocking).

### How It Works

1. **Session start** — `session-start.mjs` captures `headCommit` (current HEAD hash) in session state
2. **Session end** — `session-end.mjs` spawns `qa-runner.mjs` as a detached process
3. **QA runner** — computes `git diff headCommit..HEAD`, calls Anthropic API via `qa-evaluator.mjs`
4. **Results** — recorded as `qa_report` in analytics JSONL, optionally posted as PR comment

### Dimensions

| Dimension | Checks |
|-----------|--------|
| quality | Readability, naming, structure, error handling, code smells |
| security | Injection, auth, secrets, input validation, dependency risks |
| testing | Untested logic, missing edge cases, assertion quality |
| documentation | JSDoc, README updates, undocumented APIs |
| performance | N+1 queries, memory leaks, blocking ops |

### Manual Trigger

Use `codepresso:qa` skill to run QA evaluation on-demand. The manual version uses the LLM directly (no API call) to evaluate the diff and display a report inline.

### Key Files

| File | Purpose |
|------|---------|
| `scripts/lib/qa-evaluator.mjs` | Core module: prompt building, API call, response parsing, comment formatting |
| `scripts/qa-runner.mjs` | Detached process: orchestrates diff → evaluate → record → post |
| `skills/qa/SKILL.md` | Manual QA skill for on-demand evaluation |

### Analytics Integration

QA reports are stored as `qa_report` records in `~/.codepresso/analytics/sessions.jsonl` with fields: `overallScore`, `dimensionScores`, `filesChanged`, `linesAdded`, `linesRemoved`. The dashboard skill displays QA metrics including dimension trends and per-session QA scores.
