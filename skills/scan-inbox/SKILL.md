---
name: codepresso:scan-inbox
description: Scan Gmail + Google Chat for action-item messages, present a triage picker, create Notion tasks with due dates.
---

# scan-inbox

Triages messages from Gmail and Google Chat that look like action items, and turns the user-approved ones into Notion tasks with explicit due dates.

## When to invoke

- Automatically when `session-start.mjs` injects the instruction `Morning inbox routine: invoke the codepresso:scan-inbox skill` into `additionalContext`.
- Manually when the user runs `/codepresso:scan-inbox`.

If `inbox.enabled` is `false` in config, emit `Inbox scan not enabled. Run /codepresso:setup to configure.` and exit.

## Procedure

### Step 1 — Load prep state

Run from the project root:

```bash
node scripts/inbox-cli.mjs prep
```

Parse the JSON output:
- `seen` — message IDs already triaged (do not re-fetch these).
- `leftovers` — candidates from a previous interrupted run (carry forward to Step 5).
- `config` — `inbox.*` settings.
- `notion` — `{ taskDb, userId }`.

If `config.enabled` is false, abort with the message above.

### Step 2 — Fetch Gmail (if `config.sources.gmail.enabled`)

Use `mcp__claude_ai_Gmail` to list messages matching `config.sources.gmail.query`, constrained to the last `config.sources.gmail.lookbackHours` hours. Cap at `config.sources.gmail.maxResults`.

For each message capture: `id`, `from`, `subject`, `snippet`, `permalink`.

If the connector returns "not authenticated", skip and emit `🔐 Gmail connector not authenticated — run mcp__claude_ai_Gmail__authenticate to enable.`

### Step 3 — Fetch Chat (if `config.sources.chat.enabled`)

Compute `sinceIso = now - lookbackHours`. Run:

```bash
node -e "import('./scripts/lib/gws.mjs').then(m => { const out = m.fetchChatUnread({ spaceIds: <JSON of space IDs>, sinceIso: '<sinceIso>', maxPerSpace: <maxPerSpace> }); process.stdout.write(JSON.stringify(out)); })"
```

If the result is `[]` due to gws issues, emit `🔐 gws CLI unavailable — Chat fetch skipped.`

### Step 4 — Filter & dedup

Combine Gmail + Chat into one candidate list. Drop a message if:
- Its `id` is in `seen.gmail` or `seen.chat`.
- Its `from` matches any pattern in `config.ignoreSenders` (regex).
- Gmail header `Auto-Submitted` is present.

### Step 5 — Add leftover candidates

Merge `leftovers` from Step 1 into the candidate list.

### Step 6 — Redact snippets

For each candidate, pipe its `snippet` through:

```bash
echo "<snippet>" | node scripts/inbox-cli.mjs redact
```

Replace the snippet with the redacted output (≤ 500 chars).

### Step 7 — Classify with Claude itself

Build a single batched prompt:

```
For each entry, return JSON: { "index": N, "isTask": <bool>, "summary": "<≤80 char imperative>", "reason": "<phrase>" }. Output ONLY a JSON array.

1. From: <from> | Subject: <subject>
   Snippet: <snippet>
2. ...
```

Drop entries where `isTask` is false. Cap survivors at `config.classifier.maxCandidatesPerScan`.

### Step 8 — Stage candidates

Build the staging payload:

```json
{
  "candidates": [<surviving candidates>],
  "sourceIds": { "gmail": [<all fetched gmail ids>], "chat": [<all fetched chat ids>] }
}
```

Include EVERY fetched ID in `sourceIds` (accepted + rejected by classifier).

```bash
echo '<payload JSON>' | node scripts/inbox-cli.mjs stage
```

If the resulting candidate list is empty, emit `📭 Inbox empty — nothing to triage.` and exit.

### Step 9 — Approval loop (paginated AskUserQuestion)

For each batch of up to 4 candidates:

