---
name: aidlc-doctor
description: Diagnose-only AI-native compliance check for a target repo — detect + scan + score against the 18-item template, no file changes. Use to re-check drift over time.
---

<Purpose>
Report how compliant a repo is against the 18-item AI-native template, without changing anything. The read-only companion to aidlc-init.
</Purpose>

<Use_When>
- `/codepresso:aidlc-doctor <target-path>` invoked
- User asks "how AI-native is this repo", "check compliance", "what's missing"
</Use_When>

<Steps>
1. Resolve `<target-path>` (default = current project).
2. If `.codepresso/state/aidlc-profile.json` exists, pass it: `node "${CLAUDE_PLUGIN_ROOT}/scripts/aidlc-cli.mjs" scan <path> --profile <profile>` (honest na-scoping for the team's tools/host). Otherwise run `... scan <path>` (baseline — everything scored).
3. Show the 18-item table (status + evidence + reason) and the overall %.
4. If `secrets[]` is non-empty → 🔴 surface (masked), recommend rotation. Never echo the raw value.
5. List the top missing/partial gaps, ordered by value. Because scoring is **functional**, explicitly explain items that look present but score lower:
   - `pre-push` partial → script exists but not wired to a git hook.
   - `codesight` partial → index exists but is stale and has no regen hook.
   - `ci-pr` partial → a workflow exists but doesn't match the detected host or has no PR/MR trigger.
   Mark gaps the scaffolder cannot auto-create (`hooks`, `unit-tests`, `runbook`) as **manual setup**. Suggest `/codepresso:aidlc-init <path>` to fix.
6. Do NOT write or modify any file.
</Steps>

<Tool_Usage>
- `Bash` for `aidlc-cli.mjs scan` (with `--profile` when a profile exists)
- (read-only — no Write)
</Tool_Usage>
