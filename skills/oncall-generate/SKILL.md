---
name: oncall-generate
description: Generate next month's on-call schedule by invoking the oncall allocator Lambda
---

<Purpose>
Trigger the on-call allocator Lambda to produce a fresh monthly rotation (Primary + Secondary per week), persist it to DynamoDB, then sync the result to the shared Google Calendar.
</Purpose>

<Use_When>
- Slash command `/codepresso:oncall-generate` is invoked
- User says "generate next month's oncall", "다음달 온콜 만들어줘"
- Start of month and the next month's rotation hasn't been allocated yet
</Use_When>

<Do_Not_Use_When>
- Only swapping a few weeks (use `codepresso:oncall-swap`)
- Only re-syncing existing DDB data to Calendar (use `codepresso:oncall-sync-calendar`)
</Do_Not_Use_When>

## Constants
- Lambda function: `oncall-allocator-stack-OnCallAllocatorFunction-pQRyUZlV0CCh`
- AWS Region: `ap-northeast-2`
- DynamoDB table: `oncall-assignments-history`
- Google Calendar ID: `c_b96d007ccd3a348ceab92e4d7cab4be4ae911977da9f383a7a7bb0e4bd74f12f1@group.calendar.google.com`

<Steps>
1. Ask the user which month to generate (default: next month).

2. Check DynamoDB if assignments already exist for that month:
   ```
   aws dynamodb scan --table-name oncall-assignments-history --region ap-northeast-2 \
     --filter-expression "begins_with(AssignmentDate, :prefix)" \
     --expression-attribute-values '{":prefix":{"S":"YYYY-MM"}}' \
     --select COUNT --output json
   ```
   If assignments exist, warn the user and ask for confirmation to overwrite.

3. Invoke the Lambda with the target month's first day:
   ```
   aws lambda invoke --function-name oncall-allocator-stack-OnCallAllocatorFunction-pQRyUZlV0CCh \
     --region ap-northeast-2 \
     --payload '{"time":"YYYY-MM-01T09:00:00Z"}' \
     --cli-binary-format raw-in-base64-out \
     /tmp/oncall-result.json && cat /tmp/oncall-result.json
   ```

4. Show the generated plan from the Lambda response.

5. After Lambda completes, sync to Google Calendar:
   - For each week in the plan, create an all-day event (Monday to Sunday) on the shared calendar using `gcal_create_event`:
     - summary: `온콜: {primary} (주) / {secondary} (부)`
     - description: `주 담당자: {primary}\n부 담당자: {secondary}`
     - calendarId: the Google Calendar ID above
     - start/end: use `date` format (all-day event) for Monday to Sunday
     - colorId: "11" (Tomato) for primary visibility
   - Before creating, check if events already exist for those dates and delete them first using `gcal_list_events` + `gcal_delete_event`.

6. Send confirmation to the user with the full schedule table.
</Steps>

<Tool_Usage>
- `Bash` for AWS CLI (`aws dynamodb scan`, `aws lambda invoke`)
- `gcal_list_events`, `gcal_create_event`, `gcal_delete_event` for calendar
- `AskUserQuestion` for month selection / overwrite confirmation
</Tool_Usage>