Use `AskUserQuestion` with `multiSelect: true`:
- header: `Inbox triage`
- question: `Pick the ones to turn into Notion tasks:`
- options: up to 4 candidates `{ label: <summary>, description: "<source> · <from> · <subject>" }` plus `{ label: "Skip rest", description: "Stop triaging" }`

If "Skip rest", break out. Remaining candidates stay in the JSONL.

### Step 10 — Per-accepted due date

For each accepted candidate, single-select `AskUserQuestion`:
- header: `Due date`
- question: `Due date for: <summary>`
- options:
  - `Today (EOD)` → today @ 18:00 local
  - `Tomorrow` → tomorrow @ 09:00 local
  - `This Friday` → upcoming Friday @ 18:00 local
  - `Next Monday` → next Monday @ 09:00 local

For "Other", parse `YYYY-MM-DD` or natural phrases. Default timezone is `process.env.TZ` or `Asia/Seoul`.

### Step 11 — Resolve Notion DB schema (cached)

Run:

```bash
node scripts/inbox-cli.mjs schema-cache get
```

If the result is `null` or `taskDb.fetchedAt` is older than 7 days:
- Use `mcp__claude_ai_Notion__notion-fetch` on `notion.taskDb` to read the property schema.
- Identify the title, status (`type: "status"`), assignee (`type: "people"`), and due-date (`type: "date"`, name = `config.notion.dueDateProperty`).
- Save the cache:

```bash
echo '{"taskDb":{"id":"<dbid>","titleProp":"<name>","statusProp":"<name>","assigneeProp":"<name>","dueDateProp":"<name>"}}' | node scripts/inbox-cli.mjs schema-cache set
```

### Step 12 — Create Notion pages

For each accepted candidate, call `mcp__claude_ai_Notion__notion-create-pages` with:

```json
{
  "parent": { "database_id": "<taskDb.id>" },
  "properties": {
    "<titleProp>": { "title": [{ "text": { "content": "<summary>" } }] },
    "<statusProp>": { "status": { "name": "할 일" } },
    "<assigneeProp>": { "people": [{ "id": "<notion.userId>" }] },
    "<dueDateProp>": { "date": { "start": "<chosen ISO8601 with TZ>" } }
  },
  "children": [
    { "object": "block", "type": "paragraph", "paragraph": { "rich_text": [
      { "type": "text", "text": { "content": "Source: " } },
      { "type": "text", "text": { "content": "<from> — <subject>", "link": { "url": "<sourceUrl>" } } }
    ]}},
    { "object": "block", "type": "paragraph", "paragraph": { "rich_text": [
      { "type": "text", "text": { "content": "<redacted snippet>" } }
    ]}}
  ]
}
```

If the create call fails with a property-name mismatch, delete the schema cache file, re-run Step 11, and retry once. On second failure, leave the candidate in the JSONL and surface a warning.

### Step 13 — Finalize state

```bash
echo '{"accepted":[<ids>],"rejected":[<ids>]}' | node scripts/inbox-cli.mjs complete
```

This removes them from the JSONL. Unreached candidates (Skip rest, terminal close) stay.

### Step 14 — Confirm

Emit a single summary line:

```
✅ Created N tasks in Notion: [TSK-XXX], [TSK-XXY], ...
```

If `uniqueId`s are not available, fall back to titles. If zero were created, emit `📭 No tasks created.`.

## Failure handling

| Failure | Behavior |
|---------|----------|
| `inbox.enabled` false | Abort with setup hint. |
| Gmail connector not authed | Skip Gmail, continue Chat. |
| `gws` missing / unauth | Skip Chat, continue Gmail. |
| Notion schema fetch fails | Use stale cache if any; else abort create. |
| Notion create property mismatch | Invalidate cache, retry once. |
| User picks "Skip rest" | Remaining candidates stay in JSONL. |
| Zero candidates after filter/classify | Silent exit with empty-inbox notice. |
