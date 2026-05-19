# Token map example

The `figma-to-spec.mjs` script has a `COLOR_MAP` (and `SPACING_MAP`, `FONT_SIZE_MAP`, `RADIUS_MAP`) at the top. Adjust these per project — this is the only customization needed.

## Codepresso example (working baseline)

```js
const COLOR_MAP = {
  "1A61EA": "$color-main",
  "1B5EE0": "$color-main-d",
  "356DDE": "$color-sub-blue",
  "0F7D68": "$color-status-green",
  "B83333": "$color-status-red",
  "FFFFFF": "$color-white",
  "EAECF3": "$color-bg-l-1",
  "F3F4FD": "$color-bg-l-2",
  "161C33": "$color-txt-d-1",
  "4E5566": "$color-txt-d-2",
  "838B9D": "$color-txt-d-3",
  "D3D7E3": "$color-line-l-2",
  "E3E5F1": "$color-line-l-3",
  // ... ~80 more from _variables.scss
};

const SPACING_MAP = {
  0: "0", 4: "$space-1", 8: "$space-2", 12: "$space-3",
  16: "$space-4", 20: "$space-5", 24: "$space-6", 32: "$space-8",
  40: "$space-10", 48: "$space-12", 64: "$space-16", 80: "$space-20",
};

const RADIUS_MAP = {
  2: "$radius-xs", 4: "$radius-sm", 6: "$radius-md",
  8: "$radius-lg", 12: "$radius-xl", 16: "$radius-2xl",
  100: "$radius-pill",
};

const FS_MAP = {
  10: "$fs-10", 11: "$fs-11", 12: "$fs-12", 13: "$fs-13",
  14: "$fs-14", 16: "$fs-16", 18: "$fs-18", 20: "$fs-20",
  22: "$fs-22", 24: "$fs-24", 30: "$fs-30", 40: "$fs-40",
};

const FW_MAP = {
  400: "$fw-regular", 500: "$fw-medium",
  600: "$fw-semibold", 700: "$fw-bold",
};
```

## How to build this for a new project

1. Open project's variables file (`_variables.scss`, `tokens.scss`, etc.)
2. For each `$color-foo: #ABCDEF;` line → add `"ABCDEF": "$color-foo"` to COLOR_MAP
3. For each `$space-N: Npx;` line → add `N: "$space-N"` to SPACING_MAP
4. Repeat for radius/fs/fw

Quick `awk` to bootstrap from `_variables.scss`:

```bash
grep -E "^\\\$color-[a-z0-9-]+:\\s*#[0-9A-Fa-f]+\\s*;" _variables.scss \
  | sed -E 's/^\$([a-z0-9-]+):\s*#([0-9A-Fa-f]+).*/"\2": "$\1",/'
```

## CSS Custom Properties version (React/Vue + CSS-vars projects)

Replace SCSS dollar tokens with `var(--*)`:

```js
const COLOR_MAP = {
  "1A61EA": "var(--color-main)",
  // ...
};
```

The rest of `figma-to-spec.mjs` works unchanged.
