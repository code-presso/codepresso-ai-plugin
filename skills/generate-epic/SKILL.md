---
name: generate-epic
description: Generate a PRD document from a Notion epic
---

<Purpose>
Generate a structured PRD (Product Requirements Document) markdown file from a Notion epic.
Pre-fills metadata, tasks, and sprint info from Notion, then optionally runs a planning interview
via OMC's Planner agent to complete requirements, technical design, and acceptance criteria.
</Purpose>

<Use_When>
- User says "generate epic", "generate prd", "epic prd", "generate-epic"
- User wants to create documentation for a Notion epic
- User says "codepresso generate-epic" or "codepresso:generate-epic"
</Use_When>

<Do_Not_Use_When>
- User wants to sync or update Notion tasks (use `codepresso:notion-sync`)
- User wants sprint progress info (use `codepresso:sprint-dashboard`)
</Do_Not_Use_When>

<Steps>

1. **Load configuration**
   - Use `loadConfig` or read `~/.codepresso/config.json` to get Notion and epicDocs settings
   - Verify Notion is configured (`notion.apiKey` or MCP tools available). If not, tell the user to run `/codepresso:setup` first.
   - Read `epicDocs` config: `outputDir` (default: `docs/prd`), `includeTaskDetails` (default: true), `customSections` (default: [])

2. **Resolve epic**
   - **If user provided an epic ID** (e.g., `generate-epic GP-1014`): use it directly to search
   - **Else check current branch context**: Read `.omc/state/codepresso-selected-task.json`, check if the current branch entry has `epicUniqueId` — if so, use that
   - **Else fetch sprint context**: Use the `mcp__notion__notion_sprint_context` or `mcp__plugin_codepresso_notion__notion_sprint_context` MCP tool with `{ include_completed: false, assignee_only: false }` to get all epics
   - Present epics to user via `AskUserQuestion`:
     - question: "Which epic would you like to generate a PRD for?"
     - header: "Epic"
     - Options: top 3 epics by relevance (prefer in-progress), with unique ID and title as label, status as description

3. **Fetch epic data**
   - From the sprint context result (or via `mcp__notion__notion_query_db` / `mcp__plugin_codepresso_notion__notion_query_db` fallback if sprint workflow is disabled), extract:
     - `epic.id` (page ID — used for Notion URL)
     - `epic.title`
     - `epic.uniqueId` (e.g., "GP-1014")
     - `epic.status`
     - Sprint name and dates (from parent sprint in hierarchy)
     - `epic.tasks[]` — each with: `uniqueId`, `title`, `status`, `assignees` (array of names), `categories` (array)
   - Construct Notion URL: `https://www.notion.so/{page-id-without-hyphens}`
     - Remove hyphens from the page ID to form the URL

4. **Check for existing file**
   - Read config for `epicDocs.outputDir` (default: `docs/prd`)
   - Determine the git root via `git rev-parse --show-toplevel`
   - Slugify the epic title: lowercase, replace spaces/special chars with hyphens, strip non-ASCII, max 60 chars for the slug portion
   - Target filename: `{uniqueId}-{slug}.md` (e.g., `GP-1014-user-authentication.md`)
   - Use `Glob` to check for `{outputDir}/{uniqueId}-*.md`
   - **If file exists**: Use `AskUserQuestion`:
     - question: "A PRD already exists for this epic. What would you like to do?"
     - header: "Existing PRD"
     - Options:
       - "Update" — description: "Refresh metadata and tasks table, preserve user-written sections"
       - "Overwrite" — description: "Replace the entire file with fresh content"
       - "Cancel" — description: "Keep the existing file unchanged"
   - **Update mode**: Read the existing file. Replace only the Metadata table and Tasks table sections. Keep all other content (Overview, Requirements, Technical Design, Acceptance Criteria, and any user-written text) intact.

