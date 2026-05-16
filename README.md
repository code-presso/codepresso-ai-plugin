# Codepresso

Team workflow plugin for Claude Code — Notion task sync, sprint workflow automation, PR-linked git activity, daily Google Chat bookends, and optional deploy integration.

## What It Does

- **Notion Task Picker**: Pick your Notion task at session start — auto-updates status and enforces PR title format for auto-linking
- **PR Title Enforcement**: Blocks `gh pr create` unless the title carries the selected task's unique ID (e.g. `TSK-9945`) so Notion's GitHub integration links the PR automatically
- **Git Tracking**: Detects `git commit` on the active PR and posts a commit comment via `gh pr comment`
- **PR Merge → Notion Transition**: Detects `gh pr merge` and transitions the linked Notion task (and epic, if applicable) to complete
- **Sprint Workflow**: Sprint → Epic → Task hierarchy fetched at session start; cascade epic completion when all tasks are done
- **Deploy Integration** (optional): Trigger deployments from Claude Code — ECS, CodePipeline, or custom
- **평일 Google Chat 북엔드** (월–금): 첫 세션 시작 시 진행 중 작업 + 내 오픈 PR + 리뷰 요청 PR을 아침 인사로 전송, 오후 6시에는 오늘의 커밋/머지된 PR/진행 중 작업을 Claude Haiku로 요약해 마감 메시지로 전송
- **OMC Compatible**: Runs alongside oh-my-claudecode with zero conflicts
- **Monorepo / Submodule Support**: Automatically detects submodule PRs when working from a monorepo root

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
  "notion": {
    "apiKey": "ntn_...",
    "defaultDatabaseId": "abc123",
    "databases": {
      "sprint": "...",
      "epic": "...",
      "task": "..."
    },
    "sprintWorkflow": {
      "enabled": true,
      "autoTransition": true,
      "epicAutoComplete": true,
      "prTitleFormat": "task"
    }
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
  "deploy": {
    "enabled": true,
    "method": "ecs",
    "awsRegion": "ap-northeast-2",
    "ecsCluster": "my-cluster",
    "ecsService": "my-service"
  },
  "notion": { "defaultDatabaseId": "project-specific-db-id" }
}
```

## Daily Workflow

Here's what a typical day looks like with Codepresso:

### 1. Start Claude Code

```
$ claude
```

Codepresso automatically:
- Detects your branch and PR
- Fetches your Notion tasks (filtered by assignee)
- On the first weekday session of the day, sends your morning summary to Google Chat (if configured)

### 2. Pick a Task

An interactive picker appears with your active Notion tasks:

```
Which task would you like to work on?

  [TSK-9945] plugin과 notion 연동 되도록 title 형식 지정  (진행 중)
  [TSK-8700] Oracle DB 성능 테스트                        (할 일)
  [TSK-8650] C, Java, Python 프로토타이핑                  (진행 중)
  Other
```

When you pick a task, Codepresso:
- Updates the Notion task status to "진행 중" (In Progress)
- Saves the selection for PR title enforcement

### 3. Work Normally

Write code, commit. Each `git commit` posts a small comment to the open PR so reviewers can follow along.

### 4. Create a PR

When you create a PR, Codepresso **enforces** the Notion task ID in the title:

```
# This gets blocked:
gh pr create --title "Add PR title format"

# Codepresso suggests:
gh pr create --title "TSK-9945 Add PR title format"
```

The `TSK-9945` prefix enables Notion's GitHub integration to **automatically link** the PR to your task — no manual connection needed.

### 5. Merge

When you `gh pr merge`, Codepresso transitions the linked Notion task to complete and, if the epic's last task just finished, marks the epic complete too.

---

## How It Works (Details)

### Session Start

When you start Claude Code, Codepresso:
1. Resolves the git root via `git rev-parse --show-toplevel`
2. Detects the current branch
3. Finds the associated PR via `gh pr list`
4. If no PR found (e.g., monorepo root on `main`), scans submodules for active branches with open PRs
5. Fetches your Notion tasks (with unique IDs like `TSK-9945`) and sprint context
6. Caches everything to `.codepresso/state/codepresso-session.json` (including `gitRoot` and `activeSubmodule`)

### Git Tracking

When Claude Code runs `git commit` and a PR exists, Codepresso posts:

```markdown
### 🤖 Git Activity

