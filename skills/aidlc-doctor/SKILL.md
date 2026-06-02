---
name: aidlc-doctor
description: Diagnose-only AI-native compliance check for a target repo — detect + scan + score, no file changes. Use to re-check drift over time.
---

<Purpose>
Report how compliant a repo is against the 16-item AI-native template, without changing anything. The read-only companion to aidlc-init.
</Purpose>

<Use_When>
- `/codepresso:aidlc-doctor <target-path>` invoked
- User asks "how AI-native is this repo", "check compliance", "what's missing"
</Use_When>

<Steps>
1. Resolve `<target-path>` (default = current project).
2. Run `node ${plugin}/scripts/aidlc-cli.mjs scan <path>`.
3. Show the 16-item table (status + evidence + reason) and overall %.
4. If `secrets[]` non-empty → 🔴 surface (masked), recommend rotation. Never echo the raw value.
5. List the top missing/partial gaps, ordered by value. Suggest `/codepresso:aidlc-init <path>` to fix.
6. Do NOT write or modify any file.
</Steps>

<Tool_Usage>
- `Bash` for `aidlc-cli.mjs scan`
- (read-only — no Write)
</Tool_Usage>
