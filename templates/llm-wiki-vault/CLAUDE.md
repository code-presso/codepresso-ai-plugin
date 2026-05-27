# LLM Wiki — Schema

This file is the **schema**: it tells any LLM (Claude Code, Codex, etc.) how this wiki
is organized, what the conventions are, and which workflows to follow. It is the control
document — you and the LLM co-evolve it as you learn what works for your domain.

Pattern: Andrej Karpathy, "LLM Wiki"
<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>

## What this is

A **persistent, compounding knowledge base** maintained by an LLM. Unlike RAG (retrieve
on demand, then discard), this wiki is a durable artifact: the LLM reads sources, extracts
what matters, and integrates it into interlinked pages that improve over time. The LLM
carries the maintenance burden — that is the whole point. This is your personal,
cross-repo second brain.

## Three layers

1. **Raw sources** — `sources/`. Immutable. Captured material (articles, docs, notes).
   Read, never edited after capture.
2. **The wiki** — `pages/`, `index.md`, `log.md`. LLM-generated, continuously edited.
3. **The schema** — this file.

## Directory layout

```
.
├── CLAUDE.md        # this schema (AGENTS.md → symlink to it, if present)
├── README.md        # human-facing intro
├── index.md         # content catalog by category (links + 1-line summaries)
├── log.md           # append-only chronological activity log
├── sources/         # raw immutable inputs — one file per source
└── pages/           # the wiki proper — topic/entity pages, cross-linked
```

## Conventions

**Page files** (`pages/<kebab-slug>.md`) start with frontmatter, then content:

```markdown
---
title: Human Readable Title
type: topic | entity | how-to | reference | decision
tags: [tag1, tag2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: ["[[sources/YYYY-MM-DD-some-source]]"]
---

# Human Readable Title

One-paragraph summary up top — the answer to "what is this and why do I care."

## ... sections ...

## Related
- [[other-page]] — why it's related
```

**Source files** (`sources/YYYY-MM-DD-<kebab-slug>.md`) start with provenance frontmatter
(`title`, `url`, `author`, `captured`, `type`), then the captured content. If the full
text is large or unavailable, store a faithful structured capture plus the canonical URL —
never silently summarize away the source.

**Linking** uses Obsidian wikilinks: `[[page-slug]]` or `[[page-slug|display text]]`. Link
liberally — a link to a page that doesn't exist yet is a useful TODO marker, not an error.

**Naming** — kebab-case slugs. Sources are date-prefixed (`YYYY-MM-DD-`). Pages are not.

## The three workflows

### Ingest — add knowledge from a source
1. **Capture** the raw source into `sources/YYYY-MM-DD-<slug>.md` with provenance frontmatter.
2. **Discuss takeaways** with the user (unless batch-ingesting with low oversight).
3. **Integrate**: create or update relevant `pages/` (a single source often touches
   several). Add cross-links both ways.
4. **Update `index.md`** — add new pages under the right category with a 1-line summary.
5. **Append to `log.md`** — `## [YYYY-MM-DD] ingest | <title>` + 1–2 lines on what changed.

### Query — answer from the wiki
1. Search `index.md` and `pages/` for relevant material.
2. Synthesize an answer **with citations** to the pages/sources used.
3. If valuable and not already captured, **file the answer back** as a new page (and update
   `index.md` + `log.md`) so discoveries compound instead of vanishing into chat history.

### Lint — health-check the wiki
Scan for contradictions, stale claims (check `updated` dates), orphan pages (no inbound
links), missing cross-references, and gaps. Fix trivial issues directly; surface judgment
calls and suggest sources to ingest next.

## Git & Obsidian

- The vault is a **git repo** — version history (and, if you add a remote, multi-machine
  sync) for free. Commit after meaningful ingest/lint sessions.
- Browse in **Obsidian**: graph view shows the link structure; keep the LLM agent on one
  side and Obsidian on the other to watch edits land in real time.
