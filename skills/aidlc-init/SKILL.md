---
name: aidlc-init
description: Scaffold an AI-native AIDLC repo structure into a target path — analyze, interview (situational branching), preview, apply (missing only), re-score. Non-destructive, minimal external dependencies.
---

<Purpose>
Bring any repo up to the team's 18-item "AI-native repo" template. Diagnose what's present, ask only what can't be inferred, and for each branch pick the LOWEST-dependency option that fits — raising a dependency is always an explicit opt-in. Create only the MISSING pieces (never overwrite). Finish by re-scoring with the chosen profile.
</Purpose>

<Use_When>
- `/codepresso:aidlc-init <target-path>` invoked
- User says "set up AIDLC structure", "make this repo AI-native", "scaffold AGENTS.md/ADR/policy"
</Use_When>

<Principles>
- **Minimal external dependencies.** Default every branch to the zero/low-dependency option (raw git hook over husky, bundled node context index over an external tool, skip CI when there's no host). Only add a dependency when the user opts in, and state the tradeoff when you ask.
- **Situational, not universal.** The 18 items are tool/host-specific. Unused tools and absent hosts are scored `na`, never penalised.
- **Non-destructive.** Only ever create missing files; never overwrite.
</Principles>

<Steps>
1. Resolve `<target-path>` (default = current project). Confirm it's a git repo; if not, warn and ask whether to continue.

2. **Analyze (CLI):** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/aidlc-cli.mjs" detect <path>` then `... scan <path>`.
   Show a compact 18-item table (status + evidence) and the overall %. If `secrets[]` is non-empty, surface a 🔴 warning at the top and tell the user to rotate them — never copy a secret value anywhere.

3. **Interview (AskUserQuestion — 7 branches; only the non-inferable).** Build a profile from the answers. Pre-fill each branch from `detect`:
   - **Structure/stacks/submodules** — confirm detected values; let the user correct.
   - **Agent tools** (multi-select, prechecked from `detect.tools`): which tools the team actually uses (claude, cursor, opencode, cline, copilot, gemini, amazonq). Only selected tools are scaffolded/scored; the rest become `na`.
   - **CI host** — default to `detect.host`. If host is `none`, ask "create GitHub Actions anyway, or skip?" (default skip → `ci-pr` na).
   - **pre-push install** — default `raw` (a `.git/hooks/pre-push` wired by hand, zero deps). Offer `husky`/`lefthook` only if `detect.hookFramework` indicates it or the user asks. `skip` → na.
   - **Context index** — default `regen-node` (bundled zero-dep scanner, stays fresh). Opt-in: `external` tool (richer, adds a dependency) or `static` (one-time, will go stale) or `off`.
   - **Local dev** — if `detect.localDev` shows a one-command bring-up, set `localDev: 'detected'` and inject that command into AGENTS.md. Otherwise offer `localDev: 'scaffold'` (apply-static writes an executable `scripts/local-up.sh`) or `localDev: 'skip'`.
   - **Integrations** (Notion/Figma/Google/AWS): default ALL OFF; opt-in per integration.
   - **Ticket convention**: confirm prefix (e.g. `TSK`) or "none".

   Write the answers to `.codepresso/state/aidlc-profile.json`:
   `{ tools[], ciHost, prePush, contextMode, localDev, integrations[], ticketPrefix }`.

4. **Preview (CLI, profile-aware):** run `... scan <path> --profile .codepresso/state/aidlc-profile.json` (honest na-scoped score) then `... plan <path> --profile <profile>`. Show the file tree to be created, marking each static (templated) vs authored (skill-written). List any still-MISSING item NOT in the plan and not authored below (e.g. `hooks`, `unit-tests`, `runbook`) as **'manual setup required — not auto-created'**. Ask for explicit confirmation. Write nothing before confirmation.

5. **Apply:**
   a. **Static:** `... apply-static <path> --profile <profile>` (templated, non-destructive; host-correct CI variant picked from `ciHost`).
   b. **Wire, don't just create:**
      - `pre-push`: after the script exists, actually WIRE it — `raw`: copy/symlink to `.git/hooks/pre-push` + `chmod +x`; `husky`/`lefthook`: add the pre-push entry. A created-but-unwired script only scores `partial`.
      - `contextMode=regen-node`: merge the SessionStart hook from `templates/aidlc/.claude/settings.codesight-hook.json` into the repo's `.claude/settings.json`, then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/codesight-scan.mjs" <path>` once to seed `.codesight/CODESIGHT.md`.
   c. **Authored** (you write, only if scan marked missing, existence-checked first):
      - `AGENTS.md` — the single authoritative entry point: real build/test/run commands (from the detected stack + the local-dev branch), conventions, short architecture overview.
      - `CLAUDE.md` — thin pointer to AGENTS.md (no duplicated content).
      - Pointer files for each SELECTED tool only (`.cursor/rules`, `GEMINI.md`, `.github/copilot-instructions.md`, `.clinerules`, `.opencode/…`, `.amazonq/…`) — each a thin pointer to AGENTS.md.
      - If `structure=mono`: author `<submodule>/CLAUDE.md` per submodule (stack-specific).
      - `.codesight/CODESIGHT.md` only if `contextMode=static` (otherwise the regen hook owns it).

6. **Re-score (CLI):** run `... score <path> --profile <profile>` and report the new % + remaining gaps. Note that functional scoring counts only WIRED hooks / FRESH indexes / host-matched CI — explain any item that stayed `partial` and why.

7. End with: `💡 /codepresso:aidlc-doctor <path> — re-check compliance anytime`.
</Steps>

<Tool_Usage>
- `Bash` for the `aidlc-cli.mjs` subcommands (always pass `--profile` after step 3) and for wiring hooks.
- `AskUserQuestion` for the 7-branch interview + preview confirmation.
- `Read`/`Write` for the profile JSON and authored files (Write only after existence check — non-destructive).
</Tool_Usage>
