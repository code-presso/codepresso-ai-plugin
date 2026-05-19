# Anti-hallucination: Why splitting `design_system.md` matters

## Empirical baseline (Codepresso experiment, N=3 difficulty levels)

A single 1,629-line monolithic `design_system.md` injected as AI context produced these problems:
- Agent invented tokens that didn't exist (`$shadow-elevate`, `$fs-15`) and aliased them locally
- Some sections got skipped (full GNB chrome missing in v1)
- 14% pixel drift even with Opus + designer-high

After splitting into 14 hierarchical files:
- Token invention: 0 cases (agent looked up actual names from tokens/colors.md)
- Section coverage: 100% (agent re-fetched the relevant sub-file on demand)
- Same iteration with Figma metadata → 2.5% pixel drift

## Recommended file structure

```
design_system/
├── index.md                    (300-400 lines, TL;DR + catalog)
├── conventions.md              (naming, file structure)
├── utilities.md                (.flex .gap-* .scrollY etc.)
├── mixins.md                   (flex, paddingBox, fontSpace, wordCut, mq)
├── breakpoints.md              (responsive bp list)
├── do-and-dont.md              (forced rules + anti-patterns)
├── tokens/
│   ├── colors.md               (every $color-* with usage freq)
│   ├── spacing.md              (4px scale, .gap-* utility)
│   ├── typography.md           (fs/fw/fontSpace)
│   └── radius-shadow-z.md      (every $radius-*, $shadow-*, $z-*)
└── components/
    ├── buttons.md              (every .primaryBtn / .blueBtn / etc.)
    ├── inputs.md               (input/textarea/checkbox/radio/select)
    ├── labels-badges.md        (.label + BEM modifiers)
    └── cards-modals.md         (.cardListArea / .popUpWrap)
```

### Why this layout works

1. **index.md is the catalog**: agent reads once (~3-4k tokens), gets pointers to specific files
2. **Each sub-file is self-contained**: agent fetching `tokens/colors.md` doesn't need to re-load anything else to use colors correctly
3. **Cross-references with "See also:"** at the top of each file enable navigation without loading everything
4. **Frequency data per token** lets agent pick the most-used pattern when multiple options exist

## What goes in index.md (top-level)

- 7 DO bullets (always use $color-* / 4px scale / fontSpace mixin / etc.)
- 7 DON'T bullets (no hex inline / no Tailwind / no inline style / etc.)
- File catalog with 1-line description per sub-file
- Stack info (Vue/React/Nuxt, SCSS dialect)
- Quick reference: most-used 5 tokens / 5 utility classes / 5 mixins

## What NOT to put in index.md

- Full token tables (those go in tokens/*.md)
- Component variant catalogs (components/*.md)
- Mixin definitions (mixins.md)
- Long examples (sub-files handle these)

## Concrete results

| Metric | Monolithic 1,629 lines | Split 14 files (~5,800 lines total) |
|---|---:|---:|
| Hallucinated tokens per scaffold | 4–7 | 0 |
| Sections fully covered | ~70% | 100% |
| Pixel drift (with Figma spec) | ~10% | 2.5% |
| Agent token usage per query | Full file | ~3k (index) + 1-2 sub-files |

Total content expanded ~3× but per-query consumption dropped ~50%.
