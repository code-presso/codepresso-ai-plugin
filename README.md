# Codepresso

Team workflow plugin for Claude Code — GitHub PR logging, prompt scoring, optional deploy integration, and Notion task sync.

## What It Does

- **Prompt Logging**: Automatically captures user prompts and posts batched activity logs as PR comments
- **Prompt Scoring**: Scores each prompt 0-10 for clarity/specificity using a cheap model (Haiku) — included in PR comments
- **Git Tracking**: Detects `git commit` and `git push` operations, logs them to the associated PR
- **Deploy Integration** (optional): Trigger deployments from Claude Code — ECS, CodePipeline, or custom
- **Notion Sync**: Query and update Notion database tasks via MCP tools
- **OMC Compatible**: Runs alongside oh-my-claudecode with zero conflicts

## Installation

### Option A: Symlink to plugins directory

```bash
ln -s /path/to/codepresso-plugin ~/.claude/plugins/codepresso
```

### Option B: Claude plugin add

```bash
claude plugin add ./codepresso-plugin
```

### Install dependencies

```bash
cd codepresso-plugin && npm install
```

## Setup

Run the interactive setup wizard:

```
codepresso:setup
```

Or manually create `~/.codepresso/config.json`:

```json
{
  "github": { "token": null },
  "notion": { "apiKey": "ntn_...", "defaultDatabaseId": "abc123" },
  "prLogging": {
    "enabled": true,
    "trackGitOps": true,
    "batchIntervalSeconds": 60,
    "maxBatchSize": 10,
    "truncatePromptLength": 500
  },
  "scoring": {
    "enabled": true,
    "model": "claude-haiku-4-5-20251001"
  },
  "deploy": {
    "enabled": false,
    "method": null
  }
}
```

### Per-Project Config

Create `.codepresso.json` in your project root to override global settings:

```json
{
  "prLogging": { "enabled": true, "batchIntervalSeconds": 30 },
  "scoring": { "enabled": true },
  "deploy": {
    "enabled": true,
    "method": "ecs",
    "awsRegion": "ap-northeast-2",
    "ecsCluster": "my-cluster",
    "ecsService": "my-service"
  },
  "notion": { "databaseId": "project-specific-db-id" },
  "excludePatterns": ["^/oh-my-claudecode:", "^(cancelomc|stopomc)$"]
}
```

## How It Works

### Session Start

When you start Claude Code on a feature branch with an open PR, Codepresso:
1. Detects the current branch
2. Finds the associated PR via `gh pr list`
3. Caches session state to `.omc/state/codepresso-session.json`
4. Displays: `[Codepresso] PR #42 detected. Prompts will be logged.`

### Prompt Logging + Scoring

Every user prompt is:
1. Checked against exclude patterns (OMC commands filtered out)
2. Truncated to configured length
3. Appended to a JSONL batch file
4. Flushed to the PR as a grouped comment when the batch interval expires or max size is reached
5. Scored 0-10 by Haiku at flush time (if `ANTHROPIC_API_KEY` is set and scoring enabled)

PR comments look like:

```markdown
### 🤖 Claude Code Activity Log

**Session:** `abc12345` | **Branch:** `feature/auth-refactor`
**Avg Score:** 7.3/10

| Time (UTC) | Score | Prompt |
|------------|-------|--------|
| 14:32:05 | **9** ⭐ | Fix the authentication middleware to handle expired tokens |
| 14:33:12 | **7** ✅ | Add unit tests for the token refresh logic |
| 14:35:44 | **3** ⚠️ | fix it |
```

Scoring is best-effort: if `ANTHROPIC_API_KEY` is missing or scoring is disabled, comments are posted without scores (same as before).

### Git Tracking

When Claude Code runs `git commit` or `git push`, Codepresso posts:

```markdown
### 🤖 Git Activity

**Commit:** `a1b2c3d` — Add token refresh middleware
**Time:** 2026-02-09T14:36:02Z
```

### Deploy Integration (Optional)

Each team configures their own deploy strategy. Deploy is **disabled by default**.

