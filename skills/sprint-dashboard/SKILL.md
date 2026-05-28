---
name: sprint-dashboard
description: Display current sprint progress with epic breakdown and task status.
---

# Sprint Dashboard

Display current sprint progress with epic breakdown and task status.

## Trigger

User says: "sprint dashboard", "show sprint", "sprint status", "sprint progress"

## Steps

1. **Fetch sprint context** using the `notion_sprint_context` MCP tool:
   - Call `mcp__notion__notion_sprint_context` (or `mcp__plugin_codepresso_notion__notion_sprint_context` if installed as plugin) with `{ "include_completed": false, "assignee_only": false }`
   - **`assignee_only: false`** is required — the dashboard shows all team members' progress, not just the current user
   - This returns the full Sprint → Epic → Task hierarchy
   - **IMPORTANT:** Always use the MCP tool. NEVER use curl, Bash, or direct Notion API calls.

2. **Display the dashboard** in a structured format:

### Sprint Header
```
## Sprint: "{sprint.name}"
Period: {sprint.dateRange.start} → {sprint.dateRange.end}
Overall Progress: {summary.overallPct}% ({summary.completedTasks}/{summary.totalTasks} tasks)
Blocked: {summary.blockedTasks} tasks
```

### Epic Breakdown
For each epic, display:
```
### [{epic.uniqueId}] {epic.title} — {epic.completionPct}%
Status: {epic.status}
Tasks: {completed}/{total}

| Task | Status | Assignee |
|------|--------|----------|
| [{task.uniqueId}] {task.title} | {task.status} | {assignee} |
```

### Summary Bar
Show a visual progress bar:
```
Progress: [████████░░░░░░░░] 52%
```

3. **If sprint context is unavailable:**
   - Check if sprint workflow is configured: read `.codepresso.json` or `~/.codepresso/config.json`
   - If `notion.databases.sprint` is not set, tell the user to run `/codepresso:setup` first
   - If API key is missing, suggest configuring Notion integration

4. **Optional: Sprint progress MCP tool**
   - If user asks for just numbers/progress, use `mcp__notion__notion_sprint_progress` (or `mcp__plugin_codepresso_notion__notion_sprint_progress`) instead
   - This returns a lighter response with just completion percentages

## Notes
- All data comes from MCP tools — NEVER use curl, Bash, or direct Notion API calls
- The dashboard is read-only — it doesn't modify any Notion data
- The dashboard always shows ALL team members' tasks (`assignee_only: false`) for full sprint visibility
- MCP tools are auto-allowed via `.claude/settings.local.json` — no permission prompts needed
