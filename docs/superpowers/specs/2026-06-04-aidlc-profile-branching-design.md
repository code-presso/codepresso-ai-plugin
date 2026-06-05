# AIDLC Scaffolder — Profile-Driven Interview Branching (Design)

**Status:** Accepted — 2026-06-04
**Scope:** `scripts/lib/aidlc-detect.mjs`, `aidlc-scan.mjs`, `aidlc-template.mjs`, `scripts/aidlc-cli.mjs`, `templates/aidlc/**`, `skills/aidlc-init`, `skills/aidlc-doctor`, bundled `scripts/codesight-scan.mjs`, tests.

## Context

`../monorepo` is the canonical "AI-native repo" reference. A gap analysis against the current 16-item scorecard found three structural blind spots and a scoring-honesty problem:

1. **Blind spots:** local-dev reproducibility (`docker-compose` + one-command bring-up), multi-tool pointer coherence (`.opencode`/`.cursor`/`GEMINI.md`/copilot), and a *living* context index (monorepo auto-regenerates `.codesight/`; the scaffolder wrote it once → goes stale).
2. **Scoring honesty:** several items score `present` on mere file existence while being inert — `pre-push` script not wired, `codesight` stale, `ci-pr` written for the wrong host, `permission-matrix` trivial. Items `#12`/`#14` were permanently `partial`.
3. **No situational branching:** templates were emitted unconditionally (always `.github` CI), ignoring detected host / tool set / hook framework — forcing the wrong dependency on the repo.

## Decisions (confirmed)

- **D1 — Functional scoring.** Scoring moves from "exists" to "functionally valid". This intentionally lowers scores on existing repos (incl. monorepo). `doctor` must explain *why* a score dropped.
- **D2 — Bundled node context regen (0 dep).** Default context-index mode ships a pure-Node `scripts/codesight-scan.mjs` wired as a SessionStart hook. No external `codesight` tool dependency by default; external tool is opt-in.
- **D3 — 16 → 18 items.** Add `#17 local-dev` and `#18 multitool-coherence` as first-class items; `na`-scoping keeps the denominator fair.

## Architecture — profile-driven pipeline

```
detect (extended) → scan(baseline) → interview → profile.json
                                          ↓
                       scan/score --profile  (na-scoping)
                                          ↓
                       plan --profile        (host/tool template selection)
                                          ↓
       apply-static --profile + authored writes → re-score --profile
```

### `.codepresso/state/aidlc-profile.json`

```jsonc
{
  "tools": ["claude", "opencode"],          // agent tools actually in use
  "ciHost": "github" | "gitlab" | "bitbucket" | "none",
  "prePush": "raw" | "husky" | "lefthook" | "skip",
  "contextMode": "regen-node" | "external" | "static" | "off",
  "localDev": "detected" | "scaffold" | "skip",
  "integrations": [],                       // Notion/Figma/Google/AWS — default empty
  "ticketPrefix": "TSK" | "none"
}
```

`scan`/`score`/`plan`/`apply-static` accept `--profile <path>` (optional; absent = baseline, everything scored).

## detect extensions

| Field | Signal |
|---|---|
| `tools[]` | `.cursor`/`.cursorrules`, `.opencode/`, `.clinerules`, `.github/copilot-instructions.md`, `GEMINI.md`, `.amazonq/` |
| `ci.files` | `.github/workflows/*.y?ml`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml` |
| `hookFramework` | `package.json` devDeps `husky`, `.husky/`, `lefthook.y?ml` → else `raw` |
| `localDev` | `docker-compose.yml`/`compose.yaml`, `Makefile` (up/dev), `scripts/local-up.sh`, npm `dev`/`start` |

## Interview state machine (7 branches)

| # | Branch | Min-dep default | Opt-in (tradeoff) | `na` when |
|---|---|---|---|---|
| 1 | agent tools | detected prechecked | add cursor/gemini/copilot/cline | unused tools |
| 2 | CI host | match detected host | host=none → "GH Actions anyway?" | none + declined |
| 3 | pre-push install | raw `.git/hooks` (0 dep), **actually wire** | husky/lefthook | skip |
| 4 | context index | **bundled node regen hook (0 dep)** | external tool / static-once | off |
| 5 | local-dev | inject detected command into AGENTS.md | scaffold minimal per-stack | skip |
| 6 | integrations | all OFF | Notion/Figma/AWS opt-in | — |
| 7 | ticket convention | detected prefix | override / none | — |

Principle: **detect → lowest-dependency default → raising dependency is always opt-in with the tradeoff stated.** Unused tools / absent hosts drop to `na` so a repo is never penalised for not installing something it doesn't use.

## Scoring changes (functional)

| Item | present requires |
|---|---|
| `#8 codesight` | `.codesight/` exists AND (regen hook present OR mtime ≤ 14d). stale+no-hook = partial |
| `#11 ci-pr` | a PR/MR-triggered pipeline for the **detected host** (github→workflows w/ `pull_request`; gitlab→`.gitlab-ci.yml` w/ MR rules; bitbucket→`bitbucket-pipelines.yml` pull-requests). host mismatch = partial; host=none = na |
| `#15 pre-push` | hook **wired** (`.git/hooks/pre-push` non-sample / `.husky/pre-push` / `lefthook` pre-push) referencing the check. script exists but unwired = partial |
| `#12 traceability` | promote to present when PRD schema exists OR (ticket convention detected AND PR-title convention confirmed in profile) |
| `#14 feature-flags` | `na` when profile marks not-applicable; otherwise partial pending confirm |

## New items

- **#17 local-dev** — present if one-command bring-up exists (compose + documented command / `Makefile` up|dev|start / `scripts/local-up.sh`|`dev.sh` / single-package npm `dev`|`start`). compose present but no documented command = partial. Apply is **opt-in**: `planFiles` includes it only when `profile.localDev === 'scaffold'`, and `apply-static` writes an executable (`chmod +x`) `scripts/local-up.sh`. A re-scan then detects it as present.
- **#18 multitool-coherence** — in-use tools = detected ∪ profile-selected. present if `AGENTS.md` exists AND every in-use tool has a pointer file referencing it. single tool (just AGENTS+CLAUDE) = na; some pointers missing = partial.

## Bundled context regen (D2)

`scripts/codesight-scan.mjs` — pure Node, no deps. Scans top-level dirs + manifests + (best-effort) routes/schemas, emits `.codesight/CODESIGHT.md` with a generated-at stamp. A template wires it as a `.claude/settings.json` SessionStart hook when `contextMode=regen-node`. This satisfies "minimize external dependencies" while keeping the index fresh (fixes the stale-doc failure mode).

## Test plan

- detect: tools/ci/hookFramework/localDev detectors (tmp repos).
- scan: functional `#8/#11/#15`, new `#17/#18`, `na`-scoping with a profile, `ITEMS.length === 18` + unique keys.
- template: host-specific CI selection, profile-driven `planFiles`.
- cli: `--profile` parsing, profile-aware `scan`/`plan`/`apply-static`, new `scripts/aidlc-cli.test.mjs`.
- e2e: run `detect`/`scan` against `../monorepo` and this repo; confirm functional scoring + na-scoping behave.
