---
name: log
description: Manually post a session summary to the current PR
---

<Purpose>
Gather the current session's activity (git diff stats, batched prompts) and post a
structured summary comment to the associated GitHub PR. This is the manual trigger
for what the automatic batch system does on a timer.
</Purpose>

<Use_When>
- User says "codepresso log" or "post summary to PR"
- User wants to manually flush the prompt log to the PR
- End of a work session when the user wants a summary posted
</Use_When>

<Do_Not_Use_When>
- Automatic batch logging is sufficient (prompts are batched every 60s by default)
- No PR is associated with the current branch
</Do_Not_Use_When>

<Steps>
1. **Read session state**
   - Load `.omc/state/codepresso-session.json`
   - Verify a PR number exists; if not, inform user and stop

2. **Gather activity data**
   - Read pending batch entries from `.omc/state/codepresso-batch.jsonl`
   - Run `git diff --stat` to get file change summary
   - Run `git log --oneline -10` to get recent commits on this branch

3. **Build summary comment**
   - Format a comprehensive markdown comment including:
     - Batched prompts table (if any pending)
     - Git diff stats
     - Recent commits
   - Use the standard Codepresso comment format

4. **Post to PR**
   - Use `gh pr comment <number> --body "<markdown>"`
   - Clear the batch file after successful post

5. **Confirm to user**
   - Report: "Posted session summary to PR #N"
</Steps>

<Tool_Usage>
- Use `Bash` for `git diff --stat`, `git log`, and `gh pr comment`
- Use `Read` to check `.omc/state/codepresso-session.json` and batch file
</Tool_Usage>

<Examples>
<Good>
User: "codepresso log"
Action: Gather stats, post summary, clear batch
</Good>
<Good>
User: "post a summary of what we did to the PR"
Action: Same as above
</Good>
</Examples>

<Final_Checklist>
- [ ] Session state loaded and PR detected
- [ ] Summary comment posted to PR
- [ ] Batch file cleared
- [ ] User informed of success
</Final_Checklist>
