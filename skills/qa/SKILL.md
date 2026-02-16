---
name: codepresso:qa
description: Run a QA evaluation on code changes in the current session
triggers:
  - "codepresso qa"
  - "codepresso:qa"
  - "run qa"
  - "quality check"
  - "code quality"
---

# Codepresso QA Check

Evaluate code changes from the current session across 5 quality dimensions: quality, security, testing, documentation, and performance.

## Steps

1. **Read session state**

   Read `.omc/state/codepresso-session.json` to get:
   - `headCommit` — the commit hash at session start
   - `sessionId`, `branch`, `prNumber`

   If no session file or no `headCommit`, show:
   > **No session data available.** QA evaluation requires an active Codepresso session with a recorded start commit.
   > Restart Claude Code to begin a new session.

   Then stop.

2. **Get the diff**

   Run:
   ```bash
   git diff --stat <headCommit>..HEAD
   ```

   If no changes (empty output), show:
   > **No code changes detected** since session start (commit `<headCommit>`). Nothing to evaluate.

   Then stop.

   Also run to get the full diff:
   ```bash
   git diff <headCommit>..HEAD
   ```

   If the diff exceeds 50KB, truncate it and note this in the output.

3. **Evaluate the diff**

   Analyze the diff across all 5 dimensions. For each dimension, assign a score (0-10) and list specific findings:

   | Dimension | What to Check |
   |-----------|---------------|
   | **Quality** | Readability, naming conventions, code structure, error handling, code smells |
   | **Security** | Injection vulnerabilities, auth issues, exposed secrets, input validation, dependency risks |
   | **Testing** | Untested logic paths, missing edge cases, assertion quality, coverage gaps |
   | **Documentation** | Missing JSDoc/comments, README updates needed, undocumented APIs |
   | **Performance** | N+1 queries, memory leaks, blocking operations, unnecessary allocations |

   Scoring guide:
   - **0-2**: Critical issues that must be fixed
   - **3-4**: Significant concerns
   - **5-6**: Acceptable but could improve
   - **7-8**: Good quality
   - **9-10**: Excellent, no issues found

4. **Format and display the report**

   ```
   ## Codepresso QA Report

   **Session:** `<sessionId>` | **Branch:** `<branch>` | **Overall:** 7.2/10
   **Changes:** 5 files, +120/-30 lines

   | Dimension | Score | Key Findings |
   |-----------|-------|--------------|
   | Quality | 8/10 | Good error handling; consider extracting helper |
   | Security | 7/10 | Input validated correctly |
   | Testing | 5/10 | New handler lacks unit tests |
   | Documentation | 6/10 | Missing JSDoc on exported function |
   | Performance | 8/10 | No blocking operations detected |

   ### Recommendations
   - [ ] Add unit tests for the new request handler
   - [ ] Add JSDoc to `processQaReport()` export
   ```

5. **Offer to post to PR**

   If a PR is detected (`prNumber` exists in session state), ask:
   > Would you like me to post this QA report as a PR comment on PR #X?

   If yes, run:
   ```bash
   gh pr comment <prNumber> --body "<formatted report>"
   ```

## Tool Usage

- Use `Read` tool for `.omc/state/codepresso-session.json`
- Use `Bash` with `git diff` to get the changes
- Do the evaluation inline (you are the LLM evaluator — no API call needed)
- Use `Bash` with `gh pr comment` only if user approves posting
- Do NOT modify any source files — this skill is read-only (except for the optional PR comment)

## Notes

- This is the manual trigger companion to the automatic QA that runs at session end
- The manual version uses you (the LLM) directly for evaluation instead of the Anthropic API
- Scores should be consistent with the automated evaluator's criteria
- If the diff is very large, focus on the most impactful changes
