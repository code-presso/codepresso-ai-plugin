---
name: daily-chat
description: Send daily task summary to Google Chat
---

<Purpose>
Manually send a Google Chat message with your current in-progress Notion tasks to a configured Google Chat space.
This is the same message that is automatically sent on your first Claude session each day.
Uses the `gws` CLI (Google Workspace CLI) with OAuth to send as the user's profile.
</Purpose>

<Use_When>
- User says "codepresso daily chat" or "send daily summary"
- User wants to manually trigger the daily Google Chat greeting
- User wants to re-send today's task summary
</Use_When>

<Do_Not_Use_When>
- Google Chat is not configured (direct user to `codepresso:setup` first)
- User wants to sync Notion tasks (use `codepresso:notion-sync`)
</Do_Not_Use_When>

<Steps>
1. **Verify configuration**
   - Load config from `~/.codepresso/config.json`
   - Check `googleChat.enabled` is true and `googleChat.spaceId` is set
   - Check `notion.apiKey` and `notion.defaultDatabaseId` are configured
   - If any missing, inform user to run `codepresso:setup`

2. **Fetch current tasks**
   - Read session state from `.omc/state/codepresso-session.json` for cached tasks
   - If no cached tasks, use MCP tool `notion_query_db` to fetch fresh tasks

3. **Format and send message**
   - Group tasks by status: "진행 중" (in progress) and others (대기 중 / waiting)
   - Skip completed tasks (완료/done/completed)
   - Format message with task IDs and titles:
     ```
     {displayName}님,

     📋 오늘의 작업 현황

     *진행 중인 작업:*
     • [TSK-1234] Task title

     *대기 중인 작업:*
     • [TSK-5678] Another task

     총 N개 작업 (진행 중 X개, 대기 Y개)

     좋은 하루 되세요! 🚀
     ```
   - Send via `gws` CLI (sends as user's profile, not a bot):
     ```bash
     gws chat spaces messages create \
       --params '{"parent":"spaces/SPACE_ID"}' \
       --json '{"text":"MESSAGE"}'
     ```

4. **Confirm to user**
   - Show the message that was sent
   - Confirm delivery success
</Steps>

<Tool_Usage>
- Use `Bash` for sending via `gws` CLI (manual trigger)
- Use `Read` for loading config and session state
- Use MCP tools for fresh Notion data if needed
</Tool_Usage>

<Examples>
<Good>
User: "codepresso daily chat"
Action: Send task summary to configured Google Chat space
</Good>
<Good>
User: "send my daily summary to chat"
Action: Fetch tasks, format, send to Google Chat
</Good>
</Examples>

<Final_Checklist>
- [ ] Google Chat configured (enabled + spaceId)
- [ ] Tasks fetched from Notion
- [ ] Message formatted and sent
- [ ] User confirmed delivery
</Final_Checklist>
