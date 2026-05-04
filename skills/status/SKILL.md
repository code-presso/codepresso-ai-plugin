---
name: codepresso:status
description: Show Codepresso plugin status and diagnostics
triggers:
  - "codepresso status"
  - "codepresso:status"
  - "plugin status"
---

# Codepresso Status

Show the current state of the Codepresso plugin for this session.

## Steps

1. **Read session state** from `.codepresso/state/codepresso-session.json`:
   - Show current branch
   - Show detected PR number and URL (or "No PR detected")
   - Show session ID (first 8 chars)
   - Show session start time

2. **Read batch queue** from `.codepresso/state/codepresso-batch.jsonl`:
   - Count pending prompts (line count)
   - Show oldest entry timestamp if any exist

3. **Read batch timer** from `.codepresso/state/codepresso-batch-timer.json`:
   - Show when the current batch window started
   - Calculate time until next auto-flush

4. **Read config** from `~/.codepresso/config.json` and `.codepresso.json`:
   - Show PR logging: enabled/disabled
   - Show git tracking: enabled/disabled
   - Show scoring: enabled/disabled + model name
   - Show batch interval and max size
   - Show Notion: configured/not configured
   - Show deploy: enabled/disabled + method
   - Show debug: enabled/disabled

5. **Format output** as a clear status table:

```
## Codepresso Status

| Setting | Value |
|---------|-------|
| Branch | `feature/auth` |
| PR | #42 (https://github.com/...) |
| Session | `abc12345` (started 10m ago) |
| Batch Queue | 3 prompts pending |
| Next Flush | ~45s |
| PR Logging | Enabled |
| Git Tracking | Enabled |
| Scoring | Enabled (claude-haiku-4-5-20251001) |
| Notion | Configured (DB: abc123...) |
| Deploy | Disabled |
| Debug | Disabled |
```

Use Bash tool to read the state files and config. Do NOT modify any files.
