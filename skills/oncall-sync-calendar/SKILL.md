---
name: oncall-sync-calendar
description: Sync on-call assignments from DynamoDB to Google Calendar events
---

<Purpose>
Reconcile the shared Google Calendar against DynamoDB — the source of truth. Used to recover from out-of-band edits, missed sync from a previous generate run, or after stale calendar events were detected.
</Purpose>

<Use_When>
- Slash command `/codepresso:oncall-sync-calendar` is invoked
- User says "sync oncall calendar", "캘린더 다시 동기화"
- Calendar events are missing or out-of-date compared to DynamoDB
- After known calendar-sync failures (e.g. service account token issues)
</Use_When>

<Do_Not_Use_When>
- Generating a brand new schedule (use `codepresso:oncall-generate` — it already syncs)
- Swapping a single week (use `codepresso:oncall-swap` — it updates calendar inline)
</Do_Not_Use_When>

## Constants
- DynamoDB table: `oncall-assignments-history`
- AWS Region: `ap-northeast-2`
- Google Calendar ID: `c_b96d007ccd3a348ceab92e4d7cab4be4ae911977da9f383a7a7bb0e4bd74f12f1@group.calendar.google.com`

<Steps>
1. Ask the user which month(s) to sync (default: current + next month).

2. Query DynamoDB for all assignments in the target month(s):
   ```
   aws dynamodb scan --table-name oncall-assignments-history --region ap-northeast-2 \
     --filter-expression "begins_with(AssignmentDate, :prefix)" \
     --expression-attribute-values '{":prefix":{"S":"YYYY-MM"}}' \
     --output json
   ```

3. Parse and group by week (pair primary + secondary by matching date prefix).

4. Check existing Google Calendar events for the target period using `gcal_list_events`:
   - calendarId: the Google Calendar ID above
   - timeMin/timeMax: target month range
   - q: "온콜"
   - timeZone: Asia/Seoul

5. For each week:
   - If a matching calendar event already exists with correct info → skip
   - If event exists but info is wrong → delete with `gcal_delete_event` and recreate
   - If no event exists → create new event with `gcal_create_event`:
     - summary: `온콜: {primary} (주) / {secondary} (부)`
     - description: include both engineers and their roles
     - start: `{ "date": "YYYY-MM-DD" }` (Monday, all-day)
     - end: `{ "date": "YYYY-MM-DD" }` (following Monday, for all-day range Mon~Sun)
     - colorId: "11" (Tomato)
     - timeZone: Asia/Seoul

6. Report results:
   ```
   📅 Calendar Sync Complete (YYYY년 MM월)
   - Created: N events
   - Updated: N events
   - Skipped (already synced): N events
   ```
</Steps>

<Tool_Usage>
- `Bash` for `aws dynamodb scan`
- `gcal_list_events`, `gcal_create_event`, `gcal_delete_event` for calendar
- `AskUserQuestion` for month selection
</Tool_Usage>
