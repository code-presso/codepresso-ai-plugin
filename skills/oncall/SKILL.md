---
name: oncall
description: Query the current on-call schedule from DynamoDB and Google Calendar
---

<Purpose>
Show the current on-call schedule — pulled from DynamoDB (source of truth) with optional Google Calendar cross-check. Highlights the current week prominently for quick "who's on call?" lookups.
</Purpose>

<Use_When>
- Slash command `/codepresso:oncall` is invoked
- User asks "who's on call?", "이번주 온콜 누구?", "show oncall schedule"
- User wants to verify current week's primary/secondary assignment
</Use_When>

<Do_Not_Use_When>
- User wants to generate next month's schedule (use `codepresso:oncall-generate`)
- User wants to swap assignments (use `codepresso:oncall-swap`)
- User wants to sync DDB → Calendar (use `codepresso:oncall-sync-calendar`)
</Do_Not_Use_When>

## Constants
- DynamoDB table: `oncall-assignments-history`
- AWS Region: `ap-northeast-2`
- Google Calendar ID: `c_b96d007ccd3a348ceab92e4d7cab4be4ae911977da9f383a7a7bb0e4bd74f12f1@group.calendar.google.com`
- Engineers: <engineer>, <engineer>, <engineer>, <engineer>

<Steps>
1. Determine today's date and the current week's Monday (start of week).

2. Query DynamoDB for current month's assignments:
   ```
   aws dynamodb scan --table-name oncall-assignments-history --region ap-northeast-2 \
     --filter-expression "begins_with(AssignmentDate, :prefix)" \
     --expression-attribute-values '{":prefix":{"S":"YYYY-MM"}}' \
     --output json
   ```
   Replace `YYYY-MM` with the current year-month.

3. Parse the results and build a weekly schedule table:
   - Group by week (strip `-primary` / `-secondary` suffix from AssignmentDate)
   - Show Primary and Secondary engineer for each week
   - **Highlight the current week** based on today's date

4. Also try to read upcoming events from Google Calendar using `gcal_list_events` with:
   - calendarId: the Google Calendar ID above
   - timeMin: start of current week
   - timeMax: end of next month
   - timeZone: Asia/Seoul

5. Present the results in a clear table format:
   ```
   📋 On-Call Schedule (YYYY년 MM월)

   | Week                  | Primary  | Secondary |
   |-----------------------|----------|-----------|
   | 03.02 ~ 03.08         | <engineer>   | <engineer>    |
   | 03.09 ~ 03.15         | <engineer>   | <engineer>    |
   | 03.16 ~ 03.22  👈 NOW | <engineer>   | <engineer>    |
   | 03.23 ~ 03.29         | <engineer>   | <engineer>    |
   | 03.30 ~ 04.05         | <engineer>   | <engineer>    |
   ```

6. If the user asks "who's on call?" or "이번주 온콜 누구?", just show the current week's assignment prominently:
   ```
   🔔 This Week's On-Call (03.16 ~ 03.22)
   - Primary: <engineer>
   - Secondary: <engineer>
   ```

7. If Google Calendar data is available, cross-check with DynamoDB and note any discrepancies.
</Steps>

<Tool_Usage>
- `Bash` for `aws dynamodb scan`
- `gcal_list_events` (Google Calendar MCP) for calendar cross-check
</Tool_Usage>
