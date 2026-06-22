---
name: oncall-swap
description: Swap on-call assignments between engineers for a specific week
---

<Purpose>
Modify the rotation when an engineer needs coverage: full week swap, single-engineer replacement, or primary↔secondary role swap. Keeps DynamoDB and Google Calendar in sync, and can announce the change in Google Chat.
</Purpose>

<Use_When>
- Slash command `/codepresso:oncall-swap` is invoked
- User says "swap oncall", "온콜 바꿔줘", "X가 휴가라 Y로 바꿔야 해"
- An engineer is unavailable for their assigned week
</Use_When>

<Do_Not_Use_When>
- Generating a fresh month from scratch (use `codepresso:oncall-generate`)
- Re-syncing existing assignments to Calendar (use `codepresso:oncall-sync-calendar`)
</Do_Not_Use_When>

## Constants
- DynamoDB table: `oncall-assignments-history`
- AWS Region: `ap-northeast-2`
- Google Calendar ID: `c_b96d007ccd3a348ceab92e4d7cab4be4ae91197da9f383a7a7bb0e4bd74f12f1@group.calendar.google.com`
- Engineers: <engineer>, <engineer>, <engineer>, <engineer>

<Steps>
1. First, show the current schedule by running the oncall query (same as `codepresso:oncall`).

2. Ask the user:
   - Which week to modify (show numbered options)
   - What kind of swap:
     a. **Full swap**: swap two engineers' weeks entirely
     b. **Replace**: replace one engineer with another for a specific week
     c. **Role swap**: swap primary/secondary within the same week

3. Validate the swap:
   - Ensure no engineer is assigned as both primary and secondary for the same week
   - Warn if someone would be on-call for consecutive weeks

4. Update DynamoDB:
   - Delete the old assignments for the affected week(s):
     ```
     aws dynamodb delete-item --table-name oncall-assignments-history --region ap-northeast-2 \
       --key '{"AssignmentDate":{"S":"YYYY-MM-DDT00:00:00-primary"}}'
     ```
   - Put the new assignments:
     ```
     aws dynamodb put-item --table-name oncall-assignments-history --region ap-northeast-2 \
       --item '{"AssignmentDate":{"S":"YYYY-MM-DDT00:00:00-primary"},"Engineer":{"S":"NAME"},"Role":{"S":"Primary"}}'
     ```

5. Update Google Calendar:
   - Find the existing oncall event for that week using `gcal_list_events` with search query "온콜"
   - Update or delete+recreate the event with new assignment using `gcal_delete_event` + `gcal_create_event`:
     - summary: `온콜: {new_primary} (주) / {new_secondary} (부)`

6. Optionally notify via Google Chat webhook (ask user):
   ```
   curl -X POST -H 'Content-Type: application/json; charset=UTF-8' \
     -d '{"text":"온콜 변경 안내: MM.DD ~ MM.DD 주 담당자가 A에서 B로 변경되었습니다."}' \
     'https://chat.googleapis.com/v1/spaces/<SPACE_ID>/messages?key=<GOOGLE_API_KEY>&token=<CHAT_WEBHOOK_TOKEN>'
   ```

7. Show the updated schedule.
</Steps>

<Tool_Usage>
- `Bash` for AWS CLI and (optional) Google Chat curl
- `gcal_list_events`, `gcal_create_event`, `gcal_delete_event` for calendar
- `AskUserQuestion` for week selection, swap type, and chat notification confirmation
</Tool_Usage>