5. **Planning interview (optional)**
   - Use `AskUserQuestion`:
     - question: "Would you like to run a planning interview to fill in the PRD details?"
     - header: "Planning"
     - Options:
       - "Run planning interview" — description: "OMC Planner will ask questions about requirements, services, design, and acceptance criteria"
       - "Skip — generate skeleton" — description: "Create PRD with placeholder comments for manual editing"
   - **If planning**:
     - Delegate to `oh-my-claudecode:planner` agent via Task tool with this prompt:
       ```
       Run a planning interview for the following Notion epic to produce a PRD.

       Epic: {uniqueId} — {title}
       Status: {status}
       Sprint: {sprint name} ({sprint dates})

       Tasks:
       {task list with IDs, titles, statuses}

       Ask the user about:
       1. Overview — purpose and business value of this epic
       2. Requirements — functional and non-functional requirements
       3. Affected Services — which monorepo services are impacted and what changes
       4. Technical Design — architecture, API changes, data model changes
       5. Acceptance Criteria — specific testable criteria for completion

       Return a structured response with sections: Overview, Requirements, Affected Services (as a table with Service/Path/Changes columns), Technical Design, and Acceptance Criteria (as checkbox items).
       ```
     - Use the planner's returned content to fill the PRD sections
   - **If skip**: Leave sections with `<!-- placeholder -->` comments

6. **Generate and write PRD**
   - Construct the markdown document with this structure:

   ```
   # [{uniqueId}] {title}

   > Auto-generated from Notion epic. Last updated: {YYYY-MM-DD}.

   ## Metadata

   | Field | Value |
   |-------|-------|
   | Epic ID | {uniqueId} |
   | Sprint | {sprint name} ({sprint dates}) |
   | Status | {status} |
   | Notion | [Open in Notion](https://www.notion.so/{page-id-no-hyphens}) |

   ## Overview

   {planner content OR "<!-- Describe the purpose and business value of this epic -->"}

   ## Requirements

   {planner content OR "<!-- List functional and non-functional requirements -->"}

   ## Tasks

   | ID | Task | Status | Assignee | Category |
   |----|------|--------|----------|----------|
   {task rows}

   ## Affected Services

   {planner content OR table with placeholder}

   | Service | Path | Changes |
   |---------|------|---------|
   | | | |

   ## Technical Design

   {planner content OR "<!-- Architecture, API changes, data model changes -->"}

   ## Acceptance Criteria

   {planner content OR "- [ ] ..."}

   {any customSections from config, each as ## heading with <!-- placeholder --> comment}
   ```

   - If `includeTaskDetails` is false, omit the Tasks section entirely
   - If `customSections` has entries (e.g., `["Rollback Plan", "Monitoring"]`), append each as `## {section name}` with `<!-- placeholder -->` below

   - Create the output directory: `mkdir -p {gitRoot}/{outputDir}` via Bash
   - Write the file using the `Write` tool
   - Print a success message: "PRD generated at `{outputDir}/{filename}`"

</Steps>

<Tool_Usage>
- Use `mcp__notion__notion_sprint_context` or `mcp__plugin_codepresso_notion__notion_sprint_context` for fetching sprint/epic hierarchy
- Use `mcp__notion__notion_query_db` or `mcp__plugin_codepresso_notion__notion_query_db` as fallback for epic data
- Use `AskUserQuestion` for epic selection, existing file handling, and planning choice
- Use `Task` tool with `oh-my-claudecode:planner` for the planning interview
- Use `Glob` to check for existing PRD files
- Use `Read` to load existing PRD for update mode
- Use `Bash` for `mkdir -p` and `git rev-parse --show-toplevel`
- Use `Write` for creating/overwriting the PRD file
</Tool_Usage>

<Examples>
<Good>
User: "generate-epic GP-1014"
Action: Resolve GP-1014, fetch epic data, check existing, ask about planning, generate PRD
</Good>
<Good>
User: "generate epic"
Action: Check branch context for epic, fall back to sprint context picker, then generate PRD
</Good>
<Good>
User: "codepresso generate-epic"
Action: Same as above — resolve, fetch, generate
</Good>
</Examples>

<Final_Checklist>
- [ ] Epic resolved (from argument, branch context, or interactive picker)
- [ ] Epic data fetched from Notion (title, ID, tasks, sprint info)
- [ ] Existing file check performed
- [ ] Planning interview offered (run or skipped)
- [ ] PRD markdown written to `{outputDir}/{uniqueId}-{slug}.md`
- [ ] Success message printed with file path
</Final_Checklist>
