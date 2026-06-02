---
name: aidlc-init
description: Scaffold an AI-native AIDLC repo structure into a target path — analyze, interview, preview, apply (missing only), re-score. Non-destructive.
---

<Purpose>
Bring any repo up to the team's 16-item "AI-native repo" template. Diagnose what's present, ask only what can't be inferred, preview what will be created, then create only the MISSING pieces (never overwrite). Finish by re-scoring.
</Purpose>

<Use_When>
- `/codepresso:aidlc-init <target-path>` invoked
- User says "set up AIDLC structure", "make this repo AI-native", "scaffold AGENTS.md/ADR/policy"
</Use_When>

<Steps>
1. Resolve `<target-path>` (default = current project). Confirm it's a git repo; if not, warn and ask whether to continue.

2. **Analyze (CLI):** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/aidlc-cli.mjs" detect <path>` then `... scan <path>`.
   Show the user a compact 16-item table (status + evidence) and the overall %. If `secrets[]` is non-empty, surface a 🔴 warning at the top and tell the user to rotate them — do NOT copy any secret value anywhere.

3. **Interview (AskUserQuestion, only the non-inferable):**
   - Confirm detected structure/stacks/submodules; let the user correct.
   - Tool targets (multi): AGENTS.md + CLAUDE.md always; optional `.cursor/rules`, `.amazonq/rules`, `.github/copilot-instructions.md`, `.clinerules`.
   - Integrations on/off (Notion/Figma/Google/AWS): default ALL OFF.
   - Ticket convention: confirm prefix (e.g. `TSK-`) or "none".

4. **Preview (CLI):** run `... plan <path>`. Show the file tree to be created, marking each as static vs authored. Also list any MISSING scorecard item that does NOT appear in the `plan` output and is not in the authored list above (e.g. `hooks`, `unit-tests`, `runbook`) as **'manual setup required — not auto-created'**, so the user knows these gaps remain after apply. Ask for explicit confirmation. Do NOT write anything before confirmation.

5. **Apply:**
   a. Static: run `... apply-static <path>` (copies canonical templates, non-destructive).
   b. Authored: YOU write these files using the detect/scan output, ONLY if scan marked them missing, and ONLY via non-destructive create (check existence first):
      - `AGENTS.md` — the single authoritative entry point: build/test/run commands (use the detected stack's real commands), conventions, a short architecture overview. This holds the real content.
      - `CLAUDE.md` — a thin pointer: "See AGENTS.md for this repo's agent guidance." No duplicated content.
      - Selected tool-target files (`.cursor/rules` etc.) — thin pointers to AGENTS.md in each tool's format.
      - If `structure=mono`: for each submodule, author `<submodule>/CLAUDE.md` with that submodule's stack-specific guidance (this is the submodule's authoritative file).
      - `.codesight/CODESIGHT.md` — a structural summary (key dirs, entry points, how to run). For very large monorepos, summarize and **log what you omitted** (never silently truncate).

6. **Re-score (CLI):** run `... score <path>` and report the new % + remaining gaps. Explicitly restate any still-missing items that require manual setup.

7. End with a navigation hint: `💡 /codepresso:aidlc-doctor <path> — re-check compliance anytime`.
</Steps>

<Tool_Usage>
- `Bash` for the `aidlc-cli.mjs` subcommands
- `AskUserQuestion` for the interview + preview confirmation
- `Read`/`Write` for authored files (Write only after existence check — non-destructive)
</Tool_Usage>
