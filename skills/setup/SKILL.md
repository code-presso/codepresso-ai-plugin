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

4. **PR logging preferences**
   - Ask for batch interval (default: 60s)
   - Ask for max batch size (default: 10)
   - Ask for prompt truncation length (default: 500 chars)

5. **Write configuration**
   - Write global config to `~/.codepresso/config.json`
   - Optionally write per-project `.codepresso.json`
   - Add `.codepresso.json` pattern to `.gitignore` if it contains secrets

6. **Verify setup**
   - Start a test by detecting current branch and PR
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
</Final_Checklist>
