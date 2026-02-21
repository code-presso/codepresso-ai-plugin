---
name: log
description: Manually flush batched prompts with scoring to the current PR
---

<Purpose>
Force-flush the pending prompt batch through the scoring pipeline and post a
scored summary comment to the associated GitHub PR. This triggers the same
pipeline as the automatic batch system (score-and-post.mjs) but on demand.
</Purpose>

<Use_When>
- User says "codepresso log" or "post summary to PR"
- User wants to manually flush the prompt log with scores to the PR
- End of a work session when the user wants a scored summary posted
</Use_When>

<Do_Not_Use_When>
- Automatic batch logging is sufficient (prompts are batched every 60s by default)
- No PR is associated with the current branch
</Do_Not_Use_When>

<Steps>
1. **Read session state**
   - Load `.omc/state/codepresso-session.json`
   - Verify a PR number exists; if not, inform user and stop
   - Note the `gitRoot` value (used as cwd for gh commands)

2. **Check for pending prompts**
   - Read `.omc/state/codepresso-batch.jsonl`
   - If empty, inform user "No pending prompts to flush" and stop

3. **Build scoring payload and trigger score-and-post pipeline**
   - Create a temporary JSON payload file at `.omc/state/codepresso-flush-manual.json`:
     ```json
     {
       "entries": [<parsed JSONL entries>],
       "meta": {
         "branch": "<session.branch>",
         "sessionId": "<session.sessionId>",
         "cwd": "<session.gitRoot or cwd>"
       },
       "prNumber": <session.prNumber>,
       "scoringEnabled": true,
       "scoringModel": null
     }
     ```
   - Run the scoring pipeline:
     ```bash
     node <plugin-path>/scripts/score-and-post.mjs .omc/state/codepresso-flush-manual.json
     ```
     Where `<plugin-path>` is the directory containing the plugin scripts.
     Use the session's `gitRoot` as `cwd` if available.

4. **Clear the batch**
   - Delete `.omc/state/codepresso-batch.jsonl`
   - Delete `.omc/state/codepresso-batch-timer.json` if it exists

5. **Confirm to user**
   - Report: "Flushed N prompts with scoring to PR #X"
</Steps>

<Tool_Usage>
- Use `Read` to load `.omc/state/codepresso-session.json` and `.omc/state/codepresso-batch.jsonl`
- Use `Bash` to run `node scripts/score-and-post.mjs` and clean up batch files
</Tool_Usage>

<Examples>
<Good>
User: "codepresso log"
Action: Read session + batch, create payload, run score-and-post.mjs, clear batch
</Good>
<Good>
User: "post a summary of what we did to the PR"
Action: Same as above — flush with scoring
</Good>
</Examples>

<Final_Checklist>
- [ ] Session state loaded and PR detected
- [ ] Scoring payload created from batch entries
- [ ] score-and-post.mjs executed (scores prompts + posts to PR)
- [ ] Batch file cleared
- [ ] User informed of success
</Final_Checklist>
