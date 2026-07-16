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

<Warning>
EventBridge rule `oncall-monthly-schedule` (cron: 1st of every month, 09:00 UTC) automatically
invokes this same Lambda for the month that just started. The Lambda has no idempotency guard —
it regenerates from scratch and overwrites DynamoDB + Calendar. **Do NOT manually generate a
month before its 1st day**: the cron will clobber your plan with a different one (this caused
the July 2026 DDB/calendar divergence). Manual runs are only for recovery AFTER the cron ran.
</Warning>

<Do_Not_Use_When>
- Only swapping a few weeks (use `codepresso:oncall-swap`)
- Only re-syncing existing DDB data to Calendar (use `codepresso:oncall-sync-calendar`)
</Do_Not_Use_When>

## Constants
- Lambda function: `oncall-allocator-stack-OnCallAllocatorFunction-pQRyUZlV0CCh`
- AWS Region: `ap-northeast-2`
- DynamoDB table: `oncall-assignments-history`
- Google Calendar ID: `c_b96d007ccd3a348ceab92e4d7cab4be4ae91197da9f383a7a7bb0e4bd74f12f1@group.calendar.google.com`
- Content team (컨텐츠, 1 per week via `CONTENT_ENGINEERS` env): 이상윤, 양지현, 문혜원, 이선영
- Dry run: pass `{"time":"...","dry_run":true}` in the Lambda payload to preview a plan without touching DDB/Calendar/Chat

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

5. After Lambda completes, VERIFY (do not create) the Google Calendar events:
   - The Lambda itself syncs the calendar via its service account — do NOT create events here,
     or the calendar and DynamoDB can diverge on the next automated run.
   - Use `gcal_list_events` (calendarId above, q: "온콜", target month range) and confirm each
     week's event matches the Lambda's returned plan.
   - Only if events are missing or wrong (Lambda sync failure — check CloudWatch logs for
     `Failed to initialize Google Calendar service`), fall back to `codepresso:oncall-sync-calendar`.

6. Send confirmation to the user with the full schedule table.
</Steps>

<Tool_Usage>
- `Bash` for AWS CLI (`aws dynamodb scan`, `aws lambda invoke`)
- `gcal_list_events`, `gcal_create_event`, `gcal_delete_event` for calendar
- `AskUserQuestion` for month selection / overwrite confirmation
</Tool_Usage>
