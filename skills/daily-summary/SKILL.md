---
name: daily-summary
description: Evening summary — summarize today's commits, merged/closed PRs, and in-progress Notion tasks, then send to Google Chat
---

<Purpose>
Send an end-of-day Google Chat message summarizing today's commits, merged/closed PRs, and still-in-progress Notion tasks.
Uses the local `claude` CLI (Haiku) to produce the narrative summary.
Delivers via the `gws` CLI (Google Workspace CLI) as the authenticated user.
Designed to fire automatically Mon–Fri at 18:00 via session cron; also runnable manually.
</Purpose>

<Use_When>
- Slash command `/codepresso:daily-summary` is invoked (including from the 18:00 cron)
- User says "daily summary", "end of day summary", or "wrap-up report"
- User wants to re-send today's summary manually
</Use_When>

<Do_Not_Use_When>
- Google Chat is not configured (direct user to `codepresso:setup`)
- `gws` CLI is not installed (ask user to install it first)
- User wants the morning greeting (use `codepresso:daily-chat`)
</Do_Not_Use_When>

<Steps>
1. **Run the summary script**
   Execute via Bash — it handles config load, weekday guard, data gathering, Claude summarization, and `gws` delivery:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/daily-chat-summary.mjs"
   ```

2. **Report result to user**
   - If exit code 0 and no error on stderr: confirm "Evening summary sent."
   - If the script printed nothing (weekend, no activity, disabled): explain why it skipped.
   - If `gws` is missing or fails: suggest installing `gws` or running manually.
</Steps>

<Tool_Usage>
- `Bash` for running `daily-chat-summary.mjs`
</Tool_Usage>

<Examples>
<Good>
User: "daily summary"
Action: Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/daily-chat-summary.mjs"` and report the outcome.
</Good>
<Good>
Cron: "/codepresso:daily-summary" fires at 18:03 on a Tuesday
Action: Run the script; it gathers today's activity and posts to Google Chat.
</Good>
</Examples>

<Final_Checklist>
- [ ] Script executed
- [ ] If skipped, reason reported to user
- [ ] If sent, delivery confirmed
</Final_Checklist>
