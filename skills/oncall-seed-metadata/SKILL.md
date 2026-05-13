---
name: oncall-seed-metadata
description: Seed engineer metadata (GitHub usernames) into DynamoDB for deploy gate verification
---

<Purpose>
Write `ENGINEER#`-prefixed metadata items into the oncall DynamoDB table so the production deploy gate can map an engineer's display name → GitHub username and verify the workflow trigger.
</Purpose>

<Use_When>
- Slash command `/codepresso:oncall-seed-metadata` is invoked
- A new engineer joined the rotation and their GitHub username isn't in DDB yet
- Deploy gate is failing with "engineer not found" / metadata-missing errors
- First-time setup of the deploy gate
</Use_When>

<Do_Not_Use_When>
- Removing an engineer from rotation (use direct `aws dynamodb delete-item`)
- Updating actual on-call schedule (use `codepresso:oncall-generate` or `oncall-swap`)
</Do_Not_Use_When>

## Constants
- DynamoDB table: `oncall-assignments-history`
- AWS Region: `ap-northeast-2`

## Engineer Mapping

The following engineer metadata should be seeded. Each engineer gets a DynamoDB item with `AssignmentDate` prefixed by `ENGINEER#`:

| Engineer Name  | GitHub Username             | Email                      |
|----------------|-----------------------------|----------------------------|
| <engineer>         | <github-username>                | <email> |
| <engineer>         | <github-username>    | <email>        |
| <engineer>         | <github-username>         | <email>    |
| <engineer>         | <github-username>        | <email>    |
| <engineer>         | <github-username>          | <email>        |
| <engineer>         | <github-username>       | <email>        |
| <engineer>         | <github-username>      | <email>        |

> **Note**: If there are additional engineers in the rotation, ask the user for their GitHub usernames and emails before seeding.

<Steps>
1. First, check if metadata already exists:
   ```
   aws dynamodb scan --table-name oncall-assignments-history --region ap-northeast-2 \
     --filter-expression "begins_with(AssignmentDate, :prefix)" \
     --expression-attribute-values '{":prefix":{"S":"ENGINEER#"}}' \
     --output json
   ```

2. If metadata exists, show the current state and ask the user if they want to update:
   ```
   📋 Current Engineer Metadata:
   | Name   | GitHub Username | Email   |
   |--------|-----------------|---------|
   | ...    | ...             | ...     |
   ```

3. Ask the user to confirm or update the mapping before seeding. If any entries are missing (marked as TBD), **stop and ask** for the missing values.

4. For each engineer, write a DynamoDB item:
   ```
   aws dynamodb put-item --table-name oncall-assignments-history --region ap-northeast-2 \
     --item '{
       "AssignmentDate": {"S": "ENGINEER#<engineer>"},
       "Engineer": {"S": "<engineer>"},
       "Role": {"S": "Meta"},
       "GitHubUsername": {"S": "<github-username>"},
       "Email": {"S": "<email>"}
     }'
   ```

   Repeat for each engineer with their respective values.

5. Verify the seeding:
   ```
   aws dynamodb scan --table-name oncall-assignments-history --region ap-northeast-2 \
     --filter-expression "begins_with(AssignmentDate, :prefix)" \
     --expression-attribute-values '{":prefix":{"S":"ENGINEER#"}}' \
     --output table
   ```

6. Show confirmation:
   ```
   ✅ Engineer metadata seeded successfully!

| Name   | GitHub Username             | Email                      |
|--------|-----------------------------|----------------------------|
| <engineer> | <github-username>                | <email> |
| <engineer> | <github-username>    | <email>        |
| <engineer> | <github-username>         | <email>    |
| <engineer> | <github-username>        | <email>    |
| <engineer> | <github-username>          | <email>        |
| <engineer> | <github-username>       | <email>        |
| <engineer> | <github-username>      | <email>        |

   The deploy gate will now use these mappings to verify on-call engineers.
   ```

## Important

- Items with `AssignmentDate` prefixed by `ENGINEER#` are metadata items, NOT schedule assignments.
- The oncall allocator Lambda will NOT touch these items (they use date-based prefixes like `2026-04-07`).
- When new engineers join the rotation, re-run this command to add their metadata.
- When engineers leave, use `aws dynamodb delete-item` to remove their metadata entry.
</Steps>

<Tool_Usage>
- `Bash` for `aws dynamodb scan` and `aws dynamodb put-item`
- `AskUserQuestion` to confirm/update mapping and to fill in missing entries
</Tool_Usage>
