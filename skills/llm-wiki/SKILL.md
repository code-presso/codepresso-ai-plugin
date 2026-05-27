---
name: codepresso:llm-wiki
description: Maintain a personal, compounding LLM Wiki (Obsidian + git) — ingest sources, query knowledge, lint. Each teammate keeps their OWN vault. Invoke on "/codepresso:llm-wiki ...", "ingest <x> into my wiki", "what does my wiki say about <x>", "lint my wiki", or when a durable, cross-repo learning should outlive the conversation.
---

# llm-wiki

Helps the user maintain a personal **LLM Wiki**: a persistent markdown knowledge base that
an LLM curates and that compounds over time (pattern: Andrej Karpathy's "LLM Wiki",
<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>). It is the canonical
store for durable, repo-independent knowledge.

Each user keeps their **own** vault (an Obsidian vault + git repo). This skill ships no
content — it scaffolds an empty vault and then operates on it.

## When to invoke

- Manually: `/codepresso:llm-wiki <subcommand> [args]` where subcommand is
  `init` | `ingest` | `query` | `lint` (default to a short status if none given).
- Automatically: when the user says things like "ingest this into my wiki", "add this to
  my wiki", "what does my wiki say about X", "lint my wiki", or when a durable cross-repo
  learning emerges that should be captured.

## Step 0 — Resolve the vault (always first)

Run from the project root:

```bash
node scripts/wiki-cli.mjs path
```

Parse the JSON:
- `enabled` — whether the wiki is configured.
- `vaultPath` — absolute, `~`-expanded path.
- `exists` / `hasSchema` — whether the vault dir and its `CLAUDE.md` are present.

Routing:
- Subcommand is `init`, OR `hasSchema` is false → go to **Init**.
- Otherwise → go to **Operate**.

## Init — create the user's vault

Only scaffolds; never overwrites an existing `CLAUDE.md`.

```bash
node scripts/wiki-cli.mjs init        # uses configured/default path
# or, to choose a location:
node scripts/wiki-cli.mjs init "<absolute-or-~-path>"
```

This creates `CLAUDE.md` (schema), `README.md`, `index.md`, `log.md`, `sources/`,
`pages/`, a minimal `.obsidian/`, runs `git init` + an initial commit, and writes
`wiki.vaultPath` (with `enabled: true`) into `~/.codepresso/config.json`.

After init, tell the user:
- Where the vault is, and that it's a git repo + Obsidian vault.
- For multi-machine sync, they can add a private git remote (show the `git remote add` +
  `git push -u origin main` lines). Do NOT create a remote for them unless they ask.

Then continue to **Operate** if they gave an ingest/query target.

## Operate — ingest / query / lint

The vault's own `CLAUDE.md` is the authoritative schema. **Read it first**, then follow it:

```bash
cat "<vaultPath>/CLAUDE.md"
```

Work inside `<vaultPath>` (read/write files there), following that schema:

- **ingest `<url|path|pasted text>`** — capture the raw source into
  `sources/YYYY-MM-DD-<slug>.md` (faithful capture + canonical URL), integrate it into one
  or more `pages/`, add cross-links, update `index.md`, append a `## [YYYY-MM-DD] ingest |
  <title>` line to `log.md`.
- **query `<question>`** — search `index.md` + `pages/`, answer **with citations** to the
  pages used; if the answer is valuable and not already captured, file it back as a new page.
- **lint** — scan for contradictions, stale claims, orphan pages, missing links, gaps;
  fix trivial issues, surface judgment calls.

## Step N — Commit

After meaningful changes:

```bash
git -C "<vaultPath>" add -A && git -C "<vaultPath>" commit -m "<ingest|query|lint>: <summary>"
```

If `wiki.remote` is set (from `path` output), offer to `git -C "<vaultPath>" push`.

## Confidentiality note

This is the user's personal knowledge base. Treat its contents as private to them; never
copy vault content into shared repos, issues, or messages without explicit instruction.

## Failure handling

| Failure | Behavior |
|---------|----------|
| `wiki-cli.mjs path` shows `hasSchema: false` | Route to Init before any ingest/query. |
| `init` reports `alreadyInitialized` | Vault already exists; skip scaffolding, proceed to Operate. |
| `git commit` skipped (no git identity) | Report it; files are written and staged. Suggest setting `git config`. |
| Source URL can't be fetched in full | Store a faithful structured capture + the canonical URL; never drop the source silently. |
| User asks to push but no remote configured | Explain how to add a private remote; don't create one unprompted. |
