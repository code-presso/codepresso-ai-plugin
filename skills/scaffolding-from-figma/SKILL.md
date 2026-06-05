---
name: scaffolding-from-figma
description: "Use when given a Figma file URL + node-id and asked to generate frontend scaffold code (Vue/React/Svelte) that matches an existing project's design system tokens. Verified pipeline: Figma PAT to spec.md to AI designer-high to approximately 95% scaffold, publisher refines."
---

<Purpose>
Automate the Figma → frontend scaffold pipeline. Pull Figma node metadata via REST API (PAT),
auto-map every value to the target project's SCSS/CSS tokens, then feed the resulting spec
+ design-system context to a designer-high agent. Output is a 70–95% ready scaffold that the
publisher refines in 1–2 hours instead of 1–2 days from scratch.

Empirical baseline (Codepresso 평가리포트 페이지, N=3 difficulty levels, local Nuxt dev):
- HIGH: 86.62% pixel match
- MID:  96.87% pixel match
- LOW:  96.71% pixel match
- 0 hardcoded hex across all 3 pages
- Design token compliance 73.8% vs legacy 12.21% (6× lift)
</Purpose>

<Use_When>
- User gives a Figma URL + node-id (e.g. `figma.com/design/:fileKey/...?node-id=:nodeId`)
- Task framed as "퍼블리셔 작업 부담 감소" / "AI scaffold first draft" / "Figma to Vue"
- Target project has documented SCSS/CSS tokens (`$color-*`, `$space-*`, etc.) or CSS variables
- Project has a design system inventory or component catalog you can point the agent at
- User says "figma 토큰 / scaffold / first draft / 퍼블리셔" in the same conversation
</Use_When>

