# AIDLC × AI-Native PM/Ops 플러그인 — 리서치 & 설계

> **작성:** 2026-05-31 · 하이브리드 멀티에이전트 워크플로우(13 에이전트, ~93만 토큰, 13분: 웹 리서치 3 + 코드 감사 3 + 적대적 검증 2 + 종합 4 + 비판 1)로 생성 후 **비판·검증 결과를 반영해 큐레이션**.
> **결정 파라미터:** 산출물=리서치+설계 문서 · AIDLC 렌즈=AWS AI-DLC 중심+대안 비교 · 의존성=디커플링만(교체 가능 추상화, 제거 아님).

---

## 0. 먼저 읽을 것 — 신뢰성 경고 & 정정 (적대적 비판 반영)

이 문서는 워크플로우 산출물을 **그대로 신뢰하지 말고** 아래 정정과 함께 읽어야 합니다. 자체 비판 에이전트의 판정: *"부분적으로 신뢰 가능, 정정하면 실행 가능 — 그대로 출고 불가."* 구조 분석·갭 진단·포트 아키텍처 골격은 **신뢰**하되, 구체적 리소스 식별자·보안 등급·정확한 퍼센트는 **재검증 필요**.

### 🔴 보안 (즉시 조치)
- **`.claude/settings.local.json`에 라이브 Notion 토큰(`ntn_53440…`) 평문 존재.** `Bash(curl ...)` allow 항목 + Notion DB ID + user UUID 포함.
- **검증 결과: gitignore됨 → git/원격/public 유출 아님.** 단, 디스크 평문 + 워크플로우 에이전트 컨텍스트로 읽힘.
- **조치:** Notion에서 토큰 **회전(rotate)**, 로컬 파일은 토큰을 allow-list curl에서 빼고 env 참조로 전환 권장. (스코어카드 §10이 이 파일을 "Present"로 깨끗하게 점수 매긴 것은 오판 — 보안 점검 도구의 본분을 놓침.)

### ⚠️ 방법론 정정 — part 2 스코어카드는 "모노레포"가 아니라 "플러그인 repo"를 측정함
- 사용자 질문은 **모노레포(`code-presso/monorepo`) 준수도**였으나, 종합 에이전트(cwd=플러그인 repo)가 **플러그인 repo(`codepresso-ai-plugin`)** 를 채점함. 스코어카드의 "AGENTS.md 없음 / docs/decisions 없음 / .codesight 없음 / ai-agent-policy·documentation-policy 없음 / release.yml push-to-master" 는 전부 **플러그인 repo의 사실**.
- **모노레포는 이 항목들을 실제로 보유** (AGENTS.md, docs/decisions ADR, .codesight/CODESIGHT.md, docs/ai-agent-policy.md, docs/documentation-policy.md, docs/oncall-runbook.md, docs/superpowers specs+plans, 서브모듈+coordinated-deploy 등 — 세션 내 직접 확인). 즉 **모노레포의 실제 준수도는 60%보다 훨씬 높음.**
- **읽는 법:** §2 스코어카드 = "플러그인 repo가 모노레포 수준 템플릿을 얼마나 따르는가"로 해석. 모노레포 자체 재채점은 후속 과제. 템플릿 체크리스트(§2.1) 자체는 유효(모노레포에서 도출).

### AI-DLC 리서치 정정 (검증 2명 교차)
- AI-DLC는 **실재하는 AWS 방법론** — 3단계(Inception/Construction/Operations), Bolts(=스프린트), Units of Work(=에픽), Mob Elaboration/Construction 리추얼, `awslabs/aidlc-workflows` 레포 모두 **1차 출처 검증됨**. 비교 프레임워크(Spec Kit·Kiro·BMAD·Agent OS·Anthropic EPCC)도 전부 실재·정확(할루시네이션 없음).
- **정정:** ① "Plan-Verify-Generate"는 AWS 공식 용어 아님(개념은 맞음, 용어는 paraphrase) → 본문에서 AWS-공식처럼 단정하지 말 것. ② BMAD = "Breakthrough Method **for** Agile AI-Driven Development"("of" 아님). ③ Wipro 10–15x / 20%→80% 등 수치는 **AWS가 DVT214에서 말했으나 미감사 자가보고** — AWS가 동시에 인용한 반대 연구(ThoughtWorks ~10–15%, METR 20% 저하)와 함께만 인용. ④ AWS **Operations 단계는 레포상 `(future)` 스텁** — §1의 6단계 중 Operate를 "완비"로 과장 금지(단, 플러그인의 운영 스킬은 오히려 AWS 스텁보다 풍부).

### 기타 비판 플래그 (본문 읽을 때 감안)
- **H1:** 디커플링 §2.8/§2.2의 Lambda ARN(`…pQRyUZlV0CCh`)·캘린더 ID(`c_b96d…`)는 repo grep 미확인 → **거짓 정밀** 가능. 실재 확인된 것은 `oncall-assignments-history`·`ap-northeast-2`. 식별자 인용 전 재확인.
- **M2:** §1의 "EARS = 가장 엄격·감사가능한 패턴"은 근거 없는 최상급 → EARS는 **선택적 템플릿 1종**으로 권고(하드 게이트 아님). no-build .mjs 플러그인에 항공표준 강제는 과함.
- **M3/M4:** §1 아티팩트 표가 모노레포 산출물(서브모듈, coordinated-deploy.yml, oncall-runbook.md 등)을 플러그인의 "기존 home"처럼 표기 → 이들은 **모노레포** 소관. (오해 주의)
- **M5:** 디커플링이 PreToolUse 훅(<3s 예산) 핫패스에 동적 `import()`+`loadConfig()` 추가 비용을 과소평가 → **어댑터를 프로세스당 캐시 + 벤치마크 후** 적용.
- **M6:** "MCP가 포트의 얇은 노출로 dual-boundary 제거"는 과장 — MCP 서버와 훅은 **별개 런타임**(공유 코드일 뿐 공유 인스턴스 아님). "같은 포트 모듈을 import"로 재표현.

**한 줄 판정:** 갭 리스트와 포트 아키텍처 골격은 신뢰. 구체 식별자·보안 "Present" 등급·정확 %는 재검증 후 사용. **토큰 회전이 선결.**

---


---

## 1. AIDLC 리서치 & 템플릿  *(파트 1)*
> AWS AI-DLC 중심 + 대안 비교 기반. 정정은 §0 참조(Plan-Verify-Generate 용어, Operations 스텁, EARS 최상급).

# AIDLC Template for the Codepresso Team

