---
name: codepresso:security-audit
description: Run a web security audit / verification of any codebase — scan code + infra for vulnerabilities, interview to confirm, and produce a scored remediation report. Use for "security check", "보안 점검", "audit security", "security review", "취약점 진단", OWASP checklist.
---

# security-audit

Verifies the security posture of a **web service of any tech stack** against a
checklist grounded in the **OWASP Top 10:2025** and the notable **2025–2026 web
security incidents** (Sept-2025 npm "Qix"/Shai-Hulud supply-chain attacks,
cloud-misconfig data leaks, credential/OAuth abuse, LLM prompt-injection / SSRF).

The flow is **scan → interview → report**:

1. A deterministic, stack-agnostic scanner gathers *evidence* — both from the
   **repository** (code + infra config) and, optionally, from the **developer's
   own machine** (local credential hygiene: long-lived keys, unencrypted SSH
   keys, plaintext npm/docker/git tokens — the exact vectors behind the 2025 npm
   maintainer-token theft and the Shai-Hulud token-stealing worm).
2. You run a short interview, narrowed by what the scans found, to judge each
   OWASP category (the scanner can't see access-control logic or operational
   controls — humans confirm those).
3. The scanner renders a **scored markdown report** with prioritized
   remediation, each item explaining *why it matters* via a real incident.

The harness is `scripts/security-audit-cli.mjs`. **Paths below are relative to
the repo root.**

## When to invoke

- The user runs `/codepresso:security-audit` (optionally with a target path).
- The user asks to "check security", "보안 점검/진단", "security review/audit",
  "find vulnerabilities", or "run the OWASP checklist".

It works on **any repository** — pass a path, or default to the current repo.

## Procedure

### Step 1 — Scan the target (the driver)

Run from the repo root. Default target is `.`; the user may name another path.

```bash
node scripts/security-audit-cli.mjs scan .
```

This prints JSON to stdout. Parse it:

- `stack` — detected `languages`, `manifests`, `hasDocker`, `hasIaC`, `hasCI`, `usesLLM`.
- `findings[]` — `{ id, owasp, severity, title, file, line, evidence }` (secrets are masked).
- `interviewTriggers[]` — checklist IDs to cover in the interview (includes the
  LLM/SSRF item `SC-11` only when `stack.usesLLM` is true).
- `summary` — counts by severity.

Write the JSON to a file so the report step can reuse it, e.g.
`node scripts/security-audit-cli.mjs scan . > .codepresso/security-scan.json`.

### Step 1b — Scan the developer machine (optional, ask first)

Locally stolen credentials are a leading initial-access vector. With the user's
go-ahead, scan their HOME for credential-hygiene issues:

```bash
node scripts/security-audit-cli.mjs scan-local
```

**Ask before running this** — it reads the user's `~/.aws`, `~/.ssh`, `~/.npmrc`,
etc. It reports *presence + risk type only* and **never prints secret values**
(env vars are reported by name only; matched tokens are not echoed). Output shape
mirrors `scan`: `checkedLocations[]`, `findings[]` (all `id: SC-12`), `summary`,
`platform`, `permissionChecks` (POSIX perm bits checked on mac/linux, skipped on
Windows). Save it for the report: `… scan-local > .codepresso/security-local.json`.

### Step 2 — Load the checklist

```bash
node scripts/security-audit-cli.mjs checklist
```

Each item has `id`, `owasp`, `title`, `incident` (the recent-incident rationale),
`autoChecks`, `interview` (the questions), `weight`, `severityIfFail`.

### Step 3 — Interview, narrowed by the scan

For each `id` in `interviewTriggers`, ask the user the category's `interview`
questions using **`AskUserQuestion`**, batching related questions (≤4 options per
call). Seed each question with the scan evidence so the user answers in context.

> Example: if `findings` contains an `SC-03` "no committed lockfile" entry, when
> you reach Software Supply Chain, lead with: *"The scan found no lockfile and a
> `^`-ranged dependency — is `npm ci`/locked install + CI dependency scanning in
> place?"*

Cover what the scanner **cannot** see — these are mostly logic/operational:
access-control enforcement (`SC-01`), auth/MFA/OAuth scopes (`SC-07`), threat
modeling & rate limits (`SC-06`), logging/alerting (`SC-09`), and any
infrastructure (IAM least-privilege, public buckets, security groups) when
`stack.hasIaC` or the user confirms cloud infra.