**Commit:** `a1b2c3d` — Add token refresh middleware
**Time:** 2026-02-09T14:36:02Z
```

### 평일 Google Chat 북엔드 (월–금, 선택)

평일마다 설정된 Google Chat 스페이스로 `gws` CLI를 통해 본인 계정으로 두 개의 메시지를 전송합니다.

**아침 인사** — 평일 첫 Claude 세션에 자동 전송:
- 진행 중인 Notion 작업
- 내가 작성한 오픈 PR
- 리뷰 요청 받은 PR
- Claude Haiku가 생성한 응원 한 줄

**저녁 마감 요약** — 월–금 18:00 (세션 크론 `3 18 * * 1-5 /codepresso:daily-summary`):
- 오늘의 커밋 (`git log --author=<you> --since=midnight`)
- 오늘 머지된 PR (`gh search prs --author @me --merged-at <today>`)
- 오늘 닫힌(미머지) PR
- 아직 진행 중인 Notion 작업
- `claude -p --model haiku`로 생성한 2–4문장 한국어 요약 (`claude` CLI가 없으면 결정론적 템플릿으로 폴백)

활성화하려면 `codepresso:setup`을 실행하거나 `~/.codepresso/config.json`에 아래 설정을 추가하세요.

```json
{
  "googleChat": {
    "enabled": true,
    "dailyGreeting": true,
    "spaceId": "AAAAxxxxxxx"
  }
}
```

수동 실행: `codepresso:daily-chat` (아침) · `codepresso:daily-summary` (저녁) — 요일 상관없이 언제든 실행 가능합니다. 실제 전송 없이 저녁 메시지를 미리 보려면:

```bash
CODEPRESSO_DRY_RUN=1 node scripts/daily-chat-summary.mjs
```

**필수 조건:** `chat.messages.create` 스코프로 인증된 `gws` CLI. Haiku 품질의 저녁 요약을 원한다면 PATH 상의 `claude` CLI (선택 — 없으면 폴백 동작).

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
| `codepresso:status` | "codepresso status" | Plugin status and diagnostics |
| `codepresso:notion-sync` | "sync notion tasks" | Query/update Notion database tasks |
| `codepresso:sprint-dashboard` | "sprint dashboard" | Sprint progress overview |
| `codepresso:sprint-retro` | "sprint retro" | Sprint retrospective report |
| `codepresso:generate-epic` | "generate epic" | Epic PRD document generation |
| `codepresso:daily-chat` | "daily chat", "send morning summary" | 아침 Google Chat 인사 수동 전송 |
| `codepresso:daily-summary` | "daily summary", "end of day summary" | 저녁 Google Chat 마감 요약 수동 전송 (월–금 18:00 크론에서도 자동 실행) |
| `codepresso:deploy` | "deploy", "deploy to" | Trigger deployment (requires config) |
| `codepresso:oncall` | "who's on call?", "이번주 온콜 누구?" | Query current on-call schedule from DynamoDB + Google Calendar |
| `codepresso:oncall-generate` | "generate next month's oncall" | Invoke allocator Lambda to produce next month's rotation, sync to calendar |
| `codepresso:oncall-swap` | "swap oncall", "온콜 바꿔줘" | Swap, replace, or role-swap on-call assignments for a specific week |
| `codepresso:oncall-sync-calendar` | "sync oncall calendar" | Reconcile Google Calendar against DynamoDB (recover from missed syncs) |
| `codepresso:oncall-seed-metadata` | "seed engineer metadata" | Seed engineer → GitHub username mapping for deploy gate verification |
| `codepresso:oncall-runbook` | "runbook", "oncall runbook" | Look up sections of `docs/oncall-runbook.md` (sev1, rollback, etc.) |

## Notion Integration

### Task Picker + PR Auto-Linking

At session start, Codepresso fetches tasks from your Notion database and presents an interactive picker. When you select a task:

1. Task status is updated to "진행 중" in Notion
2. The task's unique ID (e.g., `TSK-9945`) is saved locally
3. When creating a PR, the hook enforces the ID in the title: `TSK-9945 description`
4. Notion's GitHub integration auto-links the PR to the task

**Requirements:** Your Notion database must have a `unique_id` property (built-in Notion feature) and a `status` property.

### MCP Tools

Codepresso includes an MCP server for Notion:

| Tool | Description |
|------|-------------|
| `notion_query_db` | Query a database with filters and sorts |
| `notion_create_page` | Create a page in a database |
| `notion_update_page` | Update page properties |
| `notion_search` | Search pages by title |
| `notion_get_users` | List workspace members |

To enable, add your Notion Internal Integration Token during `codepresso:setup`.

## OMC Coexistence

Codepresso is designed to run alongside oh-my-claudecode without conflicts:

| Concern | Design |
|---------|--------|
| State files | All prefixed `codepresso-*` in `.codepresso/state/` |
| Config | OMC: `~/.claude/.omc-config.json`, Codepresso: `~/.codepresso/config.json` |
| Hooks | Codepresso uses SessionStart, PreToolUse, PostToolUse only — no UserPromptSubmit |

## Prerequisites

- Node.js >= 20
- `gh` CLI installed and authenticated (`gh auth login`)
- Notion API key (optional, for Notion features)
- AWS CLI configured (optional, for deploy features)
- `chat.messages.create` 스코프로 인증된 `gws` CLI (선택 — 평일 Google Chat 북엔드용)
- PATH 상의 `claude` CLI (선택 — Haiku 기반 저녁 요약용)

## Directory Structure

```
codepresso-plugin/
├── .claude-plugin/plugin.json     # Plugin manifest
├── hooks/hooks.json               # 3 hook declarations (SessionStart, PreToolUse, PostToolUse)
├── scripts/
│   ├── lib/
│   │   ├── stdin.mjs              # Timeout-protected stdin reader
│   │   ├── config.mjs             # Config loader (global + per-project)
│   │   ├── git-utils.mjs          # Branch/PR detection
│   │   ├── git-root.mjs           # Session gitRoot reader for hooks
│   │   ├── logger.mjs             # Debug logger
│   │   ├── notion-tasks.mjs       # Notion task fetcher + unique ID extraction
│   │   ├── sprint-context.mjs     # Sprint > Epic > Task hierarchy fetcher
│   │   ├── status-transitions.mjs # Task/Epic status transitions
│   │   └── gws.mjs                # Google Chat / gws CLI helpers
│   ├── session-start.mjs          # SessionStart: branch/PR detection + Notion task fetch + weekday morning greeting spawn
│   ├── pre-tool-notion-inject.mjs # PreToolUse: task picker + PR title enforcement
│   ├── post-tool-git-watcher.mjs  # PostToolUse:Bash: git commit comment + merge transition
│   ├── handle-merge-transition.mjs # Detached: PR merge → task complete → epic cascade
│   ├── daily-chat-greeting.mjs    # 아침 Google Chat 인사 (detached)
│   └── daily-chat-summary.mjs     # 저녁 Google Chat 요약 (manual or cron)
├── skills/
│   ├── setup/SKILL.md             # Setup wizard
│   ├── status/SKILL.md            # Plugin diagnostics
│   ├── notion-sync/SKILL.md       # Notion task sync
│   ├── sprint-dashboard/SKILL.md  # Sprint progress overview
│   ├── sprint-retro/SKILL.md      # Sprint retrospective report
│   ├── generate-epic/SKILL.md     # Epic PRD generation
│   ├── daily-chat/SKILL.md        # 아침 Google Chat 인사 (수동 실행)
│   ├── daily-summary/SKILL.md     # 저녁 Google Chat 요약 (수동 또는 월–금 18:00 크론)
│   ├── deploy/SKILL.md            # Deploy trigger (optional)
│   └── oncall*/SKILL.md           # On-call management skills
├── tests/lib/                     # Unit tests (node:test + node:assert)
├── mcp/notion-server.mjs          # Notion MCP server
├── templates/workflows/           # GitHub Actions deploy templates
├── .mcp.json                      # MCP server declaration
└── package.json
```

## License

MIT