<Do_Not_Use_When>
- No Figma access (no PAT, not a team member of the file's workspace)
- Target project has no design token system (just hex inline) — fix tokens first
- One-off prototype where manual coding is faster
- Need pixel-perfect production output — this skill outputs scaffold, not final code
- Complex interactive features (drag&drop, real-time, charts) that go beyond layout
</Do_Not_Use_When>

<Prerequisites>
1. **Figma PAT** with `file_content:read` + `file_variables:read` scopes
   - Generate at `figma.com/settings/security` → Personal Access Tokens
2. **Project SCSS/CSS variables file** identified (e.g. `_variables.scss`)
3. **Design system documentation** (a single inventory file OR a `design_system/` folder
   with index.md + tokens/ + components/)
4. **Node 20+** with deps installable: `sass`, `cheerio`, `puppeteer`, `pixelmatch`, `pngjs`, `esbuild`
</Prerequisites>

<Steps>

1. **Confirm inputs with user**
   - Ask for the Figma URL and node-id (or extract from URL — `node-id=2792-221447` → `2792:221447`)
   - Ask for the PAT if not in env (`FIGMA_PAT`). Store in `.env` (gitignored) — never commit.
   - Identify the project's `_variables.scss` (or equivalent) so spec.md can use its tokens.

2. **Extract Figma metadata**
   ```bash
   mkdir -p figma-data
   curl -s -H "X-Figma-Token: $FIGMA_PAT" \
     "https://api.figma.com/v1/files/$FILE_KEY/nodes?ids=$NODE_ID" \
     -o figma-data/node-$NODE_ID.json
   curl -s -H "X-Figma-Token: $FIGMA_PAT" \
     "https://api.figma.com/v1/images/$FILE_KEY?ids=$NODE_ID&format=png&scale=1" \
     | jq -r '.images | to_entries[0].value' \
     | xargs -I{} curl -s "{}" -o figma-data/render.png
   ```
   Verify `node-XXX.json` is non-empty (>1KB) and render.png shows the expected frame.

3. **Generate token-mapped spec.md**
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/skills/scaffolding-from-figma/scripts/figma-to-spec.mjs \
     --dir ./figma-data \
     node-$NODE_ID.json
   ```
   The script auto-maps Figma values to design tokens via its `COLOR_MAP`/`SPACING_MAP`/etc.
   **First time on a new project:** adapt the maps. See `references/token-map-example.md`.
   Output: `figma-data/spec.md` with each node showing exact dimensions + token names.
   `📦 component` markers indicate Figma component instances → reuse existing components.

4. **Split design_system documentation if monolithic**
   A single >1k-line `design_system.md` causes hallucination. If the project has one,
   recommend splitting into the 14-file structure described in `references/anti-hallucination.md`
   BEFORE running the designer agent. Skip if already split.

5. **Dispatch designer-high agent**
   Use the Task tool with `subagent_type: "oh-my-claudecode:designer-high"` (or equivalent) and model `opus`.
   Inputs the agent must receive (absolute paths):
   - `figma-data/spec.md` — concrete dimensions + token names
   - `design_system/index.md` — agent loads sub-files on demand
   - `figma-data/render.png` — visual reference (cropped to viewport if huge)
   The agent must:
   - Use exact widths/paddings from `spec.md` (no estimation)
   - Apply tokens for every color/spacing/radius/font (never hex/px inline)
   - Insert `<!-- TODO: reuse <LazyXXX /> -->` for nodes marked 📦
   - Match the target project's language (Korean copy, light/dark theme) — Figma reference
     may differ from production. Tell the agent which to follow explicitly.

6. **Integrate into local dev for verification**
   Drop the scaffold into a playground route (Nuxt: `application/pages/playground/<name>/`).
   Add SCSS imports at top of every `<style scoped lang="scss">`:
   ```scss
   @import "~/assets/scss/abstracts/variables.scss";
   @import "~/assets/scss/abstracts/mixin.scss";
   ```
   Replace any broken image references (`/img/...`) with placeholder spans before importing.
   Start dev server: `cross-env RUN_TYPE=stage nuxt dev` (or project-equivalent).
   Have the user log in via browser; capture AccessToken cookie.

7. **Measure with pixel-diff (optional but recommended)**
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/skills/scaffolding-from-figma/scripts/capture-diff.mjs
   ```
   Outputs `human.png` / `ai.png` / `diff.png` / error% JSON.
   Target: pixel match >85% on first shot, >95% after publisher polish.

8. **Hand off to publisher**
   Produce a CHECKLIST.md listing:
   - Items the agent left as `<!-- TODO -->`
   - Mock data → real API connections needed
   - GNB / chrome / language overrides applied
   - Hover/focus state details
</Steps>

<Tool_Usage>
- `Bash` for `curl` Figma REST calls + running the .mjs scripts
- `Task` (subagent_type: `oh-my-claudecode:designer-high`, model: `opus`) for the scaffold generation
- `Read` for inspecting `_variables.scss` to verify token names
- `Write`/`Edit` for placing the scaffold under `application/pages/playground/` + patching SCSS imports
- `AskUserQuestion` for clarifying PAT/file-key/node-id/which production page this maps to
</Tool_Usage>

<Examples>
<Good>
User: "이 figma 노드로 평가 상세 페이지 만들어줘 https://figma.com/design/Rlk3fU4BJUqP5KHsCvbhKi/...?node-id=742-61024 PAT: figd_..."
Action: Run pipeline steps 2-7. Output 9 Vue SFCs + spec.md + diff.png with match %.
</Good>
<Good>
User: "퍼블리셔 작업 줄이는 실험. 이 figma 화면을 AI scaffold로 만들어줘"
Action: Ask for Figma URL + PAT, then run pipeline. Emphasize 75-85% time savings target.
</Good>
<Bad>
User: "이 컴포넌트 디자인 검토해줘 [figma URL]"
Action: This is design review, not scaffold generation. Use the figma MCP or a designer agent directly, NOT this skill.
</Bad>
</Examples>

<Final_Checklist>
- [ ] Figma PAT obtained from user (or env), stored in `.env` (gitignored)
- [ ] `figma-data/node-XXX.json` extracted and >1KB
- [ ] `figma-data/render.png` saved and visually matches expected frame
- [ ] `figma-data/spec.md` generated with non-trivial token mapping (`$color-*` / `$space-*` visible)
- [ ] Design system context confirmed (split files preferred over monolith)
- [ ] designer-high agent dispatched with all 3 inputs (spec, design_system index, render PNG)
- [ ] Scaffold integrated into local dev playground route
- [ ] SCSS imports added at top of each `<style scoped lang="scss">` block
- [ ] Broken `<img src="/img/...">` references replaced with placeholders before import
- [ ] (Optional) capture-diff.mjs produces pixel match >85%
- [ ] CHECKLIST.md produced listing publisher refinement items
</Final_Checklist>

<Realistic_Outcomes>
- Single-shot pixel match: 86–97% depending on page complexity
- Hardcoded hex color count: 0 (guaranteed by the token mapper)
- Design token compliance: 5–6× the legacy baseline
- Publisher time saved: ~75–85% (8–13 hr → 1–2 hr per page)
- Iteration ceiling: <5% pixel error after publisher polish (15–60 min)
</Realistic_Outcomes>

<See_Also>
- `references/anti-hallucination.md` — why split design_system.md into 14 files (empirical data)
- `references/token-map-example.md` — how to adapt COLOR_MAP / SPACING_MAP for a new project
- Source experiment: `code-presso/global-main-frontend` branch `experiment/design-system-figma-html`
</See_Also>