Assign each category a status: `pass` · `partial` · `fail` · `na`
(use `na` only when the category genuinely doesn't apply, e.g. `SC-11` with no LLM).

### Step 4 — Generate the scored report

Build a JSON payload `{ scan, localScan?, answers, date }` where `answers` is
`[{ id, status, note }]` (one per interviewed category; `note` is a one-line
human summary). Include `localScan` (the Step 1b JSON) if you ran it — the report
merges both finding sets and adds an endpoint summary line. Then pipe it to the
`report` command:

```bash
cat audit-input.json | node scripts/security-audit-cli.mjs report > SECURITY-AUDIT-REPORT.md
```

The report contains a posture score (0–100 + letter grade), a scorecard table,
prioritized remediation (worst-severity first, with scan evidence + the incident
rationale + controls-to-put-in-place checkboxes), and a list of passing controls.
Show the user the score and the top remediation items.

### Step 5 (optional) — File findings as Notion tasks

If the user wants follow-up tracked and Notion is configured, create one task per
failing/critical category via `mcp__codepresso-notion__notion_create_page`
(title `[SECURITY] <category>`), linking back to the report. Skip silently if
Notion is unconfigured.

## Driver reference

`scripts/security-audit-cli.mjs` (checklist data: `scripts/lib/security-checklist.mjs`):

| Command | Input | Output |
|---|---|---|
| `scan [path]` | repo path (default `.`) | repo evidence JSON (`stack`, `findings`, `interviewTriggers`, `summary`) |
| `scan-local [home]` | HOME dir (default `os.homedir()`) | endpoint evidence JSON (`checkedLocations`, `findings` all `SC-12`, `summary`); **never emits secret values** |
| `checklist` | — | full OWASP-2025 checklist as JSON (12 items incl. `SC-12` endpoint) |
| `report` | `{scan, localScan?, answers[], date?}` on **stdin** | scored markdown report on stdout |

Tests: `node --test tests/lib/security-audit.test.mjs` (7 tests, all passing).

## Gotchas

- **The scanner finds candidates, not verdicts.** Secrets in `tests/` fixtures,
  a `child_process` import inside a markdown doc, or an `anthropic.com` URL in a
  config file will surface as findings. That's intentional — the interview is
  where you confirm or dismiss them. Never report a raw scan finding as a
  confirmed vulnerability without the human judgment step.
- **`(?i)` is not valid in a JS regex literal.** The checklist's string patterns
  use a leading `(?i)` that the CLI's `buildRegex` strips into the `i` flag;
  inline regex literals in the CLI must use `/.../i`. Keep new patterns
  consistent or scanning throws.
- **Stack-agnostic by design.** The scanner never runs the project's build/tests
  and needs no language toolchain installed — it reads files only. So it can
  audit a Python or Go repo from a Node-only environment, but it also can't catch
  anything that requires *executing* the app. Dynamic checks belong in the interview.
- **`scan-local` is privacy-sensitive — ask first, and it never leaks values.**
  It reads the user's HOME credential files but emits only file paths, a risk
  description, and env-var *names*; secret values are never echoed. Don't paste
  raw credential file contents into the conversation when following up — the
  scan deliberately avoids that, and so should you.
- **Endpoint perm checks are POSIX-only.** On Windows the file-permission checks
  are skipped (different ACL model) — `permissionChecks` says so. Unencrypted-key
  and plaintext-token checks still run on every platform.
- **`git ls-files` is preferred over a manual walk.** In a git repo the scanner
  lists tracked files (respects `.gitignore`); outside git it walks the tree and
  skips `node_modules`, `.venv`, `dist`, etc. A repo with everything gitignored
  will scan fewer files than you expect — check `scannedFiles` in the output.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `scan` prints `Target not found` (exit 2) | The path arg doesn't exist; pass a valid directory or `.`. |
| `scannedFiles` is 0 or very low | Target isn't a git repo and files are nested >12 deep, or everything is in skipped dirs. Run from the project root. |
| `report` exits 2 with "stdin must be JSON" | The piped payload isn't valid JSON `{scan, answers}`. Re-serialize; ensure `scan` is the full object from Step 1. |
| Too many low-value findings in one category | The scan caps each category at 10 and lists the category in `truncatedCategories`; treat as "many — review in IDE" rather than enumerating. |
