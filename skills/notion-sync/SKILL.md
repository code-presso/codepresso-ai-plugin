---
name: notion-sync
description: Sync tasks between Notion database and current project
---

<Purpose>
Query a Notion database for tasks, display them to the user, and allow updating
task status. Uses the Codepresso Notion MCP server for API access.
</Purpose>

<Use_When>
- User says "codepresso notion sync" or "sync notion tasks"
- User wants to see their Notion task board
- User wants to update a task status in Notion
</Use_When>

<Do_Not_Use_When>
- Notion is not configured (direct user to `codepresso:setup` first)
- User wants PR logging only (that's automatic)
</Do_Not_Use_When>

<Steps>
1. **Verify Notion configuration**
   - Load config and check `notion.apiKey` and `notion.defaultDatabaseId` exist
   - If missing, inform user to run `codepresso:setup` first

2. **Query Notion database**
   - Use MCP tool `notion_query_db` with the configured database ID
   - Apply filters if user specified (e.g., "show in-progress tasks")

3. **Display tasks**
   - Format tasks as a readable table or list
   - Show: title, status, assignee, due date (if available)

4. **Handle updates** (if requested)
   - User selects a task to update
   - Use `AskUserQuestion` for new status
   - Use MCP tool `notion_update_page` to apply change

5. **Link to PR** (optional)
   - If a PR is detected, offer to add PR link to the Notion task
   - Use `notion_update_page` to set a URL property
</Steps>

<Tool_Usage>
- Use MCP tools: `notion_query_db`, `notion_update_page`, `notion_create_page`, `notion_search`
- Use `AskUserQuestion` for task selection and status updates
- Use `Read` to load config
</Tool_Usage>

<Examples>
<Good>
User: "codepresso notion sync"
Action: Query DB, display tasks, offer to update
</Good>
<Good>
User: "show my notion tasks for this sprint"
Action: Query with sprint filter, display results
</Good>
<Good>
User: "mark task X as done in notion"
Action: Find task, update status to Done
</Good>
</Examples>

<Final_Checklist>
- [ ] Notion API key configured
- [ ] Database queried successfully
- [ ] Tasks displayed to user
- [ ] Updates applied (if requested)
</Final_Checklist>
