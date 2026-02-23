---
name: setup
description: Interactive setup wizard for Codepresso
---

<Purpose>
Guide the user through configuring Codepresso: verify prerequisites (gh CLI, Notion API key),
set logging preferences, and write config files.
</Purpose>

<Use_When>
- User says "setup codepresso" or "codepresso setup"
- User wants to configure PR logging or Notion integration
- First time using Codepresso in a project
</Use_When>

<Do_Not_Use_When>
- User just wants to log a prompt manually (use `codepresso:log`)
- User wants to sync Notion tasks (use `codepresso:notion-sync`)
</Do_Not_Use_When>

<Steps>
1. **Check prerequisites**
   - Verify `gh` CLI is installed and authenticated: `gh auth status`
   - Verify Node.js >= 20

2. **GitHub configuration**
   - Confirm `gh` auth works for the current repo
   - Test PR access: `gh pr list --limit 1`

3. **Notion configuration** (optional)
   - Ask if user wants Notion integration
   - If yes, prompt for Notion API key (Internal Integration Token)
   - Prompt for default database ID
   - Test connection via MCP notion tools
   - Use `notion_get_users` MCP tool to list workspace members
   - Ask the user to select themselves from the list (sets `notion.userId` and `notion.displayName`)
   - Ask for the name of the assignee property in their database (default: "Assignee")

4. **Sprint workflow configuration** (optional — requires Notion from step 3)
   - Ask if user wants sprint workflow automation
   - If yes, prompt for three database IDs with pre-filled defaults:
     - **Sprint database ID** (default: `171c7154878d8013ab18f159929ba3b8`) — tracks sprints with 상태/Status select, 기간/Date, epic relation
     - **Epic database ID** (default: `6e60ce8862704ef295e3a3f796ee6302`) — tracks epics with 상태/Status select, unique ID prefix "GP"
     - **Task database ID** (default: same as `defaultDatabaseId` from step 3, i.e. `77bb2292512e472d8b049ec5b21b1554`) — tracks tasks
   - Present defaults using AskUserQuestion: "Use default Codepresso database IDs?" with options "Yes, use defaults" / "No, enter custom IDs"
   - If custom: prompt each ID individually. Tip: Database ID is in the Notion URL: `notion.so/workspace/<DATABASE_ID>?v=...`
   - Test connection: use `mcp__plugin_codepresso_notion__notion_query_db` or `mcp__notion__notion_query_db` to query each database with `page_size: 1` to verify access
   - Ask for sprint workflow preferences using AskUserQuestion:
     - Auto-transition tasks to "진행 중" when selected? (default: true)
     - Auto-complete epics when all tasks are done? (default: true)
     - PR title format: "task" for `[TSK-XXX]` only, or "epic+task" for `[GP-XXX][TSK-XXX]`? (default: "task")
   - Write `notion.databases` and `notion.sprintWorkflow` to config

5. **PR logging preferences**
   - Ask for batch interval (default: 60s)
   - Ask for max batch size (default: 10)
   - Ask for prompt truncation length (default: 500 chars)

6. **Write configuration**
   - Write global config to `~/.codepresso/config.json`
   - Optionally write per-project `.codepresso.json`
   - Add `.codepresso.json` pattern to `.gitignore` if it contains secrets

7. **Verify setup**
   - Start a test by detecting current branch and PR
   - If sprint workflow enabled, test sprint fetch: query sprint DB for current sprint
   - Confirm everything works
   - Print summary of configuration
</Steps>

<Tool_Usage>
- Use `Bash` for running `gh auth status` and `gh pr list`
- Use `AskUserQuestion` for preference gathering
- Use `Write` for config files
</Tool_Usage>

<Examples>
<Good>
User: "setup codepresso"
Action: Run full interactive wizard
</Good>
<Good>
User: "configure codepresso for this project"
Action: Run wizard focused on per-project config
</Good>
</Examples>

<Final_Checklist>
- [ ] `gh` CLI authenticated
- [ ] Global config written to `~/.codepresso/config.json`
- [ ] PR detection works for current branch
- [ ] Notion configured (if requested)
- [ ] Notion user identity set (userId and displayName in config)
- [ ] Sprint databases configured (if requested): sprint, epic, task IDs
- [ ] Sprint workflow preferences set (autoTransition, epicAutoComplete, prTitleFormat)
</Final_Checklist>