To enable, add to your project's `.codepresso.json`:

```json
{
  "deploy": {
    "enabled": true,
    "method": "ecs",
    "awsRegion": "ap-northeast-2",
    "ecsCluster": "my-cluster",
    "ecsService": "my-app"
  }
}
```

Supported methods:

| Method | Description | Config Keys |
|--------|-------------|-------------|
| `ecs` | Direct ECS deployment | `awsRegion`, `ecsCluster`, `ecsService` |
| `codepipeline` | Trigger AWS CodePipeline | `awsRegion`, `pipelineName` |
| `workflow` | Trigger GitHub Actions workflow | `workflowFile` |
| `custom` | Run custom deploy command | `customCommand` |

Then say "deploy to staging" in Claude Code.

**Workflow templates** are provided in `templates/workflows/` — copy them to your project's `.github/workflows/` and configure secrets.

## Skills

| Skill | Trigger | Description |
|-------|---------|-------------|
| `codepresso:setup` | "setup codepresso" | Interactive configuration wizard |
| `codepresso:log` | "codepresso log" | Manually post session summary to PR |
| `codepresso:deploy` | "deploy", "deploy to" | Trigger deployment (requires config) |
| `codepresso:notion-sync` | "sync notion tasks" | Query/update Notion database tasks |

## Notion Integration

Codepresso includes an MCP server for Notion with these tools:

| Tool | Description |
|------|-------------|
| `notion_query_db` | Query a database with filters and sorts |
| `notion_create_page` | Create a page in a database |
| `notion_update_page` | Update page properties |
| `notion_search` | Search pages by title |

To enable, add your Notion Internal Integration Token during `codepresso:setup`.

## OMC Coexistence

Codepresso is designed to run alongside oh-my-claudecode without conflicts:

| Concern | Design |
|---------|--------|
| Both have UserPromptSubmit hooks | Both return `{ continue: true }`. Codepresso is silent (no additionalContext on prompts) |
| State files | All prefixed `codepresso-*` in `.omc/state/` |
| Config | OMC: `~/.claude/.omc-config.json`, Codepresso: `~/.codepresso/config.json` |
| Keywords | Codepresso has zero magic keywords. `excludePatterns` filters OMC commands |

## Prerequisites

- Node.js >= 20
- `gh` CLI installed and authenticated (`gh auth login`)
- `ANTHROPIC_API_KEY` env var (for prompt scoring, optional)
- Notion API key (optional, for Notion features)
- AWS CLI configured (optional, for deploy features)

## Directory Structure

```
codepresso-plugin/
├── .claude-plugin/plugin.json    # Plugin manifest
├── hooks/hooks.json              # Hook declarations
├── scripts/
│   ├── lib/
│   │   ├── stdin.mjs             # Timeout-protected stdin reader
│   │   ├── git-utils.mjs         # Branch/PR detection
│   │   ├── config.mjs            # Config loader (global + per-project)
│   │   ├── pr-comment.mjs        # Batched PR comment posting
│   │   └── prompt-scorer.mjs     # Prompt scoring via Anthropic API
│   ├── user-prompt-logger.mjs    # UserPromptSubmit hook
│   ├── post-tool-git-watcher.mjs # PostToolUse:Bash hook
│   ├── session-start.mjs         # SessionStart hook
│   └── score-and-post.mjs        # Detached scorer + poster
├── skills/
│   ├── log/SKILL.md              # Manual PR summary posting
│   ├── deploy/SKILL.md           # Deploy trigger (optional)
│   ├── notion-sync/SKILL.md      # Notion task sync
│   └── setup/SKILL.md            # Setup wizard
├── templates/
│   └── workflows/
│       ├── deploy-ecs.yml        # GitHub Actions template for ECS
│       └── deploy-codepipeline.yml # GitHub Actions template for CodePipeline
├── mcp/notion-server.mjs         # Notion MCP server
├── .mcp.json                     # MCP server declaration
├── .claude/settings.local.json   # MCP server enablement
└── package.json
```

## License

MIT
