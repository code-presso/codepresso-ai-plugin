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

Each engineer gets a DynamoDB item with `AssignmentDate` prefixed by `ENGINEER#`. The actual mapping (display name → GitHub username → email) is **not hardcoded here**. Instead:

1. Ask the user (via `AskUserQuestion`) for the rotation roster, OR
2. Read it from a local untracked config file (e.g., `.codepresso/oncall-roster.json`), OR
3. Look it up from the team's existing source of truth (HR system, GitHub team API, etc.)

The roster shape this skill expects:

```json
[
  { "name": "<engineer display name>", "github": "<github-username>", "email": "<email>" }
]
```

> **Note**: Do not commit the roster to this repository. Engineer names + emails are personal data; keep them in untracked files or pull them from authoritative sources at runtime.

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

4. For each engineer in the roster, write a DynamoDB item (template):
   ```
   aws dynamodb put-item --table-name oncall-assignments-history --region ap-northeast-2 \
     --item '{
       "AssignmentDate": {"S": "ENGINEER#<NAME>"},
       "Engineer": {"S": "<NAME>"},
       "Role": {"S": "Meta"},
       "GitHubUsername": {"S": "<github-username>"},
       "Email": {"S": "<email>"}
     }'
   ```

   Substitute `<NAME>`, `<github-username>`, and `<email>` with each engineer's values from the roster. Repeat for every engineer in the rotation.

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

   <render the seeded rows here, e.g.>
   | Name   | GitHub Username | Email |
   |--------|-----------------|-------|
   | …      | …               | …     |

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