> A six-stage AI-Driven Development Lifecycle tailored to the codepresso plugin + `code-presso/monorepo`, grounded in AWS AI-DLC ([AWS DevOps blog](https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/), [awslabs/aidlc-workflows](https://github.com/awslabs/aidlc-workflows)) and refined against Spec Kit, Kiro, BMAD, Agent OS, and Anthropic's Explore→Plan→Code→Commit guidance.

## How this maps to AWS AI-DLC (and where we diverge)

AWS AI-DLC has **exactly three phases** — Inception (WHAT/WHY), Construction (HOW), Operations (deploy/monitor, currently a `(future)` stub in the repo) — each running an AI-plans → human-verifies → AI-generates loop, with "Bolts" (hours/days cycles) replacing sprints and "Units of Work" replacing epics (all verified verbatim against AWS sources).

We **expand the three AWS phases into six named stages** because our team already has the artifact homes (`docs/superpowers/specs+plans`, `docs/decisions`, `docs/prd`) that make finer stage boundaries cheap. The mapping:

| Our stage | AWS AI-DLC phase | Borrowed from |
|---|---|---|
| 1. Intent | Inception (front half) | AI-DLC "Intent"; BMAD project brief |
| 2. Spec | Inception (Mob Elaboration) | AI-DLC requirements/stories; Kiro EARS; Spec Kit `spec.md` |
| 3. Plan | Construction (logical design) | AI-DLC design; Spec Kit `plan.md`/`tasks.md`; Anthropic Plan Mode |
| 4. Build | Construction (Mob Construction) | AI-DLC code+tests; Anthropic Code; BMAD SM/Dev loop |
| 5. Verify | Construction (QA) + AI-DLC's human gates | Anthropic adversarial subagent review; AI-DLC "understand every line" |
| 6. Operate | Operations | AI-DLC Operations; our coordinated-deploy + oncall-runbook |

We keep AWS's **adaptive depth** principle: a Sev-class hotfix collapses Intent+Spec+Plan into one runbook entry and jumps to Build→Verify→Operate; a greenfield epic traverses all six.

---

## (1) The six AIDLC stages, tailored to this team

**Bolt = one Notion task (`TSK-XXXX`) under an epic (`GP-XXXX`).** A Bolt runs the full Plan→Verify→Generate micro-loop and is the unit the plugin already auto-links to a PR via `[TSK-XXXX]` title enforcement. An epic is our "Unit of Work" — independently valuable, deployable in isolation via `coordinated-deploy.yml`.

### Stage 1 — Intent (WHAT & WHY)
The business goal, before any solutioning. AWS's "Intent" decomposed by AI into candidate Units of Work; clarifying questions asked here, not later.

### Stage 2 — Spec (validated requirements)
AI transforms Intent into requirements + acceptance criteria (AWS Mob Elaboration). We adopt **Kiro-style EARS acceptance criteria** ("WHEN [condition] THE SYSTEM SHALL [behavior]") for testability — the single most rigorous, auditable pattern across the surveyed frameworks. This is the first hard human gate.

### Stage 3 — Plan (HOW, logical)
AI proposes logical design, file-level task list, and risk assessment (AWS Construction front half; Spec Kit `plan.md`+`tasks.md`). Architectural choices that close off alternatives are flagged for ADR capture here.

### Stage 4 — Build (generate)
AI generates code + tests (AWS Mob Construction). Constraint from our `ai-agent-policy.md`: investigate git history first, no sweeping multi-file `sed` without single-file verification, no in-process state in multi-task backends.

### Stage 5 — Verify (human-in-the-loop + adversarial review)
Independent verification BEFORE merge. We combine AI-DLC's "developers must understand every line" gate with **Anthropic's adversarial fresh-subagent code review** (verified as Anthropic's recommended pre-commit step). Evidence-before-assertion is mandatory (`verification-before-completion`).

### Stage 6 — Operate (deploy & monitor)
Coordinated multi-service deploy through the gated workflow, then incident readiness. AWS's Operations phase; the codepresso plugin already covers the ops surface (oncall, deploy, daily bookends) better than AWS's own stub phase.

---

## (2) Concrete artifact per stage + where it lives

| Stage | Concrete artifact | Lives in (existing home) |
|---|---|---|
| **1. Intent** | Notion epic page (`GP-XXXX`) + epic PRD doc | Notion (epic DB) → generated PRD at `docs/prd/GP-XXXX-*.md` via `codepresso:generate-epic`. Brief-level scratch in `.agent-work/*-planning/` (gitignored) |
| **2. Spec** | Design/spec doc with EARS acceptance criteria; per-task Notion subtasks (`TSK-XXXX`) | `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` (matches existing files e.g. `2026-05-16-inbox-task-tracker-design.md`); tasks in Notion task DB |
| **3. Plan** | Implementation plan (logical design + ordered file-level tasks + risk); **ADR if a choice is load-bearing** | `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` (matches `2026-05-16-inbox-task-tracker.md`); decisions → `docs/decisions/ADR-XXXX-*.md` (Nygard template) |
| **4. Build** | Source diff on a `feat/*` branch; new/changed tests; submodule commits | Submodule repos (`backend/*`, `frontend/*`, `infra`, `tests`); PR auto-commented by `post-tool-git-watcher.mjs`; ephemeral as-is notes in `.agent-work/` |
| **5. Verify** | Test output (quoted), E2E gate result, code-review findings; CI status | `.github/workflows/e2e-on-pr.yml` + `schema-validate-preflight.yml` results on the PR; review notes in PR thread; `tests/` submodule (Playwright/Locust) |
| **6. Operate** | Monorepo semver tag + GitHub Release; deploy run; ADRs for infra decisions; incident records | `.github/workflows/coordinated-deploy.yml` + `unified-release.yml`; `docs/oncall-runbook.md`; infra ADRs (`docs/decisions/ADR-0001..0005` pattern); Notion task → auto-complete on merge |

**Cross-stage homes:** durable cross-repo learnings → personal LLM Wiki (`codepresso:llm-wiki`); per-submodule stack guidance → `{submodule}/CLAUDE.md` (closest-file-wins); auto-generated structural context → `.codesight/CODESIGHT.md`.

**Lifecycle note (per `docs/documentation-policy.md`):** specs+plans are **Scoped** (frozen after ship), ADRs are **append-only**, PRDs are **feature-scoped**, `.agent-work/` is **Ephemeral** (never committed). Promotion path: durable parts of `.agent-work/` → ADR or scoped doc → delete original.

---

## (3) Plugin skills/hooks supporting each stage + GAP LIST

| Stage | Supported today (skill/hook) | MISSING (gap) |
|---|---|---|
| **1. Intent** | `codepresso:generate-epic` (Notion epic → PRD); `notion_sprint_context`/`notion_create_page` MCP; `scan-inbox` surfaces incoming intent → Notion tasks | **No "Intent → Units of Work decomposition" skill** (AWS Mob Elaboration). No skill that turns a raw epic into candidate task-slices with clarifying questions. **No EARS-criteria authoring helper.** |
| **2. Spec** | PreToolUse task picker (`pre-tool-notion-inject.mjs`) selects the active `TSK-XXXX`; `notion-sync`; `superpowers:brainstorming`/`writing-plans` (generic) | **No codepresso `spec` skill** that scaffolds `docs/superpowers/specs/<date>-<slug>-design.md` from the selected Notion task + writes acceptance criteria. Spec-doc creation is currently manual. |
| **3. Plan** | `oh-my-claudecode:plan`/`ralplan`, `superpowers:writing-plans` (generic); ADR template exists (`docs/decisions/TEMPLATE.md`) | **No codepresso `plan` skill** wired to the `docs/superpowers/plans/` naming convention. **No "ADR-needed?" detector** — load-bearing decisions are captured ad hoc; the ADR backlog confirms drift. |
| **4. Build** | PreToolUse `[TSK-XXXX]` PR-title enforcement + no-task pick/create gate; `post-tool-git-watcher.mjs` PR commit comments; `scaffolding-from-figma`; `cloud-dev` | **No TDD-enforcement skill** in the codepresso namespace (relies on generic `superpowers:test-driven-development`). No submodule-aware build orchestration skill. |
| **5. Verify** | `post-tool-git-watcher.mjs` merge detection; CI gates (E2E, schema preflight) exist in monorepo; generic `code-review`/`security-review`/`verify` skills | **No codepresso `verify` / pre-merge review skill** that runs the adversarial-subagent review and quotes evidence before allowing PR merge. Gate is process, not enforced by plugin. |
| **6. Operate** | Full coverage: `codepresso:deploy`, `oncall`, `oncall-*` suite, `oncall-runbook`, `daily-chat`, `daily-summary`; merge→Notion-complete→epic-cascade (`handle-merge-transition.mjs`) | **No post-deploy verification skill** (smoke/health-check confirmation). No automatic ADR prompt after an infra change ships. |

**Top gaps, ranked:**
1. **Spec & Plan scaffolding skills** (Stages 2–3) — the biggest hole. The plugin automates the *ends* (Intent via `generate-epic`, Operate via deploy/oncall) but the **middle of the lifecycle has no codepresso-native skill**; teams hand-write specs/plans into `docs/superpowers/`. A `codepresso:spec` + `codepresso:plan` pair would close the AI-DLC Inception→Construction handoff.
2. **EARS acceptance-criteria support** (Stage 2) — adopt Kiro's testable-requirement format; nothing emits it today.
3. **Plugin-enforced Verify gate** (Stage 5) — adversarial review + evidence quoting exists only as generic skills/process, not as a codepresso gate analogous to the existing PR-title block.
4. **ADR-needed detector** (Stage 3/6) — the `docs/decisions/README.md` backlog of undocumented decisions is direct evidence this gap bites.

---

## (4) Human ↔ agent checkpoints

AI-DLC's core mechanic is the per-stage **AI plans → human verifies → AI generates** loop, with mandatory human approval between phases (AWS default flow; Kiro's non-gated "Quick Plan" is the explicit anti-pattern we avoid). Checkpoints below, marked by who holds the gate.

| # | After stage | Checkpoint | Mechanism | Held by |
|---|---|---|---|---|
| C1 | Intent → Spec | Approve Units-of-Work decomposition + clarifying answers | Mob-Elaboration-style review of epic→task split; today partially via PreToolUse `AskUserQuestion` task picker | Whole team / PM (synchronous, AWS-style) |
| C2 | Spec → Plan | Sign off EARS acceptance criteria | Human reads spec doc; **gate currently manual** (gap) | Tech lead + PM |
| C3 | Plan → Build | Approve logical design + decide ADR-or-not | Anthropic Plan-Mode-style approve-before-build; `ralplan` consensus optional | Reviewer |
| C4 | (within Build) | Block PR without `[TSK-XXXX]` / no selected task | **Automated, enforced** — `pre-tool-notion-inject.mjs` blocks `gh pr create` | Plugin hook |
| C5 | Build → Verify | "Understand every line" + adversarial fresh-eyes review | Anthropic subagent code-review + `verification-before-completion` (quote real test output) | Independent reviewer (human or fresh subagent) |
| C6 | Verify → Operate | Production deploy gate | **Automated + human** — `coordinated-deploy.yml` on-call verification + E2E gate (bypassable only via `skip_oncall_gate`/`skip_e2e_gate` in emergencies) | On-call engineer |
| C7 | Operate (post) | Incident readiness / post-deploy validation | `docs/oncall-runbook.md` + oncall skills; **post-deploy smoke-check is a gap** | On-call |

**Checkpoint health:** C4 and C6 are the strongest (plugin/CI-enforced). **C2 and C5 are the weak links** — they exist as policy (`ai-agent-policy.md`, documentation-policy) and generic skills but are not codepresso-enforced gates, mirroring the Stage 2/5 skill gaps above.

---

## Sources cited
- AWS AI-DLC (3 phases, Mob Elaboration/Construction, Bolts, Units of Work, plan→verify→generate loop, human gates): https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/ ; repo (Operations `(future)`, `aidlc-docs/`, `aidlc-state.md`): https://github.com/awslabs/aidlc-workflows
- Kiro EARS acceptance-criteria format (and Quick-Plan no-gate anti-pattern): https://kiro.dev/docs/specs/feature-specs/ ; EARS origin (Mavin/Rolls-Royce): https://alistairmavin.com/ears/
- Spec Kit spec.md/plan.md/tasks.md + tasks→issues export: https://github.com/github/spec-kit
- BMAD two-phase planning→SM/Dev loop (handoff model): https://github.com/bmad-code-org/BMAD-METHOD
- Agent OS 3-layer context (Standards/Product/Specs ≈ CLAUDE.md / PRD / scoped specs): https://buildermethods.com/agent-os/v2/3-layer-context
- Anthropic Explore→Plan→Code→Commit + adversarial subagent review before commit: https://code.claude.com/docs/en/best-practices

**Refuted/hedged claims deliberately excluded:** the exact phrase "Plan-Verify-Generate" is not AWS-verbatim (used here only as a descriptive loop name); named Inception sub-stages ("Workspace Detection" etc.) and any six/nine-stage count are third-party, so this template defines its own six stages rather than citing those; AWS "10-15x productivity / 20%→80% predictability" figures are self-reported/unaudited and are not cited as outcomes.

This content fills section **1.3** of `/Users/kwm/Documents/GitHub/codepresso-ai-plugin/docs/superpowers/specs/2026-05-31-aidlc-ai-native-plugin-design.md`.


---

## 2. 모노레포 템플릿 & 준수도 스코어카드  *(파트 2)*
> ⚠️ §0 경고: 아래 스코어카드는 **플러그인 repo**를 측정함. 모노레포 자체는 더 높은 준수도(AGENTS.md/ADR/.codesight/정책/oncall-runbook 보유). 템플릿 체크리스트는 유효.

---

# AI-Native Repo Template + Compliance Scorecard

**Template source:** `code-presso/monorepo` (mature AI-native conventions, per audit)
**Repo under measurement:** `code-presso/codepresso-ai-plugin` (this repo — a single-package Claude Code plugin, NOT a monorepo)

> Honesty note: the supplied audit inventories a *different* repository (the platform monorepo). This repo is a single ESM plugin. Several monorepo-only items (submodule sync, coordinated deploy, codesight per-submodule index) are scored against this repo's actual structure, where they are legitimately N/A or Missing — I do not credit this repo for artifacts that live in the sibling monorepo.

---

## Part 1 — The Template: AI-Native Repo Checklist

A compliant AI-native repo should have the following. Each item lists **purpose** and a **minimal version** (the cheapest thing that counts as "Present").

| # | Item | Purpose | Minimal version |
|---|------|---------|-----------------|
| 1 | **`AGENTS.md` at root** | Cross-tool (Codex, Cursor, Aider, Copilot, OpenCode) authoritative entry point; the machine-readable contract. | A root `AGENTS.md` listing build/test/run commands + conventions, even if it just points to `CLAUDE.md`. |
| 2 | **`CLAUDE.md` at root** | Claude Code session bootstrap; architecture, hook contracts, code style. | One root `CLAUDE.md` with architecture + "how to run tests/build". |
| 3 | **Per-package/submodule `CLAUDE.md`** | "Closest-file-wins" stack-specific guidance for each component. | One nearest-file override per distinct stack (skip if single-package). |
| 4 | **ADRs (`docs/decisions/`)** | Append-only architecture decision history (Nygard: Status/Context/Decision/Consequences) so "why" survives. | A `docs/decisions/` dir with `TEMPLATE.md` + `README.md` index + ≥1 ADR. |
| 5 | **Specs + Plans workflow (`docs/` scoped)** | Spec/intent as durable source of truth; feature-tied design docs frozen after ship, dated. | A `docs/.../{plans,specs}` convention with dated, feature-scoped files. |
| 6 | **AI agent policy (`docs/ai-agent-policy.md`)** | Mandatory guardrails (investigate-before-fix, no sweeping `sed`, 2-strikes, verify-before-complete, stack traps). | A single policy doc loaded into every session. |
| 7 | **Runbook + executable skill split** | Operational procedures as agent-runnable steps; deterministic state ops in a CLI, judgment in a markdown skill. | A `runbook` doc OR skill, with deterministic ops behind a callable script. |
| 8 | **Codesight / context index** | Auto-generated structural map (routes/schema/deps) to cut agent exploration cost. | A committed or session-generated index file, or a generator hook. |
| 9 | **Session/automation hooks** | SessionStart bootstrap (sync, index regen), PreToolUse/PostToolUse enforcement. | At least one declared hook that automates context or enforcement. |
| 10 | **Permission matrix (`.claude/settings`)** | Allow/deny Bash list to cut prompts + block dangerous ops. | A `settings.local.json`/`settings.json` with a `permissions` block. |
| 11 | **CI gate on every PR** | Evals/tests as the regression suite; can't merge a behavior change without a verdict. | A workflow running `npm test` (or equivalent) on push/PR. |
| 12 | **Intent→PR→deploy traceability** | Linked chain from ticket → PR title → merge → status cascade. | A convention enforcing ticket ID in PR title + a merge-to-status link. |
| 13 | **Documentation policy** | Categorize docs (Permanent / ADR / Scoped / Ephemeral) to prevent doc rot. | A doc defining doc categories + lifetimes + what is gitignored. |
| 14 | **Graceful degradation / feature flags** | External SaaS deps gated `enabled:false`, fall through silently when unconfigured. | Each integration behind a config flag with silent fall-through. |
| 15 | **Pre-push / pre-merge validation** | Block broken states (unpushed deps, secrets) before they land. | A `check-before-push` script or git hook. |
| 16 | **Unit tests for deterministic logic** | Pure functions (config merge, parsers, state) covered so agents refactor safely. | A `tests/` dir wired into the CI `test` script. |

---

## Part 2 — Scorecard (this repo: `codepresso-ai-plugin`)

| # | Item | Status | Evidence (path) | Note |
|---|------|--------|-----------------|------|
| 1 | `AGENTS.md` at root | **Missing** | (no `AGENTS.md` found anywhere) | Only `CLAUDE.md` exists. Cross-tool agents (Codex/Cursor) have no entry point. The plugin itself *supports* Codex (commit `2498597`) yet ships no `AGENTS.md`. Highest-value, lowest-cost gap. |
| 2 | `CLAUDE.md` at root | **Present** | `CLAUDE.md` (19 KB) | Excellent: architecture, hook contracts, state files, config schema, code style, perf rules, local testing. Best-in-class for this item. |
| 3 | Per-package `CLAUDE.md` | **N/A → Partial** | `templates/llm-wiki-vault/CLAUDE.md` | Single-package plugin, so closest-file-wins is mostly moot. A nested CLAUDE.md exists but it's a *template artifact*, not stack guidance. Score: N/A (no real sub-packages). |
| 4 | ADRs (`docs/decisions/`) | **Missing** | (no `docs/decisions/`, no `TEMPLATE.md`, no ADRs) | Decisions are embedded as numbered "Key Design Decisions" in `CLAUDE.md` (#1–#12) — good content, wrong vehicle: not append-only, not individually dated/statused. No ADR discipline. |
| 5 | Specs + Plans workflow | **Present** | `docs/superpowers/plans/*.md`, `docs/superpowers/specs/*.md` | Strong: dated, feature-scoped plan+spec pairs (e.g., `2026-05-04-omc-decoupling-notion-mcp`, `2026-05-31-aidlc-ai-native-plugin-design.md`). Matches the spec-as-source pattern. |
| 6 | AI agent policy | **Missing** | (no `ai-agent-policy.md`) | No guardrails doc (investigate-before-fix, no-sweeping-`sed`, 2-strikes, stack traps). The monorepo has one; this repo does not. Relies entirely on global OMC `CLAUDE.md`. |
| 7 | Runbook + executable skill split | **Present** | `skills/oncall-runbook/SKILL.md`, `skills/scan-inbox/SKILL.md` + `scripts/inbox-cli.mjs` + `scripts/lib/inbox-state.mjs` | Exemplary instance of the pattern: judgment in the markdown skill, deterministic state ops isolated in `inbox-cli`/`inbox-state` (per CLAUDE.md Decision #12). |
| 8 | Codesight / context index | **Missing** | (no `.codesight/`) | No structural index and no generator. For a small plugin the ROI is lower, but it's genuinely absent. |
| 9 | Session/automation hooks | **Present** | `hooks/hooks.json` (PreToolUse `*`, PostToolUse `Bash`), `scripts/session-start.mjs` | SessionStart + PreToolUse + PostToolUse all implemented with documented contracts. Among the strongest items. |
| 10 | Permission matrix | **Present** | `.claude/settings.local.json` (`permissions`, `enabledMcpjsonServers`) | Permissions block present. Note: it's `settings.local.json` (often gitignored/local) rather than a committed shared `settings.json` — weaker than the monorepo's shared matrix. |
| 11 | CI gate on every PR | **Partial** | `.github/workflows/release.yml` | Runs `npm test` — but **only on push to `master`**, as part of release, not on PRs. No `pull_request` trigger, so a broken branch isn't caught until after merge. Gate exists but is mis-placed. |
| 12 | Intent→PR→deploy traceability | **Present** | `scripts/pre-tool-notion-inject.mjs` (PR title `[TSK-XXXX]` enforcement), `scripts/post-tool-git-watcher.mjs` (commit comment + merge→status cascade), `scripts/handle-merge-transition.mjs` | Full linked chain: task → enforced PR title → commit comments → merge → Notion task/epic completion. Best-in-class for this item. |
| 13 | Documentation policy | **Partial** | `docs/superpowers/` (implicit "frozen historical working docs") | A *de-facto* scoped/ephemeral split exists (superpowers = frozen, `docs/` = reference) but there is **no explicit `documentation-policy.md`** defining categories/lifetimes/enforcement. Convention without contract. |
| 14 | Graceful degradation / feature flags | **Present** | `CLAUDE.md` config schema + Decisions #4/#12 (`inbox.enabled`, `wiki.enabled`, `googleChat.enabled`, `notion` fall-through) | Every SaaS integration is flagged `enabled:false` and hooks fall through silently when unconfigured. Hexagonal/graceful-degradation done right. |
| 15 | Pre-push / pre-merge validation | **Missing** | (no `check-before-push.sh`, no git hook in repo) | No secrets/state pre-push guard committed. (Single-repo, so no submodule-pointer check needed — but a secrets check would still apply.) |
| 16 | Unit tests for deterministic logic | **Present** | `tests/lib/` (11 test files), `package.json` `"test": "node --test tests/lib/*.test.mjs"` | Strong coverage of pure logic: config merge, git-utils, inbox-state, redactor, sprint-context, status-transitions, wiki-state, hook handlers. Wired into CI. |

**Status tally (excluding the one N/A, item #3):** 15 scored items.
- **Present: 8** (items 2, 5, 7, 9, 10, 12, 14, 16)
- **Partial: 3** (items 11, 13; plus #3 treated as N/A)
- **Missing: 4** (items 1, 4, 6, 8, 15) → that's 5 missing; recount below.

Corrected tally over 15 scored items (item 3 = N/A, excluded): Present 8, Partial 2 (11, 13), Missing 5 (1, 4, 6, 8, 15).

---

## Part 3 — Overall Compliance + Top Gaps

**Scoring rule:** Present = 1.0, Partial = 0.5, Missing = 0.0; item #3 excluded as N/A (single-package repo).

`(8 × 1.0) + (2 × 0.5) + (5 × 0.0) = 9.0 / 15 = 60%`

### Overall compliance: **60%**

This is honest, not inflated. The repo is **strong on the operational/execution layer** (hooks, traceability, runbook-skill split, feature flags, tests) — unsurprising, since it *is* the team-workflow tooling — but **weak on the governance/knowledge layer** (no AGENTS.md, no ADRs, no agent policy, no documentation policy contract).

### Top gaps to close (ranked by value ÷ effort)

1. **Add `AGENTS.md` at root (item 1)** — *Highest priority, ~30 min.* The repo advertises multi-tool support (Codex plugin shipped in `2498597`) but has no cross-tool entry file. Minimal version: a short `AGENTS.md` with build/test commands (`npm test`, Node ≥20, zero-build `.mjs`) that points to `CLAUDE.md`.
2. **Move the CI gate to `pull_request` (item 11)** — *High value, ~15 min.* `release.yml` only runs tests on push-to-`master`. Add a `pull_request` trigger (or a dedicated `ci.yml`) so behavior changes get a verdict *before* merge, not after. This is the single biggest *safety* gap.
3. **Establish `docs/decisions/` ADRs (item 4)** — *High value, ~1 hr.* The "Key Design Decisions #1–#12" in `CLAUDE.md` are excellent ADR *content* in the wrong container. Add `docs/decisions/{TEMPLATE.md, README.md}` and migrate the load-bearing ones (silent-hook pattern, PR-title auto-linking, forward-only Notion relations, inbox CLI/skill split) to dated, statused, append-only ADRs.
4. **Write `docs/ai-agent-policy.md` (item 6)** — *Medium value.* Capture this repo's real traps already learned (in `MEMORY.md`): `additionalContext` must nest in `hookSpecificOutput`; write stdout before side-effects to survive timeout kills; SessionStart hooks don't support `additionalContext`. These are exactly the "stack-specific traps" the policy pattern is for.
5. **Add `documentation-policy.md` (item 13 → Present)** — *Low effort.* Formalize the existing implicit split (`docs/superpowers/` = frozen scoped, `docs/` = permanent reference) with categories + lifetimes. Promotes Partial → Present cheaply.
6. **Add a pre-push secrets check (item 15)** — *Medium.* A `scripts/check-before-push.sh` scanning for tokens (`ntn_`, GitHub PATs) protects a repo whose whole job is wiring up Notion/GitHub/Google credentials.

**Deliberately not recommended for this repo:** codesight per-submodule index (item 8) and submodule-sync/coordinated-deploy automation — these are monorepo-shaped and low-ROI for a single-package plugin. They are correctly Missing/N/A, not gaps worth closing.

Closing gaps 1–4 would raise compliance from **60% → ~83%** and would specifically harden the governance layer that currently lags the (already strong) execution layer.


---

## 3. 외부 의존성 디커플링 설계  *(파트 3)* — 스탠스: 교체 가능 추상화(제거 아님)
> 정정: 식별자(Lambda ARN/캘린더 ID) 재확인 필요(H1), 훅 핫패스 비용(M5), MCP dual-boundary 표현(M6) — §0 참조.

---

# External-Dependency Decoupling Design — Codepresso Plugin

**Stance:** DECOUPLING ONLY. Keep every capability (Notion, Figma, Google Calendar/Chat/Gmail, AWS, GitHub, Claude CLI). Abstract each behind a capability **port** so providers are swappable and absence degrades gracefully. No build step — plain `.mjs` ESM.

---

## 1. Proposed Adapter/Port Architecture

### 1.1 Core principle

Skills and hooks call **capability ports**, never a vendor SDK/CLI directly. A port is a plain ESM module exporting a fixed function surface. A **provider registry** picks the active adapter from config. Every port has a built-in **null/local adapter** so the capability never hard-fails when a dependency is absent.

```
[skill / hook code]
        │  imports capability port (stable surface)
        ▼
[scripts/ports/<capability>.mjs]   ← port: resolves provider via registry, applies ACL + graceful fall-through
        │
        ▼
[scripts/adapters/<capability>/<provider>.mjs]   ← adapter: vendor SDK/CLI/MCP translation
        │
        ▼
  Notion SDK | gws CLI | gh CLI | MCP tool | AWS SDK | claude CLI | local-json | noop
```

This is hexagonal ports-and-adapters with an Anti-Corruption Layer in each port (the port owns the domain model; adapters translate the vendor model into it). It maps cleanly onto patterns already present in the repo (MCP servers, `gws.mjs` CLI wrapper, `enabled:false` flags, cached state with TTL).

### 1.2 Capability ports (one per domain capability, not per vendor)

| Port (capability) | Domain surface (stable functions) | Current vendor(s) | Pluggable alternatives |
|---|---|---|---|
| `TaskProvider` | `query(filter)`, `create(props)`, `update(id, props)`, `getUsers()`, `fetchSchema(dbId)`, `transitionStatus(id, status)` | Notion (`@notionhq/client`, `mcp__*notion*`) | Linear, Airtable, local-JSON |
| `DesignProvider` | `getNodeMetadata(fileKey, nodeId)`, `getImage(...)`, `getVariables(fileKey)` | Figma (REST PAT + `mcp__claude_ai_Figma`) | Penpot, local design-tokens file |
| `ChatProvider` | `sendMessage(channel, text)`, `fetchMessages(channel, opts)`, `authStatus()` | Google Chat (`gws` CLI) | Slack, Teams, stdout/log |
| `CalendarProvider` | `listEvents(calId, range)`, `createEvent(...)`, `deleteEvent(...)`, `updateEvent(...)` | Google Calendar (MCP) | Outlook, local-ICS |
| `EmailProvider` | `listMessages(query, opts)`, `getThread(id)` | Gmail (MCP) | Outlook, IMAP, noop |
| `SchedulePort` | `getAssignments(month)`, `saveAssignments(plan)`, `allocate(month)` | AWS DynamoDB + Lambda | Postgres/SQLite + local allocator |
| `DevEnvProvider` | `listInstances(email)`, `startInstance(id)`, `stopInstance(id)`, `status(id)` | AWS EC2 (`cloud-dev` MCP) | Docker Compose, K8s, noop |
| `VcsProvider` | `authStatus()`, `listPRs(filter)`, `createPR(...)`, `mergePR(n)`, `triggerWorkflow(name, inputs)`, `comment(n, body)` | GitHub (`gh` CLI) | GitLab, Gitea |
| `LLMProvider` | `invoke(prompt, {model, timeout})` | Claude CLI (`claude -p`) | Anthropic SDK, Ollama, deterministic-template fallback |

### 1.3 Registry + resolution (no build step)

`scripts/ports/registry.mjs` — single resolver reading `config.providers.<capability>`:

```js
// scripts/ports/registry.mjs  (sketch)
import { loadConfig } from '../lib/config.mjs';

// capability -> { provider-name -> async import path }
const ADAPTERS = {
  task: {
    notion: () => import('../adapters/task/notion.mjs'),
    'local-json': () => import('../adapters/task/local-json.mjs'),
    noop: () => import('../adapters/_noop.mjs'),
  },
  chat: {
    'google-chat': () => import('../adapters/chat/google-chat.mjs'),
    stdout: () => import('../adapters/chat/stdout.mjs'),
    noop: () => import('../adapters/_noop.mjs'),
  },
  // ... one block per capability
};

export async function resolveProvider(capability, cfg = loadConfig()) {
  const section = cfg.providers?.[capability] ?? {};
  // explicit selection > legacy-flag inference > availability probe > noop
  const name = section.provider
    ?? inferLegacyProvider(capability, cfg)   // maps existing flags (notion.apiKey set => 'notion')
    ?? 'noop';
  const loader = ADAPTERS[capability]?.[name] ?? ADAPTERS[capability]?.noop;
  const mod = await loader();
  return mod.createAdapter(cfg);   // adapter returns an object implementing the port surface
}
```

- **Dynamic `import()`** means an adapter that needs an absent SDK is never loaded, so a missing `@notionhq/client` or `@aws-sdk/*` cannot crash the plugin.
- `inferLegacyProvider` preserves 100% backward-compat: today's `notion.apiKey` / `googleChat.spaceId` / `deploy.method` flags auto-select the right adapter, so **no config migration is required on day one**.
- The `_noop.mjs` adapter implements every port function as a graceful no-op (returns empty arrays / `{degraded:true}`), centralizing the "dependency absent" behavior.

### 1.4 Port file shape (uniform contract)

Each port wraps the resolved adapter so callers get **ACL + degradation for free**:

```js
// scripts/ports/chat.mjs  (sketch)
import { resolveProvider } from './registry.mjs';
import { createLogger } from '../lib/logger.mjs';
const log = createLogger('port:chat');

export async function sendMessage(channel, text, opts) {
  const adapter = await resolveProvider('chat');
  try {
    return await adapter.sendMessage(channel, text, opts);
  } catch (err) {
    log.warn(`chat.sendMessage degraded: ${err.message}`);
    return { ok: false, degraded: true, reason: err.message }; // never throw into a hook
  }
}
```

Hooks already follow "always return `{continue:true}`"; ports formalize that into a reusable degradation contract.

---

## 2. Per-Dependency Decoupling Plan

Swap difficulty 1 (trivial) → 5 (hard).

### 2.1 Claude CLI → `LLMProvider`  — difficulty **1**
- **Current coupling:** `execFileSync('claude', ['-p', prompt, '--model','haiku'])` inline in `daily-chat-greeting.mjs` and `daily-chat-summary.mjs`; model hardcoded; env var `CLAUDECODE` deleted manually.
- **Proposed boundary:** `ports/llm.mjs#invoke(prompt,{model,timeout})`; adapters `claude-cli`, `anthropic-sdk`, `ollama`, `template`.
- **Degradation when absent:** `template` adapter returns the existing deterministic fallback string (already exists inline today). Caller behavior unchanged.
- **Migration:** (a) extract current `execFileSync` block into `adapters/llm/claude-cli.mjs`; (b) add `adapters/llm/template.mjs` from the existing fallback; (c) replace the two call sites with `await invoke(...)`. ~2 files touched, fully isolated.

### 2.2 Google Calendar → `CalendarProvider` — difficulty **2**
- **Current coupling:** Bash MCP calls (`gcal_*` / `mcp__claude_ai_Google_Calendar__*`) inside `oncall*` skills; hardcoded calendar ID `c_b96d...@group.calendar.google.com`.
- **Proposed boundary:** `ports/calendar.mjs`; calendar ID moves to `config.providers.calendar.calendarId`. MCP boundary already exists, so this is a thin formalization.
- **Degradation when absent:** `noop` adapter → calendar sync becomes a no-op; oncall query still works from `SchedulePort`. Skill reports "calendar sync skipped (provider not configured)".
- **Migration:** parameterize calendar ID into config; document the port surface in the oncall SKILL.md files so the LLM calls the MCP tool through a documented contract rather than a hardcoded ID.

### 2.3 Gmail → `EmailProvider` — difficulty **2**
- **Current coupling:** `mcp__claude_ai_Gmail__*` driven from `scan-inbox` SKILL.md; query string in `config.inbox.sources.gmail.query`.
- **Proposed boundary:** `ports/email.mjs` (MCP-backed). Query/lookback already config-driven — only the provider selection is new.
- **Degradation when absent:** `noop` → scan-inbox proceeds with Chat-only source (the skill already iterates per-source). No crash; fewer candidates.
- **Migration:** define the `EmailProvider` surface in scan-inbox SKILL.md; add `providers.email.provider` to config with legacy inference (`inbox.sources.gmail.enabled` → `gmail`).

### 2.4 Google Chat (gws CLI) → `ChatProvider` — difficulty **3**
- **Current coupling:** `scripts/lib/gws.mjs` (`execSync` via bash, temp-file JSON), consumed by `daily-chat`, `daily-summary`, `scan-inbox`, `session-start`. Space ID in `config.googleChat.spaceId`.
- **Proposed boundary:** `ports/chat.mjs`; rename `gws.mjs` to `adapters/chat/google-chat.mjs` behind the port. Add `stdout` adapter (writes the message to the debug log) and `noop`.
- **Degradation when absent / `gws` unauthenticated:** port catches the throw and returns `{degraded:true}`; daily bookends + inbox reminders silently skip (matches current `googleChat.enabled:false` behavior). The `authStatus()` surface lets `status` skill surface "chat: not authenticated" instead of failing silently.
- **Migration:** `gws.mjs` already a clean wrapper — move it under `adapters/chat/`, wrap with `ports/chat.mjs`, repoint the 4 callers. `sendChatMessage` signature already matches the port surface.

### 2.5 Notion → `TaskProvider` — difficulty **3**
- **Current coupling:** dual boundary — direct `@notionhq/client`/REST in `notion-tasks.mjs`, `sprint-context.mjs`, `status-transitions.mjs`; plus MCP (`mcp__codepresso-notion__*`, `mcp__claude_ai_Notion__*`). DB IDs + Korean property names (`담당자`, `상태`) scattered. **ACL is critical here** (Decision 7: Sprint/Epic use `select`, Task uses `status` — different API shapes).
- **Proposed boundary:** `ports/task.mjs` owns the domain task model `{id,title,uniqueId,status,assignee,epicId}`. The Notion adapter is the **only** place that knows Korean property names and the `select`-vs-`status` shape difference. Adapters: `notion`, `local-json` (tasks in `.codepresso/state/tasks.json`), `noop`.
- **Degradation when absent:** existing behavior is already "fall through silently when Notion unconfigured" — formalize via `noop`/`local-json`. Hooks (`pre-tool-notion-inject`) call `query()`; empty result → no picker, no block. Cached schema/tasks in `.codepresso/state/*` act as the circuit-breaker/offline-mirror layer (already present with TTLs).
- **Migration:** (a) define domain model + port; (b) move property-name/type mapping (currently in `sprint-context.mjs PROPERTY_TYPES`) into `adapters/task/notion.mjs` as the ACL; (c) repoint `notion-tasks.mjs`, hooks, and the `codepresso-notion` MCP server to call the port (MCP server becomes a *thin* exposure of the port, eliminating the dual-boundary divergence); (d) ship `local-json` adapter for offline/no-key teams.

### 2.6 Figma → `DesignProvider` — difficulty **3**
- **Current coupling:** REST (curl + PAT from `.env`) and `mcp__claude_ai_Figma__*` in `scaffolding-from-figma`; file/node parsed from URL.
- **Proposed boundary:** `ports/design.mjs`; adapters `figma-mcp` (preferred) and `figma-rest`. PAT moves into config provider section (still secret, not committed).
- **Degradation when absent:** `noop` → scaffolding skill informs user "no design provider; supply tokens manually" and proceeds from the local design-system tokens file. Capability preserved, just degraded input.
- **Migration:** document the `DesignProvider` surface in the figma SKILL.md; centralize URL→`{fileKey,nodeId}` parsing in the port; move PAT to `providers.design.token`.

### 2.7 GitHub (gh CLI) → `VcsProvider` — difficulty **3**
- **Current coupling:** `gh` CLI throughout `git-utils.mjs`, `pre-tool-notion-inject.mjs`, `post-tool-git-watcher.mjs`, `handle-merge-transition.mjs`, `setup`, `deploy`.
- **Proposed boundary:** `ports/vcs.mjs`; adapter `gh-cli` first, `gitlab`/`gitea` later.
- **Degradation when absent:** `gh` unauthenticated → `authStatus()` reports it; PR-detection returns `null` (hooks already handle "no PR" by skipping comments/transitions). No crash.
- **Migration:** `git-utils.mjs` is already a focused wrapper — promote it to `adapters/vcs/gh-cli.mjs`, add `ports/vcs.mjs`, repoint 4 hook scripts. **Keep the 3s/5s hook budgets** — port adds no network calls beyond what `git-utils` already does.

### 2.8 AWS (DynamoDB + Lambda + EC2) → `SchedulePort` + `DevEnvProvider` — difficulty **4**
- **Current coupling:** hardcoded DynamoDB table `oncall-assignments-history`, Lambda name `oncall-allocator-stack-...-pQRyUZlV0CCh`, region `ap-northeast-2`, EC2 tag filters (`Purpose=cloud-dev-env`, `Email=<git-user>`). Spread across 5 oncall/cloud-dev skills + `cloud-dev-server.mjs` MCP.
- **Proposed boundary:** split into **two** ports.
  - `SchedulePort`: `getAssignments`/`saveAssignments` (DynamoDB) + `allocate` (Lambda). Adapters: `aws` (DDB+Lambda), `sqlite` (local store + local allocator function), `noop`.
  - `DevEnvProvider`: EC2 lifecycle. Adapters: `aws-ec2`, `docker`, `noop`. The `cloud-dev` MCP server becomes a thin exposure of `DevEnvProvider`.
- **Degradation when absent:** `SchedulePort` with no AWS → `oncall` skill reads last-known plan from `.codepresso/state/oncall-cache.json` (offline mirror) and labels it stale; `oncall-generate` reports "allocator unavailable". `DevEnvProvider` noop → cloud-dev skill says "no dev-env provider configured."
- **Migration:** (a) lift all hardcoded identifiers into `config.providers.schedule` / `config.providers.devenv`; (b) wrap existing AWS SDK calls into `adapters/schedule/aws.mjs` and `adapters/devenv/aws-ec2.mjs`; (c) define the allocator as a stateless contract so a `sqlite` local allocator can satisfy it; (d) repoint the 5 skills + MCP server. Highest effort due to identifier sprawl and multi-service coupling.

---

## 3. Existing Boundaries to Formalize vs. New Abstractions Needed

| Boundary today | Status | Action |
|---|---|---|
| `codepresso-notion` MCP server | Partial seam (parallel to direct SDK calls) | **Formalize** — make MCP server a thin exposure of `TaskProvider`; eliminate dual boundary |
| `cloud-dev` MCP server | Partial seam wrapping EC2 | **Formalize** — back it with `DevEnvProvider` |
| `gws.mjs` CLI wrapper | Clean single-purpose wrapper | **Formalize** — rename under `adapters/chat/`, add `ports/chat.mjs` |
| `git-utils.mjs` | Clean `gh` wrapper | **Formalize** — promote to `adapters/vcs/gh-cli.mjs` + `ports/vcs.mjs` |
| `config.mjs` two-level merge + `enabled:false` flags | Capability gating already present | **Reuse** — add `config.providers.<cap>.provider`; `inferLegacyProvider` reads existing flags |
| State caches with TTL (`codepresso-inbox-cache.json`, session/schema caches) | Offline-mirror/circuit-breaker layer already present | **Reuse** — extend to oncall + task caches as the degradation fallback |
| Google Calendar / Gmail (MCP, driven from SKILL.md) | MCP seam exists; no code abstraction | **New thin port** — `ports/calendar.mjs`, `ports/email.mjs`; document surface in SKILL.md |
| Claude CLI (inline `execFileSync` ×2) | No seam | **New abstraction** — `ports/llm.mjs` + adapters |
| Figma (curl PAT + MCP, in SKILL.md) | No code seam | **New abstraction** — `ports/design.mjs`, centralize URL parsing + PAT |
| AWS DDB/Lambda identifiers | Hardcoded in skills | **New abstraction** — `SchedulePort`; lift identifiers to config |

**Net:** ~4 boundaries already exist and just need formalizing (Notion-MCP, cloud-dev-MCP, gws, git-utils); 5 need new but thin ports (llm, calendar, email, design, schedule/devenv). No boundary requires a build step — all are ESM modules + dynamic `import()`.

---

## 4. Prioritized Sequence

Ordered by value-to-effort, each phase independently shippable and backward-compatible (legacy flags keep working via `inferLegacyProvider`).

**Phase 0 — Scaffolding (enables everything, ~half day)**
1. Add `scripts/ports/registry.mjs` (resolver + `inferLegacyProvider`) and `scripts/adapters/_noop.mjs`.
2. Add `config.providers` section to `config.mjs` defaults (all optional; legacy flags still authoritative when `providers` unset).
3. Add a port-contract section to CLAUDE.md so future skills call ports.

**Phase 1 — Easy wins, prove the pattern (difficulty 1–2)**
4. `LLMProvider` (claude-cli + template) — 2 isolated call sites.
5. `CalendarProvider` + `EmailProvider` — parameterize the hardcoded calendar ID; document MCP-backed ports in oncall/scan-inbox SKILL.md.

**Phase 2 — Formalize existing clean wrappers (difficulty 3)**
6. `ChatProvider` (move `gws.mjs` under adapters; add `stdout`/`noop`).
7. `VcsProvider` (promote `git-utils.mjs`; repoint 4 hooks — verify 3s/5s budgets).
8. `TaskProvider` (domain model + ACL for Notion `select`/`status`; collapse dual boundary; add `local-json`). Highest payoff: it's the most-used and most-coupled capability.

**Phase 3 — Design + heavy AWS (difficulty 3–4)**
9. `DesignProvider` (figma-mcp + figma-rest; centralize URL parsing/PAT).
10. `SchedulePort` + `DevEnvProvider` (lift AWS identifiers to config; `aws` + `sqlite`/`docker` + `noop`; back the MCP server). Last because of identifier sprawl and multi-service coupling.

**Cross-cutting (do alongside Phase 2):** centralize all secrets/service IDs into `config.providers.*` so the "config fragmentation" issue (PAT in `.env`, IDs hardcoded in skills) is resolved as ports land.

---

### Pragmatic guardrails for this `.mjs`/no-build plugin
- Ports/adapters are plain ESM modules; **dynamic `import()`** guarantees an absent SDK never loads → graceful degradation is structural, not defensive.
- Every port returns `{degraded:true,...}` instead of throwing, preserving the "hooks always `{continue:true}`" invariant.
- `inferLegacyProvider` = **zero forced migration**; teams opt into explicit `providers.*` selection only when they want to swap.
- The `status` skill gains an `authStatus()`/availability probe per port — turning today's silent degradation into observable diagnostics (the one weakness of graceful fall-through).

**Files that already exist and map directly to adapters:** `scripts/lib/gws.mjs` → `adapters/chat/google-chat.mjs`; `scripts/lib/git-utils.mjs` → `adapters/vcs/gh-cli.mjs`; `scripts/lib/notion-tasks.mjs` + `sprint-context.mjs` + `status-transitions.mjs` → `adapters/task/notion.mjs`; `mcp/cloud-dev-server.mjs` → backed by `adapters/devenv/aws-ec2.mjs`; `mcp/notion-server.mjs` → thin exposure of `ports/task.mjs`.


---

## 4. 적용 후 플러그인 지원 범위 요약  *(파트 4)*

# Codepresso Plugin — Supported Scope

**An AI-native product-management & operations layer for Claude Code.** It turns the IDE session into the place where intent becomes shipped, monitored software — wiring Notion (work tracking), GitHub (delivery), AWS/Google (operations), and Figma (design intake) into one governed AI-DLC loop. Runs alongside oh-my-claudecode with zero conflict. v0.2.15, Node 20+, zero-build ESM.

---

## 1. Positioning Statement

Codepresso is not a coding assistant — it is the **PM/ops control plane** that the coding assistant runs inside. It encodes a team's *workflow* (six-stage AI-DLC: Intent → Spec → Plan → Build → Verify → Operate) as always-on hooks, interactive skills, and provider-backed MCP tools, so that:

- **Work is traceable end-to-end:** a Notion task (`TSK-XXXX`) is the unit of work; the plugin enforces it into the PR title, comments commits onto the PR, and cascades the merge back to task/epic completion — no manual status hygiene.
- **Operations are first-class:** on-call rotation (allocate/swap/sync), gated deploys, daily team bookends, and inbox-to-task triage live in the same surface as code.
- **Knowledge compounds:** epic PRDs, scoped specs/plans, and a personal LLM Wiki capture the "why" beside the work.

After the planned changes it becomes **AI-DLC-complete** (closes the Spec/Plan/Verify gaps) and **provider-neutral** (every SaaS is swappable behind a capability port, degrading gracefully when absent).

---

## 2. Capability Map by AI-DLC Stage

Legend: ✅ shipped · 🟡 partial/generic · ⬜ gap (planned)

| Stage | Current capability | After planned changes |
|---|---|---|
| **1. Intent** (WHAT/WHY) | ✅ `generate-epic` (Notion epic → PRD); ✅ `scan-inbox` (Gmail+Chat → tasks w/ due dates); ✅ `notion_sprint_context` MCP | ➕ Intent→Units-of-Work decomposition helper (epic → candidate task-slices + clarifying questions) |
| **2. Spec** (validated requirements) | 🟡 PreToolUse task picker selects active `TSK-XXXX`; 🟡 generic `superpowers:brainstorming` | ➕ `codepresso:spec` skill scaffolding `docs/superpowers/specs/<date>-<slug>-design.md` with **EARS acceptance criteria** |
| **3. Plan** (HOW, logical) | 🟡 generic `omc:plan`/`ralplan`; 🟡 ADR template absent | ➕ `codepresso:plan` skill wired to `docs/superpowers/plans/` convention; ➕ **ADR-needed detector** + `docs/decisions/` discipline |
| **4. Build** (generate) | ✅ PreToolUse `[TSK-XXXX]` PR-title enforcement + no-task pick/create gate; ✅ `post-tool-git-watcher` commit comments; ✅ `scaffolding-from-figma`; ✅ `cloud-dev` | ➕ codepresso-native TDD + submodule-aware build orchestration (today via generic skills) |
| **5. Verify** (human + adversarial) | 🟡 merge detection; 🟡 generic `code-review`/`security-review`; CI gates live in monorepo | ➕ codepresso `verify` pre-merge gate (adversarial subagent review + quoted evidence), analogous to the PR-title block |
| **6. Operate** (deploy & monitor) | ✅ `deploy` (ECS/CodePipeline/workflow); ✅ full `oncall` suite (query/generate/swap/sync/seed/runbook); ✅ `daily-chat`/`daily-summary`; ✅ merge→Notion-complete→epic-cascade | ➕ post-deploy smoke/health-check verification; ➕ auto-ADR prompt after infra ships |

**Strongest today:** Stages 1, 4, 6 (the lifecycle *ends* are automated). **Weakest today:** Stages 2, 3, 5 (the *middle* relies on generic skills, not codepresso-native gates).

---

## 3. In-Scope vs. Out-of-Scope

**In scope (what the plugin owns):**
- Work-item lifecycle & traceability (Notion task ⇄ PR ⇄ merge ⇄ epic cascade)
- Sprint visibility (dashboard, retro, sprint context)
- Operations: on-call scheduling, gated deploy, daily Google Chat bookends, inbox→task triage
- Design intake (Figma → scaffold) and dev-env control (cloud EC2)
- Durable knowledge: epic PRDs, scoped specs/plans, personal LLM Wiki
- Always-on context injection via three silent hooks; deterministic state/CLI for all side effects

**Explicitly out of scope (delegated or not the plugin's job):**
- General-purpose agent orchestration, parallelism, planning engines → **oh-my-claudecode** owns these
- Writing the actual application code → the host coding assistant does this; the plugin governs *around* it
- Being the source of truth for tasks/PRs/schedules → Notion / GitHub / DynamoDB remain canonical; the plugin syncs, never replaces
- CI execution itself → lives in the monorepo's GitHub Actions; the plugin references gates, doesn't run them
- Monorepo-shaped artifacts in *this* repo (codesight per-submodule index, coordinated-deploy automation) → belong to the platform monorepo, N/A here

---

## 4. Provider-Abstraction Surface (Swappable SaaS)

Each capability is a **port**; today's vendor is one adapter; absence falls through to a `noop`/local adapter. Legacy config flags auto-select the current provider (zero forced migration).

| Capability port | Current provider | Swappable to | Degraded (absent) |
|---|---|---|---|
| `TaskProvider` | Notion (SDK + MCP) | Linear, Airtable, local-JSON | no picker, no block — silent |
| `ChatProvider` | Google Chat (`gws`) | Slack, Teams, stdout | bookends/reminders skipped |
| `CalendarProvider` | Google Calendar (MCP) | Outlook, local-ICS | calendar sync no-op |
| `EmailProvider` | Gmail (MCP) | Outlook, IMAP | Chat-only inbox scan |
| `DesignProvider` | Figma (PAT + MCP) | Penpot, local tokens | manual token entry |
| `VcsProvider` | GitHub (`gh`) | GitLab, Gitea | no PR ops — silent |
| `LLMProvider` | Claude CLI | Anthropic SDK, Ollama, template | deterministic fallback string |
| `SchedulePort` | AWS DynamoDB + Lambda | Postgres/SQLite + local allocator | last-known plan (stale-labeled) |
| `DevEnvProvider` | AWS EC2 (MCP) | Docker, K8s | "no dev-env provider" |

Always required: `gh` CLI. Everything else is optional and gated `enabled:false`.

---

## 5. Roadmap — Gaps to Close (ordered)

Ordered by value ÷ effort. Items 1–4 raise AI-native compliance from ~60% → ~83% and harden the governance layer; 5–6 complete the AI-DLC middle.

1. **`AGENTS.md` at root** (~30 min) — cross-tool entry point; the plugin ships Codex support but has no `AGENTS.md`. Highest value/effort.
2. **CI gate on `pull_request`** (~15 min) — tests run only on push-to-`master` today; add a PR trigger so behavior changes get a verdict *before* merge. Biggest safety gap.
3. **`docs/decisions/` ADRs** (~1 hr) — migrate the "Key Design Decisions #1–#12" from `CLAUDE.md` into dated, append-only ADRs; add **ADR-needed detector**.
4. **`docs/ai-agent-policy.md` + `documentation-policy.md`** — codify the real traps (`additionalContext` must nest in `hookSpecificOutput`; write stdout before side-effects) and the doc-lifetime categories.
5. **`codepresso:spec` + `codepresso:plan` skills** — the biggest *lifecycle* hole: scaffold specs (EARS criteria) and plans into `docs/superpowers/`, closing the Inception→Construction handoff (Stages 2–3).
6. **`codepresso:verify` pre-merge gate** + post-deploy smoke check — plugin-enforced adversarial review with quoted evidence (Stage 5) and health-check confirmation (Stage 6).

**Parallel track — provider decoupling** (independently shippable, backward-compatible): Phase 0 registry/`noop` scaffolding → Phase 1 `LLMProvider`/`Calendar`/`Email` → Phase 2 `Chat`/`Vcs`/`Task` → Phase 3 `Design`/`Schedule`/`DevEnv`. Lands provider-neutrality without a build step; centralizes scattered secrets/IDs into `config.providers.*`.


---

## 5. 리서치 검증 상세 (적대적 팩트체크 2명)
> AI-DLC·프레임워크 주장의 1차 출처 교차검증. 결론: 할루시네이션 없음, 경미한 용어 정정만.

# Skeptic Fact-Check: AI-DLC & Agentic SDLC Frameworks Research

Verification date: 2026-05-31. Method: fresh WebSearch + WebFetch against primary sources (AWS blogs, awslabs repo, vendor docs, Anthropic docs). Default verdict where unconfirmed = UNVERIFIED.

## Part 1 — AWS AI-DLC

| # | Claim | Verdict | Notes / Correction | Source |
|---|-------|---------|--------------------|--------|
| 1 | AI-DLC has exactly 3 phases: Inception, Construction, Operations | **VERIFIED** | Confirmed verbatim in primary AWS DevOps blog. | [aws.amazon.com/blogs/devops/ai-driven-development-life-cycle](https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/) |
| 2 | Inception uses "Mob Elaboration" ritual | **VERIFIED** | Named ritual confirmed in primary blog. | same |
| 3 | Construction uses "Mob Construction" ritual | **VERIFIED** | Confirmed. | same |
| 4 | Sprints → "Bolts" (hours/days) | **VERIFIED** | Exact term and "hours or days rather than weeks" framing confirmed. | same |
| 5 | Open-sourced as Amazon Q Rules + Kiro Steering Files at github.com/awslabs/aidlc-workflows | **VERIFIED** | Confirmed in open-sourcing blog + repo. | [open-sourcing blog](https://aws.amazon.com/blogs/devops/open-sourcing-adaptive-workflows-for-ai-driven-development-life-cycle-ai-dlc/) |
| 6 | Repo supports 7 assistants with the listed tool-specific files (Kiro `.kiro/steering/`, Q `.amazonq/rules/`, Cursor `.cursor/rules/`, Cline `.clinerules/`, Claude Code `CLAUDE.md`, Copilot `.github/copilot-instructions.md`, Codex `AGENTS.md`) | **VERIFIED** | All seven and their paths confirmed against the repo. | [github.com/awslabs/aidlc-workflows](https://github.com/awslabs/aidlc-workflows) |
| 7 | Artifacts written to `aidlc-docs/` | **VERIFIED** | Confirmed in repo README/docs. | same |
| 8 | Presented at re:Invent 2025, session DVT214 | **VERIFIED** | Session code confirmed. (Treat the DEV.to recap as a third-party transcript, not AWS-published, but the code itself is correct.) | [dev.to/kazuya_dev DVT214](https://dev.to/kazuya_dev/aws-reinvent-2025-introducing-ai-driven-development-lifecycle-ai-dlc-dvt214-32b) |
| 9 | "Plan-Verify-Generate" cycle with human validation at each stage | **PARTIALLY VERIFIED** | The *concept* (AI plans → asks clarifying questions → implements only after human validation; humans understand each line) is verified in the AWS blog. The **exact label "Plan-Verify-Generate" does NOT appear in the primary AWS blog** — it is a paraphrase. Present the mechanism as AWS-sourced but flag the three-word term as not-verbatim. | AWS blog |
| 10 | "Units of Work" replace Epics; independently valuable/buildable/testable/deployable slices | **VERIFIED** | Epics→Units of Work confirmed; "deployable in isolation" framing supported. | AWS blog |

### AI-DLC — uncertain claims from the original (re-checked)

- **Agent/IDE/model-agnostic claim → VERIFIED, and the original research was RIGHT.** The repo and its README explicitly state AI-DLC "works with any IDE, agent, or model." (One of my own intermediate WebFetches of the open-sourcing blog mischaracterized it as "not agnostic" — that read was wrong; the repo and broader sources confirm agnosticism, though it currently requires shell access and is validated mainly with Kiro/Claude Code/Cursor/Antigravity.)
- **Quantitative outcomes (Wipro 10-15x productivity, sprint predictability ~20% → 80%+) → flag was MISLEADING; correction needed.** These claims ARE made by AWS speakers in the DVT214 session itself, attributed to AWS's own customer engagements (Wipro, Dun & Bradstreet) — not merely a "third-party recap." So they are *AWS-stated*, but remain **self-reported / un-audited marketing metrics**. The DVT214 session also cites contradicting independent research (ThoughtWorks ~10-15% velocity gains; a METR/meter.org study finding AI users 20% *less* productive while self-reporting +23%). Recommendation: cite as "AWS-claimed customer outcomes," note they are unaudited, and acknowledge contradicting independent data.
- **Specific Inception sub-stage names / "nine stages" / "six stages" → UNVERIFIED.** Correctly flagged in the original. Not found verbatim in primary AWS prose; come from third-party blogs (smileshark, DEV). Keep flagged. The repo does organize rule-details into `common/inception/construction/extensions/operations`, but that is not the same as a named six- or nine-stage list.
- **State files:** repo tracks progress via `aidlc-state.md` and immutable `audit.md` (corroborating detail, not in original summary).

## Part 2 — Agentic / AI-Native SDLC Frameworks

| # | Claim | Verdict | Notes / Correction | Source |
|---|-------|---------|--------------------|--------|
| 1 | Spec Kit core = 5 commands (constitution, specify, plan, tasks, implement) + optional clarify, analyze | **VERIFIED** | All present; also confirmed `/speckit.taskstoissues`. | [github.com/github/spec-kit](https://github.com/github/spec-kit) |
| 2 | `/speckit.plan` produces multiple files (plan.md, data-model.md, api-spec.json, research.md) | **VERIFIED** | Confirmed; note api-spec.json sits under `contracts/` and quickstart.md is also produced. | same |
| 3 | Kiro generates exactly 3 spec files: requirements.md, design.md, tasks.md | **VERIFIED** | Confirmed (requirements.md may be `bugfix.md` for bug specs — minor nuance). | [kiro.dev/docs/specs](https://kiro.dev/docs/specs/) |
| 4 | Kiro requirements.md uses EARS; EARS originated at Rolls-Royce | **VERIFIED** | EARS usage confirmed on Kiro feature-specs page; Rolls-Royce origin (Alistair Mavin, ~2009) confirmed via official EARS guide. | [kiro.dev feature-specs](https://kiro.dev/docs/specs/feature-specs/), [alistairmavin.com/ears](https://alistairmavin.com/ears/) |
| 5 | Kiro "Quick Plan" auto-generates all 3 artifacts without approval gates; default flow inserts gates | **VERIFIED** | Confirmed verbatim. | [kiro.dev/docs/specs](https://kiro.dev/docs/specs/) |
| 6 | BMAD = two phases (planning brief→PRD→arch, then SM/Dev story loop); supports ChatGPT/Gemini web bundles then IDE import | **VERIFIED** | Confirmed. Web bundles = "Gemini Gems / ChatGPT Custom GPTs." Minor: 12+ personas referenced; the full persona list (Analyst/PM/Architect/PO/SM/Dev/QA/UX/Orchestrator) is plausible but the README only enumerates a subset — treat exact 9-role list as **PARTIALLY VERIFIED**. | [github.com/bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) |
| 6b | "BMAD" stands for "Breakthrough Method of Agile AI-Driven Development" | **PARTIALLY VERIFIED** | Official expansion is "Breakthrough Method **for** Agile AI Driven Development" (for, not of). Minor wording error. | same |
| 7 | Agent OS = exactly 3 context layers: Standards, Product, Specs | **VERIFIED** | Confirmed verbatim with the how/what-why/what-next definitions. | [buildermethods.com/agent-os/v2/3-layer-context](https://buildermethods.com/agent-os/v2/3-layer-context) |
| 8 | Anthropic recommends "Explore → Plan → Code → Commit" + a separate subagent code-reviewer before commit | **VERIFIED** | Confirmed verbatim: "The recommended workflow has four phases" (Explore/Plan/Implement/Commit) and an "adversarial review step" via a fresh subagent / `/code-review` skill. Note the labels are "Explore, Plan, **Implement**, Commit" — "Code" is a fair synonym for the Implement step. | [code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices) |

### Conflation / accuracy check (the specific risk flagged in the task)

- **AWS AI-DLC is NOT conflated with generic "AI SDLC" in this research** — the summary correctly anchors to AWS's specific methodology (Inception/Construction/Operations, Bolts, Units of Work, Mob rituals, the awslabs repo). No conflation found. One caution worth surfacing to readers: there are **two distinct things sharing the "AI-DLC" abbreviation** in the wild (AWS's "AI-Driven Development **Life Cycle**" vs. occasional "AI Development Lifecycle" usages); the research stays correctly on the AWS one.
- **Kiro characterization** ("VS Code fork, Claude-backed, released 2025, spec-driven by default") — **VERIFIED** as broadly accurate against vendor/press coverage; not separately challenged here as it was not a numbered falsifiable claim.

## Bottom line for the author

Nothing is **REFUTED**. Two items need wording fixes before citing as fact:
1. **"Plan-Verify-Generate"** — keep the mechanism (AWS-sourced) but drop or hedge the exact three-word label (not in the AWS blog).
2. **"BMAD = Breakthrough Method *of*..."** → change "of" to "for."

Two flags in the original were **overcautious / should be upgraded**:
- The **agent-agnostic** claim is solidly TRUE (don't hedge it).
- The **Wipro 10-15x / 20%→80%** metrics are **AWS-stated** (in DVT214), not merely third-party recap — but should be labeled **self-reported and unaudited**, ideally paired with the contradicting ThoughtWorks/METR data that AWS itself cited.

Two items remain **UNVERIFIED** and should stay flagged: the **named Inception sub-stages** and any **"six/nine stages" count** (third-party only), and the **exact 9-persona BMAD roster** (README enumerates only a subset).

Sources:
- https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/
- https://aws.amazon.com/blogs/devops/open-sourcing-adaptive-workflows-for-ai-driven-development-life-cycle-ai-dlc/
- https://github.com/awslabs/aidlc-workflows
- https://dev.to/kazuya_dev/aws-reinvent-2025-introducing-ai-driven-development-lifecycle-ai-dlc-dvt214-32b
- https://github.com/github/spec-kit
- https://kiro.dev/docs/specs/
- https://kiro.dev/docs/specs/feature-specs/
- https://alistairmavin.com/ears/
- https://github.com/bmad-code-org/BMAD-METHOD
- https://buildermethods.com/agent-os/v2/3-layer-context
- https://code.claude.com/docs/en/best-practices

---

All claims are now independently verified. The "plan-verify-generate" finding nuance is resolved: the exact phrase is not in the primary AWS blog, but the loop concept (plan → verify → generate, with human approval) IS accurately described in AWS sources. Here is my independent skeptic report.

---

# SKEPTIC #2 — Independent Re-Verification Report

Verified from fresh web sources without relying on Skeptic #1. Verdict up front: **the research summary is overwhelmingly accurate.** AI-DLC is genuinely an AWS-published methodology with the exact three phases claimed, and the named comparison frameworks (Spec Kit, Kiro, BMAD, Agent OS, Anthropic EPCC) are all real and described accurately. I found **no fabricated frameworks and no merged/hallucinated concepts.** A handful of attribution nuances are below.

## Core question: Is AI-DLC genuinely AWS, with these phases? — YES (HIGH confidence)

- **Three phases — Inception / Construction / Operations: CONFIRMED.** Verified verbatim against the awslabs/aidlc-workflows repo itself: "INCEPTION PHASE (WHAT to build and WHY)", "CONSTRUCTION PHASE (HOW to build it)", "OPERATIONS PHASE (Deployment and monitoring (future))". This is a primary AWS-owned source, not a recap.
- **AWS-published: CONFIRMED.** Two AWS DevOps blog posts plus the awslabs org repo plus a re:Invent 2025 session. Genuinely AWS, genuinely a methodology delivered as rule/steering files (not a product).
- **Operations is a placeholder/"future": CONFIRMED** by the repo ("(future)"). The research summary described Operations with concrete artifacts (IaC, deployment, monitoring) — this is *aspirational/described intent*, correctly flagged in the summary as the phase's purpose, but readers should know the repo currently treats it as a stub.

## Per-claim verification

| # | Claim | Verdict | Confidence |
|---|-------|---------|-----------|
| 1 | Three phases: Inception, Construction, Operations | CONFIRMED (repo verbatim) | HIGH |
| 2 | "Mob Elaboration" in Inception | CONFIRMED (AWS blog verbatim) | HIGH |
| 3 | "Mob Construction" in Construction | CONFIRMED (AWS blog verbatim) | HIGH |
| 4 | "Bolts" replace sprints (hours/days) | CONFIRMED verbatim: "Traditional 'sprints' are replaced by 'bolts'" | HIGH |
| 5 | Open-sourced via Q Developer Rules + Kiro Steering at awslabs/aidlc-workflows | CONFIRMED | HIGH |
| 6 | 7 assistants supported (Kiro, Q, Cursor, Cline, Claude Code, Copilot, Codex) | CONFIRMED (repo lists all 7) | HIGH |
| 7 | Artifacts written to `aidlc-docs/` | CONFIRMED (repo verbatim) | HIGH |
| 8 | Presented at re:Invent 2025, session DVT214 | CONFIRMED (AWS Events / Class Central / multiple) | HIGH |
| 9 | Plan→Verify→Generate human-in-loop cycle | CONFIRMED conceptually; see nuance below | MEDIUM-HIGH |
| 10 | "Units of Work" replace Epics | CONFIRMED verbatim: "Epics are replaced by Units of Work" | HIGH |

## Corrections / nuances (the only things to fix)

1. **"Plan-Verify-Generate" is a coined label, not verbatim AWS terminology.** The primary AWS DevOps blog does NOT use the exact phrase "Plan-Verify-Generate." It describes the loop as "AI creates a plan, asks clarifying questions to seek context, and implements solutions," with mandatory human approval gates between phases. Third-party writeups (eleks) do paraphrase it as "plan that stage, verify and generate the output, then verify and validate." So the *concept* is accurate and AWS-grounded, but the hyphenated term should be presented as a descriptive summary, not an AWS-official name. The research summary's own claim #9 slightly overstates by citing it to the AWS blog. **Severity: low.**

2. **Inception/Construction sub-stage names — UPGRADE from "uncertain" to "largely confirmed."** The research summary hedged these as third-party-only. My independent check of the awslabs repo confirms the Inception activities (Requirements analysis and validation, User story creation, Application Design, Risk assessment) and Construction activities (Detailed component design, Code generation and implementation, Build configuration and testing, QA/validation). The *exact six-stage enumeration* with names like "Workspace Detection" and "Reverse Engineering" appears in the repo's workflow files and corroborating writeups — so it is better-supported than the summary implied, though the precise count ("six"/"nine") is still a third-party framing. **Net: the summary was appropriately cautious; reality is somewhat more confirmed.**

3. **Quantitative outcomes (Wipro "10-15x", "3 months → 20 hours", Dun "48 hours") — third-party only, as the summary correctly flagged.** Independently I confirm these trace to the re:Invent DVT214 talk recap (kazuya_dev/AntStack), NOT to an AWS-authored written page. The "20% → 80%+ sprint predictability" figure I could not independently confirm at all — the predictability concept is mentioned (committed-vs-delivered sprints), but the specific percentages should be treated as **unverified**. Keep these out of any "AWS-official" framing. **Severity: medium if cited as official; low otherwise.**

## Comparison frameworks — all real, all accurate (HIGH confidence)

- **GitHub Spec Kit: CONFIRMED.** 5 core commands (constitution, specify, plan, tasks, implement) + optional clarify/analyze, plus `taskstoissues`. The claim that `/speckit.plan` emits multiple files (plan.md, data-model.md, contracts/api-spec.json, research.md, quickstart.md) is **verified verbatim** from the repo docs.
- **AWS Kiro: CONFIRMED.** Three spec files (requirements.md / design.md / tasks.md); EARS notation ("WHEN…THE SYSTEM SHALL…"), Rolls-Royce origin — all confirmed. Steering files + hooks confirmed.
- **BMAD-METHOD: CONFIRMED.** Two phases (planning → SM/Dev story cycle); agent personas (Analyst, PM, Architect, PO, Scrum Master, Dev, QA, Orchestrator); web-UI planning → IDE handoff — all confirmed. (Minor: expansion is "Breakthrough Method for Agile AI-Driven Development" — the summary's gloss is fine.)
- **Builder Methods Agent OS: CONFIRMED.** Exactly three context layers (Standards / Product / Specs); plan-product produces mission.md, roadmap.md, tech-stack.md — confirmed. (Note: the summary's stage names "shape-spec → write-spec → create-tasks" match the v2 docs; v3 exists but doesn't invalidate the claim.)
- **Anthropic EPCC + Skills: CONFIRMED.** Explore→Plan→Code→Commit is Anthropic's official recommended workflow; separate subagent code-reviewer before commit confirmed.

## No hallucinations detected
No invented frameworks. No two frameworks merged into one. No misattributed features (e.g., EARS correctly to Kiro not Spec Kit; Bolts/Units correctly to AI-DLC not the others; 3-layer context correctly to Agent OS). The one terminology overreach ("Plan-Verify-Generate" as if AWS-official) is minor.

## Sources (independently fetched)
- https://github.com/awslabs/aidlc-workflows (AWS primary — repo)
- https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/ (AWS primary)
- https://aws.amazon.com/blogs/devops/open-sourcing-adaptive-workflows-for-ai-driven-development-life-cycle-ai-dlc/ (AWS primary)
- https://aws.amazon.com/blogs/devops/building-with-ai-dlc-using-amazon-q-developer/ (AWS primary)
- https://eleks.com/blog/aws-ai-dlc-explained/ (third-party, "plan-verify-generate" phrasing)
- https://dev.to/kazuya_dev/aws-reinvent-2025-introducing-ai-driven-development-lifecycle-ai-dlc-dvt214-32b (DVT214 recap — productivity numbers)
- https://www.antstack.com/talks/reinvent25/aws-reinvent-2025---introducing-ai-driven-development-lifecycle-ai-dlc-dvt214/ (DVT214 corroboration)
- https://github.com/github/spec-kit and https://github.github.com/spec-kit/quickstart.html
- https://kiro.dev/docs/specs/feature-specs/ and https://kiro.directory/tips/ears-format
- https://github.com/bmad-code-org/BMAD-METHOD
- https://buildermethods.com/agent-os/v2/3-layer-context
- https://code.claude.com/docs/en/best-practices and https://code.claude.com/docs/en/sub-agents


---

## 6. 적대적 비판 전문 (신뢰성 검토)
> 자체 비판 에이전트의 원문. §0의 정정은 여기서 도출됨.

# Adversarial Critique — AIDLC/Monorepo/Decoupling/Scope Deliverables

## CRITICAL

**C1. A live Notion API secret is sitting in `.claude/settings.local.json` and the scorecard credits it as "Present" without flagging the leak.**
- Section: Monorepo Scorecard, item #10 ("Permission matrix — Present").
- Evidence: `.claude/settings.local.json` contains `Bearer ntn_53440_REDACTED` embedded in two `Bash(curl ...)` allow entries, plus a Notion DB ID and a user UUID.
- The scorecard inspected this exact file (it cites the `permissions` block and notes it's `settings.local.json`) yet missed a hardcoded credential in it. A skeptical staff engineer reviewing this would treat that as a disqualifying miss: the deliverable's whole job is to assess governance/security posture, and it walked past a plaintext token. Recommendation #6 ("add a pre-push secrets check") is darkly ironic — there is already a secret to catch.
- Fix: Rotate the token immediately. Flag item #10 as a finding, not a clean "Present." The secret is not committed (good — see C2), but it exists on disk and was reproduced verbatim into reasoning context.

## HIGH

**H1. The decoupling doc fabricates a precise hardcoded Lambda ARN/calendar ID that I could not find in the codebase.**
- Section: Decoupling §2.8 and §2.2.
- §2.8 claims Lambda name `oncall-allocator-stack-...-pQRyUZlV0CCh` and §2.2 claims calendar ID `c_b96d...@group.calendar.google.com` are "hardcoded" in skills/scripts. Grep for `oncall-allocator`, `c_b96d`, and `pQRyUZlV0CCh` across `scripts/ skills/ mcp/` returns nothing. What *does* exist: `oncall-assignments-history` and `ap-northeast-2` in `skills/oncall-seed-metadata/SKILL.md` and `scripts/lib/config.mjs`. So the DynamoDB-table and region claims are real; the specific Lambda ARN and calendar ID are unverified and presented with false precision. Citing a specific resource identifier you didn't confirm is exactly the "should/seems" anti-pattern the AIDLC doc itself preaches against (Stage 5).
- Fix: Either cite the real location of those identifiers or downgrade to "AWS identifiers including a Lambda name and calendar ID are scattered across oncall skills (verify exact strings before lifting)."

**H2. Scorecard arithmetic is visibly broken and "self-corrected" in-place, which destroys trust in the 60% headline.**
- Section: Monorepo Scorecard, Part 2 tally + Part 3.
- The first tally says "Missing: 4 (items 1, 4, 6, 8, 15) → that's 5 missing; recount below." It lists four item numbers, claims four, then says five, then recounts. A staff engineer doesn't want to watch the author do mental arithmetic in the deliverable. The final numbers (Present 8, Partial 2, Missing 5) happen to be internally consistent (8+2+5=15), but item #3 is simultaneously described as "N/A → Partial" in the table and "N/A, excluded" in the tally — pick one.
- Separately: the Present list in the prose is "items 2, 5, 7, 9, 10, 12, 14, 16" = 8 items, but #10 should not be a clean Present given C1, and #11 is scored Partial while the body text calls it "mis-placed" (effectively closer to Missing for the *PR-gate* purpose).
- Fix: Delete the visible recount. Re-score #10 down. State the rule once and apply it.

**H3. Verified-true claims are real, but the doc overclaims they were "verified verbatim against AWS sources."**
- Section: AIDLC "How this maps to AWS AI-DLC" — "(all verified verbatim against AWS sources)."
- The doc both claims verbatim verification AND later admits in "Refuted/hedged claims" that "Plan-Verify-Generate is not AWS-verbatim" and that the three-phase→six-stage expansion is the team's own invention. You cannot say "all verified verbatim" and then enumerate the non-verbatim parts. This is internally contradictory. The honest framing is in the footer; the header overclaims.
- Fix: Change header to "key terms (Inception/Construction/Operations, Bolts, Units of Work) verified against AWS sources; the six-stage expansion and loop name are ours."

## MEDIUM

**M1. CI-gate scoring is correct in spirit but the evidence is thin and the fix is overstated as "~15 min."**
- Section: Scorecard #11 + Roadmap item 2.
- Verified: `release.yml` triggers only on `push: branches:[master]` and does run `npm test` (line 24). So "Partial / mis-placed" is fair. But "add a `pull_request` trigger, ~15 min" understates it: the release workflow has `permissions: contents: write` and release/publish steps; you cannot simply add `pull_request` to it without running release logic on PRs. The honest fix is a *separate* `ci.yml` for PRs, which the doc mentions parenthetically but then prices as a 15-minute trigger edit.
- Fix: Price it as "new `ci.yml`, ~30 min," not a trigger toggle.

**M2. "EARS acceptance criteria — the single most rigorous, auditable pattern across the surveyed frameworks" is an unsupported superlative / cargo-culted endorsement.**
- Section: AIDLC §Stage 2 and Gap list item 2.
- "Single most rigorous" is an editorial claim about five frameworks with no comparison criteria. EARS is a requirements-phrasing convention from avionics; calling it the most auditable pattern across Spec Kit/Kiro/BMAD/Agent OS is opinion dressed as finding. For a no-build .mjs plugin whose specs are hand-written markdown, mandating "WHEN/THE SYSTEM SHALL" phrasing is process-heavy with no enforcement mechanism — it will be ignored. This is cargo-culting an aerospace standard into a 9-skill plugin.
- Fix: Drop the superlative. Recommend EARS as *one optional* template, not "the first hard human gate."

**M3. AIDLC Stage→artifact mapping claims artifacts that live in a different repo, blurring the same line the scorecard was careful about.**
- Section: AIDLC §(2) artifact table, Stages 4–6.
- Stage 4 cites "Submodule repos (`backend/*`, `frontend/*`, `infra`, `tests`)"; Stage 5 cites `.github/workflows/e2e-on-pr.yml` + `schema-validate-preflight.yml`; Stage 6 cites `coordinated-deploy.yml` + `unified-release.yml` and `docs/oncall-runbook.md`. None of these exist in *this* repo (only `release.yml` exists in `.github/workflows/`; `git ls-files` shows no submodules, no `docs/oncall-runbook.md`). The Monorepo deliverable is explicitly honest that those are sibling-monorepo artifacts; the AIDLC deliverable silently maps the plugin's lifecycle onto monorepo artifacts as if they were local "existing homes." Section (2)'s header literally says "where it lives (existing home)" — they don't exist here.
- Fix: Add the same honesty note the Monorepo doc has: these artifact homes are in `code-presso/monorepo`, not this repo. Or scope the AIDLC table to the monorepo explicitly.

**M4. `docs/oncall-runbook.md` is referenced as an existing artifact in three deliverables but is not in this repo.**
- Sections: AIDLC §(2) Stage 6 and §(3) Stage 6 ("`docs/oncall-runbook.md`"); Scope §2 Stage 6.
- The skill `codepresso:oncall-runbook` exists and its SKILL.md *describes* navigating `docs/oncall-runbook.md`, but the file itself is not tracked here (it's a monorepo artifact). Citing it as plugin-side evidence of "full Operate coverage" inflates Stage-6 completeness.
- Fix: Clarify the runbook *content* lives in the monorepo; the plugin ships only the navigation skill.

**M5. Decoupling §2.7 asserts "port adds no network calls beyond what `git-utils` already does" and "keep the 3s/5s budgets" — plausible but unverified, and dynamic `import()` adds real latency in a 3s PreToolUse hook.**
- Section: Decoupling §2.7, §4 Phase 2, and "Pragmatic guardrails."
- The architecture routes every hook call through `resolveProvider()` → `await loader()` (dynamic `import()`) → `createAdapter()`. The CLAUDE.md performance rule is explicit: "PreToolUse hook MUST complete in <3s — stdin parse + file reads only." Adding async module resolution + adapter instantiation on the hot path of `pre-tool-notion-inject.mjs` / `post-tool-git-watcher.mjs` is the one place the no-build/dynamic-import story has a real cost, and the doc waves it away ("adds no network calls") without measuring import overhead or config re-reads. `resolveProvider` also calls `loadConfig()` per invocation by default.
- Fix: Acknowledge import + config-load overhead on the hook hot path; cache resolved adapters per process; benchmark before repointing the two PreToolUse-budgeted hooks.

**M6. The "MCP server becomes a thin exposure of the port" proposal is impractical for the stdio MCP process model and is hand-waved.**
- Section: Decoupling §2.5(c), §2.8, §3 ("Formalize").
- `mcp/notion-server.mjs` and `mcp/cloud-dev-server.mjs` are separate processes spawned by Claude Code via `.mcp.json`, not in-process callers of the hook scripts. Making them "thin exposures of `ports/task.mjs`" means the MCP server imports the port, which imports the registry, which dynamic-imports the Notion adapter — fine — but the doc frames this as "eliminating the dual boundary," when in reality the MCP server and the hooks are different runtimes that will each instantiate their own adapter. There is no shared in-process port; "collapse the dual boundary" overstates what a shared *module* (vs shared *instance*) buys you.
- Fix: Reframe as "both the MCP server and hooks import the same port module (shared code, not shared state)"; drop "eliminate dual boundary."

## LOW

**L1. Scope doc version/positioning drift.** Scope §intro says "v0.2.15" (correct, verified) but the AIDLC template's parent CLAUDE.md still says "Version: 0.1.0" and the scorecard cites the cache path `.../0.1.0/`. Not these deliverables' fault, but the "Best-in-class CLAUDE.md" praise (Scorecard #2) is undercut by CLAUDE.md carrying a stale version. Note it.

**L2. Decoupling §2.1 difficulty=1 for LLMProvider is accurate.** Verified: only two `execFileSync('claude', ['-p', ..., '--model','haiku'])` sites (`daily-chat-summary.mjs:176`, `daily-chat-greeting.mjs:116`). This is the one fully-correct, well-scoped item. Good.

**L3. Scorecard #3 (`templates/llm-wiki-vault/CLAUDE.md`) is correctly identified** (file exists) and correctly downgraded to N/A. Fine — but the "N/A → Partial → Score: N/A" notation is confusing; state N/A once.

**L4. "60% → ~83%" projection is unfalsifiable and double-counted.** Roadmap items 1–4 are claimed to raise compliance to ~83%, but item 5 (documentation-policy) is also separately claimed to move #13 Partial→Present. The 83% math isn't shown. Either show the post-fix tally or drop the number.

**L5. AIDLC checkpoint C1 claims the PreToolUse `AskUserQuestion` task picker partially implements "Units-of-Work decomposition" approval.** That's a stretch — the picker selects an existing task; it does not decompose intent into units of work. Conflating task-selection with epic-decomposition inflates Stage-1 coverage.

---

## Verdict: Is this report trustworthy & actionable?

**Partially trustworthy; actionable with corrections — not safe to ship as-is.**

- The **structural analysis is sound and mostly verifiable.** Core factual claims I checked are TRUE: no `AGENTS.md`, no `docs/decisions/`, no `ai-agent-policy.md`/`documentation-policy.md`, no `.codesight/`; `release.yml` is push-to-master-only with `npm test`; 11 test files wired into `npm test`; two inline `claude -p` call sites; `oncall-assignments-history`/`ap-northeast-2` really are hardcoded in skills; the gap diagnosis (strong execution layer, weak governance layer) is correct.
- But it has **one disqualifying miss (C1: a live token in the very file it scored "Present")**, **at least one fabricated-precision claim (H1: Lambda ARN / calendar ID not in the repo)**, **visible broken arithmetic presented to the reader (H2)**, and a **self-contradicting "verified verbatim" claim (H3)**. These are exactly the failure modes the AIDLC doc's own Stage-5 "evidence-before-assertion" rule exists to prevent — so the deliverable fails its own bar.
- The decoupling design is **directionally good and pragmatic for no-build .mjs** (dynamic `import()` + noop adapters + legacy-flag inference is genuinely the right shape), but it **understates hot-path hook latency (M5)** and **oversells the MCP "dual-boundary collapse" (M6)**.

**Bottom line:** Trust the gap list and the port architecture skeleton. Do **not** trust the specific resource identifiers, the security "Present" ratings, or the precise percentages without re-verification. Required before acceptance: rotate the leaked token, re-score #10, remove unverified ARNs/IDs, fix the tally, and add the monorepo-vs-this-repo honesty note to the AIDLC artifact table.


---

## 7. 정정: 모노레포 **자체** 준수도 재채점 (올바른 대상)

> §0에서 예고한 후속. §2 스코어카드는 cwd 혼동으로 **플러그인 repo**를 측정했음. 여기서는 사용자 질문대로 **`/Users/kwm/Documents/GitHub/monorepo`** 를 §2.1의 16항목 템플릿으로 직접 채점함. 모든 항목을 2026-05-31 실제 파일로 확인(증거 경로 명시).

> ⚠️ **순환성 고지:** 이 템플릿은 *모노레포에서 도출*됐으므로 모노레포가 높은 점수를 받는 것은 부분적으로 동어반복. 스코어카드의 진짜 가치는 *다른* repo 측정(플러그인 60%)에 있음. 아래는 "모노레포가 자기 표준을 실제로 갖추고 있나"의 사실 확인.

| # | 항목 | 상태 | 증거 (모노레포 경로) | 비고 |
|---|------|------|----------------------|------|
| 1 | AGENTS.md (root) | **Present** | `AGENTS.md` (9.5KB) | "cross-tool entry point, closest-file-wins"; CLAUDE.md가 여기를 가리킴 |
| 2 | CLAUDE.md (root) | **Present** | `CLAUDE.md` (676줄) | 루트 부트스트랩 |
| 3 | 서브모듈별 CLAUDE.md | **Present** | `backend/{main,admin,coderun,proxy}/CLAUDE.md`, `frontend/{main,admin}/CLAUDE.md`, `infra/**/CLAUDE.md`(12개) | 스택별 closest-file-wins 완비 (플러그인은 N/A였음) |
| 4 | ADR (`docs/decisions/`) | **Present** | `docs/decisions/{TEMPLATE.md, README.md, ADR-0001..0005}` | Nygard ADR 5건 + 템플릿 + 인덱스. 정식 ADR 규율 |
| 5 | Specs+Plans 워크플로우 | **Present** | `docs/superpowers/{plans,specs,README}` + `docs/scoped/` | 날짜+기능 스코프 plan/spec 쌍 다수, scoped 동결 디렉토리 |
| 6 | AI agent policy | **Present** | `docs/ai-agent-policy.md` (7KB, "Mandatory") | 가드레일 정책 문서 |
| 7 | Runbook + 실행 스킬 분리 | **Present** | `docs/oncall-runbook.md` + `.claude/commands/{deploy,rollback,release-*,oncall-runbook}.md` + `.opencode/commands/` 미러 | 판단=문서, 결정적 op=스크립트 |
| 8 | Codesight / 컨텍스트 인덱스 | **Present** | `.codesight/CODESIGHT.md` (107KB) + `config/coverage/events/graph/libs/middleware.md` | 자동생성 구조 인덱스 — 매우 강력 |
| 9 | 세션/자동화 훅 | **Present** | `.claude/settings.json`(SessionStart 선언) + 설치된 codepresso 플러그인의 Pre/PostToolUse | 루트는 SessionStart 커밋; 무거운 훅은 플러그인 제공 |
| 10 | 권한 매트릭스 | **Present** | `.claude/settings.json` (**git-tracked, 공유**) + `settings.local.json` | 커밋된 공유 매트릭스 — 플러그인(local-only)보다 강함 |
| 11 | 모든 PR에 CI 게이트 | **Present** | `.github/workflows/e2e-on-pr.yml` (`pull_request` 트리거) + `schema-validate-preflight.yml`, `e2e-stage.yml`, `perf-tests.yml` | 머지 전 검증. **플러그인의 최대 갭(Partial)이 여기선 해결** |
| 12 | Intent→PR→deploy 추적성 | **Partial** | `coordinated-deploy.yml`(tag 기반), `scripts/{pin-release,release-status}.sh`, 플러그인 `[TSK-]` 강제 | 배포 체인·태그·머지→Notion 캐스케이드 작동. 단 **PR-제목↔티켓 컨벤션이 모노레포 자체 문서/설정엔 미명시**(플러그인 훅에 의존) → 보수적으로 Partial |
| 13 | Documentation policy | **Present** | `docs/documentation-policy.md` (7KB) | Permanent/ADR/Scoped/Ephemeral 분류 정의 |
| 14 | Graceful degradation / 플래그 | **Present** | `infra/**/*.tf` (`enabled`/`count` 조건부, dev/stage/opt 환경 매트릭스, 30+ 매치) | 인프라 환경-게이팅 형태(플러그인의 SaaS `enabled:false`와 결은 다르나 원리 동일) |
| 15 | Pre-push / pre-merge 검증 | **Present** | `scripts/check-before-push.sh`, `scripts/sync-submodules.sh` | 서브모듈 포인터/상태 가드 (플러그인엔 없던 항목) |
| 16 | 결정적 로직 단위 테스트 | **Present** | `tests/`(e2e-tests 서브모듈: e2e/lsp/perf) + 백엔드 서브모듈 자체 테스트 | E2E/perf + 서브모듈 단위 테스트. CI 연동 |

**집계 (16항목):** Present 15 · Partial 1 (#12) · Missing 0
**점수:** `(15×1.0 + 1×0.5) / 16 = 15.5/16 = ` **≈ 97%**

### 플러그인 vs 모노레포 대비

| 레이어 | 플러그인 repo | 모노레포 |
|--------|--------------|----------|
| 거버넌스/지식 (AGENTS·ADR·정책·doc정책·codesight) | 약함 (다수 Missing) | **완비** |
| 실행/운영 (훅·추적성·런북·플래그·테스트) | 강함 | 강함 |
| **종합** | **60%** | **≈97%** |

### 해석 & 후속
- 모노레포는 **사실상 레퍼런스 구현** — §2.1 템플릿을 거의 그대로 충족. 유일한 소프트스폿은 **#12**: 티켓↔PR 추적이 모노레포 자체가 아니라 *외부 플러그인 훅*에 의존 → 모노레포 `AGENTS.md`/`workflow-guide.md`에 PR-제목 `[TSK-XXXX]` 컨벤션을 명문화하면 Present로 승격.
- 따라서 **템플릿화 방향**: 모노레포의 구조를 "AI-native repo 템플릿"으로 추출(이미 §2.1이 그 결과) → **다른 프로젝트 + 플러그인 repo 자체**에 적용. 가장 ROI 높은 적용 대상은 **플러그인 repo(60%)**: AGENTS.md 추가·CI를 PR로 이동·ADR 디렉토리·ai-agent-policy 작성(§2 Part 3의 갭 1~4).

---

## 부록 — 출처 URL

- https://agents.md
- https://arxiv.org/html/2411.13768v3
- https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/
- https://aws.amazon.com/blogs/devops/open-sourcing-adaptive-workflows-for-ai-driven-development-life-cycle-ai-dlc/
- https://aws.amazon.com/blogs/industries/ai-driven-development-lifecycle-for-financial-services/
- https://buildermethods.com/agent-os/v2
- https://buildermethods.com/agent-os/v2/3-layer-context
- https://code.claude.com/docs/en/best-practices
- https://code.claude.com/docs/en/overview
- https://dev.to/kazuya_dev/aws-reinvent-2025-introducing-ai-driven-development-lifecycle-ai-dlc-dvt214-32b
- https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/acl.html
- https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html
- https://en.wikipedia.org/wiki/Hexagonal_architecture_(software
- https://every.to/guides/ai-product-management-guide
- https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/
- https://github.com/awslabs/aidlc-workflows
- https://github.com/bmad-code-org/BMAD-METHOD
- https://github.com/code-presso/monorepo.git
- https://github.com/github/spec-kit
- https://github.com/microsoft/ai-agent-runbooks
- https://github.github.com/spec-kit/
- https://kiro.dev/docs/specs/
- https://kiro.dev/docs/specs/feature-specs/
- https://kiro.directory/tips/ears-format
- https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer
- https://medium.com/@officialpreksha2166/the-protocol-shift-how-model-context-protocol-mcp-solves-the-n-1-connector-problem-in-245021ea2083
- https://modelcontextprotocol.io/specification/2025-11-25
- https://netalith.com/blogs/microservices-architecture/anti-corruption-layer-pattern-legacy-integration-2026
- https://swiftlane.com/blog/syncing-docs-from-code-repositories-to-notion/
- https://www-cdn.anthropic.com/58284b19e702b49db9302d5b6f135ad8871e7658.pdf
- https://www.adoc-studio.app/comparison/notion
- https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk
- https://www.augmentcode.com/guides/how-to-build-agents-md
- https://www.augmentcode.com/product/intent
- https://www.braintrust.dev/articles/llm-evaluation-guide
- https://www.braintrust.dev/articles/llm-observability-guide
- https://www.infoq.com/news/2025/08/aws-kiro-spec-driven-agent/
- https://www.infoq.com/news/2026/03/agents-context-file-value-review/
- https://www.oreilly.com/radar/the-future-of-product-management-is-ai-native/
- https://www.smileshark.kr/en/post/what-is-the-ai-dlc-ai-driven-development-lifecycle
- https://www.xda-developers.com/local-first-tool-completely-replaced-notion/
