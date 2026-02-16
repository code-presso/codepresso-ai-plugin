---
name: codepresso:dashboard
description: Team analytics dashboard showing prompt quality trends, activity metrics, and session history
triggers:
  - "codepresso dashboard"
  - "codepresso:dashboard"
  - "show analytics"
  - "team analytics"
  - "prompt quality trends"
---

# Codepresso Analytics Dashboard

Display team analytics: prompt quality scores, activity volume, git operations, and session duration trends.

## Steps

1. **Read analytics data**

   Read the analytics JSONL file and aggregate it:

   ```bash
   cat ~/.codepresso/analytics/sessions.jsonl 2>/dev/null | wc -l
   ```

   If the file doesn't exist or is empty, show:
   > **No analytics data yet.** Analytics will be recorded automatically as you work. Data sources:
   > - Prompt quality scores (from PR comment batches)
   > - Git commits and pushes
   > - Session durations
   >
   > Continue working normally and check back later, or run `codepresso:status` to verify the plugin is active.

   Then stop — do not proceed to other steps.

2. **Read current session** from `.omc/state/codepresso-session.json`:
   - Branch, PR number, session ID
   - Calculate duration from session start

   Read pending batch from `.omc/state/codepresso-batch.jsonl`:
   - Count pending prompts

3. **Parse analytics records**

   Read the full JSONL file and parse each line as JSON. Filter to last 90 days (retention).

   Group records by `sessionId` to build session objects. For each session, merge:
   - `flush` records → sum `promptCount`, collect all `scores`
   - `git_commit` records → count commits
   - `git_push` records → count pushes
   - `session_end` records → extract `durationMinutes`
4. **Format Current Session section**

   ```
   ## Current Session

   | Metric | Value |
   |--------|-------|
   | Branch | `feature/auth` |
   | PR | #42 |
   | Duration | 45m |
   | Prompts | 12 (3 pending) |
   | Avg Score | 7.2/10 |
   | Commits | 4 |
   | Pushes | 1 |
   ```

   If no current session, skip this section.

5. **Format Weekly Trends section**

   Compare this week (last 7 days) vs last week (7-14 days ago):

   ```
   ## This Week vs Last Week

   | Metric | This Week | Last Week | Delta |
   |--------|-----------|-----------|-------|
   | Sessions | 12 | 8 | +50% |
   | Prompts | 156 | 120 | +30% |
   | Avg Score | 7.4 | 6.8 | +9% |
   | Commits | 23 | 18 | +28% |
   ```

   Use arrows or +/- percentages for deltas.

6. **Format Score Distribution section**

   From ALL scored prompts in the last 90 days, categorize:
   - **Excellent** (8-10): count and percentage
   - **Good** (5-7): count and percentage
   - **Warning** (3-4): count and percentage
   - **Poor** (0-2): count and percentage

   ```
   ## Score Distribution (Last 90 Days)

   | Tier | Range | Count | Percentage |
   |------|-------|-------|------------|
   | Excellent | 8-10 | 45 | 38% |
   | Good | 5-7 | 52 | 44% |
   | Warning | 3-4 | 15 | 13% |
   | Poor | 0-2 | 6 | 5% |
   | **Total** | | **118** | |
   ```

7. **Format Recent Sessions section**

   Show last 10 sessions sorted by most recent:

   ```
   ## Recent Sessions

   | Date | Branch | Duration | Prompts | Avg Score | Commits |
   |------|--------|----------|---------|-----------|---------|
   | Feb 15 | `feature/auth` | 45m | 12 | 7.2 | 4 |
   | Feb 14 | `fix/login` | 20m | 6 | 8.1 | 2 |
   | ... | | | | | | |
   ```

8. **Output the complete dashboard**

   Combine all sections with a header:

   ```
   # Codepresso Analytics Dashboard

   [Current Session section]
   [Weekly Trends section]
   [Score Distribution section]
   [Recent Sessions section]

   ---
   <sub>Data from ~/.codepresso/analytics/sessions.jsonl | Retention: 90 days</sub>
   ```

## Tool Usage

- Use `Bash` with `cat` to read the JSONL file and session state files
- Use `Read` tool for `.omc/state/codepresso-session.json` and `.omc/state/codepresso-batch.jsonl`
- Do all aggregation logic inline (parse JSON lines, group by sessionId, compute averages)
- Do NOT modify any files — this skill is read-only

## Notes

- All timestamps in records are ISO-8601
- Score tiers: excellent (>=8), good (>=5), warning (>=3), poor (<3)
- Duration is in minutes from `session_end` records
- If a session has no `session_end` record, duration shows as "\u2014"
- Records older than 90 days are filtered out on read
