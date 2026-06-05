# AIDLC Scaffolder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `aidlc-init`/`aidlc-doctor` to the codepresso plugin — a tool that scans any target repo against a 16-item "AI-native repo" template, then non-destructively scaffolds the missing pieces (analyze → interview → preview → apply → re-score).

**Architecture:** Three pure-logic libs (`aidlc-detect`, `aidlc-scan`, `aidlc-template`) hold all deterministic logic and are unit-tested against temp fixture dirs. A thin CLI (`aidlc-cli.mjs`) exposes them as subcommands (`detect`/`scan`/`plan`/`apply-static`/`score`) emitting JSON. Two markdown skills orchestrate: judgment (interview via AskUserQuestion, repo-aware authoring of AGENTS.md/CLAUDE.md/.codesight) stays in the skill; everything mechanical is in the CLI. Canonical static templates live in `templates/aidlc/`. Non-destructive throughout — existing files are never overwritten.

**Tech Stack:** Node.js ≥20, ESM `.mjs` (zero build), `node:test` + `node:assert/strict`, `node:fs`/`node:path`/`node:child_process`. Matches existing plugin conventions (`scripts/lib/*` pure fns + `scripts/*-cli.mjs` dispatcher + `skills/*/SKILL.md`).

**Spec:** `docs/superpowers/specs/2026-05-31-aidlc-scaffolder-design.md`

---

## File Structure

| File | Created/Modified | Responsibility |
|------|------------------|----------------|
| `scripts/lib/aidlc-detect.mjs` | Created | Pure: detect repo structure (mono/single), submodules, stacks, git host, ticket usage. |
| `scripts/lib/aidlc-scan.mjs` | Created | Pure: the 16-item detector registry, per-item status (present/partial/missing/na) + evidence, secret scan, score math. |
| `scripts/lib/aidlc-template.mjs` | Created | Pure: `{{VAR}}` substitution, non-destructive `writeIfAbsent`, `planFiles` (missing-only file list). |
| `scripts/aidlc-cli.mjs` | Created | Thin CLI dispatcher: `detect`/`scan`/`plan`/`apply-static`/`score`. Delegates to libs, prints JSON. |
| `templates/aidlc/**` | Created | Canonical static templates (ADR template+README, documentation-policy, ai-agent-policy, settings.json, ci.yml, check-before-push.sh, gitignore snippet, specs/plans READMEs). |
| `skills/aidlc-init/SKILL.md` | Created | Orchestrator skill: runs the 5-stage pipeline, does interview + repo-aware authoring. |
| `skills/aidlc-doctor/SKILL.md` | Created | Diagnose-only skill: detect+scan+score, no writes. |
| `tests/lib/aidlc-detect.test.mjs` | Created | Unit tests for detect. |
| `tests/lib/aidlc-scan.test.mjs` | Created | Unit tests for scan + secrets + score. |
| `tests/lib/aidlc-template.test.mjs` | Created | Unit tests for substitution + non-destructive guard + planFiles. |
| `tests/aidlc-cli.test.mjs` | Created | CLI smoke tests against temp fixtures. |
| `CLAUDE.md` | Modified | Document the new skills, CLI, libs, templates, state file. |

**Interfaces locked here (used across tasks):**

```js
// aidlc-detect.mjs
detectSubmodules(rootDir): string[]                       // relative submodule paths
detectStructure(rootDir): 'mono' | 'single'
detectStacks(rootDir, { structure, submodules }): Array<{ path: string, stack: string }>
detectHost(rootDir): 'github' | 'gitlab' | 'bitbucket' | null
detectTickets(rootDir): { hasTickets: boolean, sample: string | null }
detect(rootDir): { structure, submodules, stacks, host, tickets }

// aidlc-scan.mjs
ITEMS: Array<{ id:number, key:string, name:string, kind:'static'|'authored', detect(rootDir, ctx): {status, evidence, reason} }>
scanItem(rootDir, ctx, item): { id, key, name, kind, status, evidence: string[], reason }   // status ∈ 'present'|'partial'|'missing'|'na'
scanSecrets(rootDir): Array<{ file:string, kind:string, masked:string }>
computeScore(results): { present:number, partial:number, missing:number, na:number, percent:number }
scan(rootDir, ctx): { results, secrets, score }

// aidlc-template.mjs
substitute(content, vars): string                          // replaces {{KEY}}; unknown {{...}} left as-is
writeIfAbsent(targetPath, content): { written:boolean, reason:'created'|'exists' }
planFiles(scanResult, ctx): Array<{ path:string, kind:'static'|'authored', key:string }>   // missing/na-excluded only
```

`ctx` = the object returned by `detect(rootDir)`.

---

## Task 1: `aidlc-detect.mjs` — submodules + structure

**Files:**
- Create: `scripts/lib/aidlc-detect.mjs`
- Test: `tests/lib/aidlc-detect.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/aidlc-detect.test.mjs`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectSubmodules, detectStructure } from '../../scripts/lib/aidlc-detect.mjs';

function tmpRepo() { return mkdtempSync(join(tmpdir(), 'aidlc-')); }

describe('detectSubmodules', () => {
  it('parses .gitmodules paths', () => {
    const d = tmpRepo();
    writeFileSync(join(d, '.gitmodules'),
      '[submodule "backend/main"]\n\tpath = backend/main\n\turl = x\n' +
      '[submodule "tests"]\n\tpath = tests\n\turl = y\n');
    assert.deepEqual(detectSubmodules(d).sort(), ['backend/main', 'tests']);
    rmSync(d, { recursive: true, force: true });
  });
  it('returns [] when no .gitmodules', () => {
    const d = tmpRepo();
    assert.deepEqual(detectSubmodules(d), []);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detectStructure', () => {
  it('mono when .gitmodules has multiple submodules', () => {
    const d = tmpRepo();
    writeFileSync(join(d, '.gitmodules'), '[submodule "a"]\n\tpath = a\n[submodule "b"]\n\tpath = b\n');
    assert.equal(detectStructure(d), 'mono');
    rmSync(d, { recursive: true, force: true });
  });
  it('mono when multiple package manifests in distinct subdirs', () => {
    const d = tmpRepo();
    mkdirSync(join(d, 'svc-a')); writeFileSync(join(d, 'svc-a/package.json'), '{}');
    mkdirSync(join(d, 'svc-b')); writeFileSync(join(d, 'svc-b/go.mod'), 'module b');
    assert.equal(detectStructure(d), 'mono');
    rmSync(d, { recursive: true, force: true });
  });
  it('single for one root manifest', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'package.json'), '{}');
    assert.equal(detectStructure(d), 'single');
    rmSync(d, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/lib/aidlc-detect.test.mjs`
Expected: FAIL — `Cannot find module '.../aidlc-detect.mjs'`.

- [ ] **Step 3: Implement minimal code**

Create `scripts/lib/aidlc-detect.mjs`:

```javascript
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MANIFESTS = ['package.json', 'go.mod', 'pom.xml', 'build.gradle', 'pyproject.toml', 'requirements.txt', 'Cargo.toml'];

export function detectSubmodules(rootDir) {
  const f = join(rootDir, '.gitmodules');
  if (!existsSync(f)) return [];
  const paths = [];
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*path\s*=\s*(.+?)\s*$/);
    if (m) paths.push(m[1]);
  }
  return paths;
}

function subdirManifestCount(rootDir) {
  let count = 0;
  let entries = [];
  try { entries = readdirSync(rootDir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    const sub = join(rootDir, e.name);
    if (MANIFESTS.some(m => existsSync(join(sub, m)))) count++;
  }
  return count;
}

export function detectStructure(rootDir) {
  if (detectSubmodules(rootDir).length >= 2) return 'mono';
  if (subdirManifestCount(rootDir) >= 2) return 'mono';
  return 'single';
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/lib/aidlc-detect.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/aidlc-detect.mjs tests/lib/aidlc-detect.test.mjs
git commit -m "feat(aidlc): detect repo structure + submodules"
```

---

## Task 2: `aidlc-detect.mjs` — stacks, host, tickets, detect()

**Files:**
- Modify: `scripts/lib/aidlc-detect.mjs`
- Test: `tests/lib/aidlc-detect.test.mjs`

- [ ] **Step 1: Append failing tests**

Append to `tests/lib/aidlc-detect.test.mjs`:

```javascript
import { detectStacks, detectHost, detectTickets, detect } from '../../scripts/lib/aidlc-detect.mjs';
import { execFileSync } from 'node:child_process';

describe('detectStacks', () => {
  it('maps manifests to stacks for single repo', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'package.json'), '{}');
    assert.deepEqual(detectStacks(d, { structure: 'single', submodules: [] }), [{ path: '.', stack: 'node' }]);
    rmSync(d, { recursive: true, force: true });
  });
  it('maps per-submodule for mono', () => {
    const d = tmpRepo();
    mkdirSync(join(d, 'be')); writeFileSync(join(d, 'be/pom.xml'), '<project/>');
    mkdirSync(join(d, 'infra')); writeFileSync(join(d, 'infra/main.tf'), '');
    const got = detectStacks(d, { structure: 'mono', submodules: ['be', 'infra'] });
    assert.deepEqual(got.sort((a,b)=>a.path<b.path?-1:1),
      [{ path: 'be', stack: 'java' }, { path: 'infra', stack: 'terraform' }]);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detectHost', () => {
  it('reads github from git remote', () => {
    const d = tmpRepo();
    execFileSync('git', ['init', '-q'], { cwd: d });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/x/y.git'], { cwd: d });
    assert.equal(detectHost(d), 'github');
    rmSync(d, { recursive: true, force: true });
  });
  it('null when no remote', () => {
    const d = tmpRepo();
    execFileSync('git', ['init', '-q'], { cwd: d });
    assert.equal(detectHost(d), null);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detectTickets', () => {
  it('finds ticket pattern in git log', () => {
    const d = tmpRepo();
    execFileSync('git', ['init', '-q'], { cwd: d });
    execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '--allow-empty', '-q', '-m', 'TSK-123 do thing'], { cwd: d });
    const r = detectTickets(d);
    assert.equal(r.hasTickets, true);
    assert.match(r.sample, /TSK-123/);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detect', () => {
  it('returns the composite shape', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'package.json'), '{}');
    execFileSync('git', ['init', '-q'], { cwd: d });
    const r = detect(d);
    assert.equal(r.structure, 'single');
    assert.deepEqual(r.submodules, []);
    assert.deepEqual(r.stacks, [{ path: '.', stack: 'node' }]);
    assert.equal(r.host, null);
    assert.equal(typeof r.tickets.hasTickets, 'boolean');
    rmSync(d, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/lib/aidlc-detect.test.mjs`
Expected: FAIL — `detectStacks` is not exported.

- [ ] **Step 3: Implement**

Append to `scripts/lib/aidlc-detect.mjs`:

```javascript
import { execFileSync } from 'node:child_process';

const STACK_BY_MANIFEST = [
  ['package.json', 'node'], ['go.mod', 'go'], ['pom.xml', 'java'], ['build.gradle', 'java'],
  ['pyproject.toml', 'python'], ['requirements.txt', 'python'], ['Cargo.toml', 'rust'],
];

function stackOf(dir) {
  for (const [file, stack] of STACK_BY_MANIFEST) if (existsSync(join(dir, file))) return stack;
  // terraform: any *.tf at top of dir
  try { if (readdirSync(dir).some(f => f.endsWith('.tf'))) return 'terraform'; } catch {}
  return null;
}

export function detectStacks(rootDir, { structure, submodules }) {
  const out = [];
  if (structure === 'mono') {
    const dirs = submodules.length ? submodules
      : readdirSync(rootDir, { withFileTypes: true })
          .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
          .map(e => e.name);
    for (const p of dirs) { const s = stackOf(join(rootDir, p)); if (s) out.push({ path: p, stack: s }); }
  } else {
    const s = stackOf(rootDir); if (s) out.push({ path: '.', stack: s });
  }
  return out;
}

export function detectHost(rootDir) {
  let url = '';
  try { url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: rootDir, stdio: ['ignore','pipe','ignore'] }).toString(); }
  catch { return null; }
  if (url.includes('github.com')) return 'github';
  if (url.includes('gitlab')) return 'gitlab';
  if (url.includes('bitbucket')) return 'bitbucket';
  return null;
}

export function detectTickets(rootDir) {
  let log = '';
  try { log = execFileSync('git', ['log', '-50', '--pretty=%s'], { cwd: rootDir, stdio: ['ignore','pipe','ignore'] }).toString(); }
  catch { return { hasTickets: false, sample: null }; }
  const m = log.match(/\b[A-Z]{2,}-\d+\b/);
  return { hasTickets: !!m, sample: m ? m[0] : null };
}

export function detect(rootDir) {
  const submodules = detectSubmodules(rootDir);
  const structure = detectStructure(rootDir);
  return {
    structure,
    submodules,
    stacks: detectStacks(rootDir, { structure, submodules }),
    host: detectHost(rootDir),
    tickets: detectTickets(rootDir),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/lib/aidlc-detect.test.mjs`
Expected: PASS (all detect tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/aidlc-detect.mjs tests/lib/aidlc-detect.test.mjs
git commit -m "feat(aidlc): detect stacks, host, tickets + composite detect()"
```

---

## Task 3: `aidlc-scan.mjs` — score math + first detectors

**Files:**
- Create: `scripts/lib/aidlc-scan.mjs`
- Test: `tests/lib/aidlc-scan.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/aidlc-scan.test.mjs`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ITEMS, scanItem, computeScore } from '../../scripts/lib/aidlc-scan.mjs';

function tmpRepo() { return mkdtempSync(join(tmpdir(), 'aidlc-scan-')); }
const ctx = { structure: 'single', submodules: [], stacks: [{ path: '.', stack: 'node' }], host: 'github', tickets: { hasTickets: false } };
const itemByKey = (k) => ITEMS.find(i => i.key === k);

describe('computeScore', () => {
  it('present=1 partial=0.5 missing=0, na excluded', () => {
    const r = computeScore([
      { status: 'present' }, { status: 'present' }, { status: 'partial' }, { status: 'missing' }, { status: 'na' },
    ]);
    assert.deepEqual(r, { present: 2, partial: 1, missing: 1, na: 1, percent: 63 }); // (2 + 0.5)/4 = 62.5 → 63
  });
});

describe('detector: agents-md (#1)', () => {
  it('present when AGENTS.md exists', () => {
    const d = tmpRepo(); writeFileSync(join(d, 'AGENTS.md'), '# x');
    assert.equal(scanItem(d, ctx, itemByKey('agents-md')).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('missing when absent', () => {
    const d = tmpRepo();
    assert.equal(scanItem(d, ctx, itemByKey('agents-md')).status, 'missing');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detector: adr (#4)', () => {
  it('present with dir + TEMPLATE + >=1 ADR', () => {
    const d = tmpRepo(); mkdirSync(join(d, 'docs/decisions'), { recursive: true });
    writeFileSync(join(d, 'docs/decisions/TEMPLATE.md'), '');
    writeFileSync(join(d, 'docs/decisions/ADR-0001-x.md'), '');
    assert.equal(scanItem(d, ctx, itemByKey('adr')).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('partial with dir only', () => {
    const d = tmpRepo(); mkdirSync(join(d, 'docs/decisions'), { recursive: true });
    assert.equal(scanItem(d, ctx, itemByKey('adr')).status, 'partial');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detector: submodule-claude (#3)', () => {
  it('na for single repo', () => {
    const d = tmpRepo();
    assert.equal(scanItem(d, ctx, itemByKey('submodule-claude')).status, 'na');
    rmSync(d, { recursive: true, force: true });
  });
});

it('ITEMS has exactly 16 entries with unique keys', () => {
  assert.equal(ITEMS.length, 16);
  assert.equal(new Set(ITEMS.map(i => i.key)).size, 16);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/lib/aidlc-scan.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement score + registry skeleton + the detectors referenced by tests**

Create `scripts/lib/aidlc-scan.mjs` (detectors for the other items are added in Task 4 — this file is completed there; here we define the framework + items #1, #3, #4 so tests pass):

```javascript
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const has = (root, rel) => existsSync(join(root, rel));
const dirHasFileMatching = (root, rel, re) => {
  try { return readdirSync(join(root, rel)).some(f => re.test(f)); } catch { return false; }
};
const result = (status, evidence = [], reason = '') => ({ status, evidence, reason });

// Each detector: (rootDir, ctx) => { status, evidence, reason }
export const ITEMS = [
  { id: 1, key: 'agents-md', name: 'AGENTS.md at root', kind: 'authored',
    detect: (r) => has(r, 'AGENTS.md') ? result('present', ['AGENTS.md']) : result('missing', [], 'no AGENTS.md') },
  { id: 3, key: 'submodule-claude', name: 'Per-submodule CLAUDE.md', kind: 'authored',
    detect: (r, ctx) => {
      if (ctx.structure !== 'mono') return result('na', [], 'single-package repo');
      const subs = ctx.submodules.length ? ctx.submodules : [];
      const withClaude = subs.filter(s => has(r, join(s, 'CLAUDE.md')));
      if (subs.length === 0) return result('na', []);
      if (withClaude.length === subs.length) return result('present', withClaude.map(s => join(s, 'CLAUDE.md')));
      if (withClaude.length > 0) return result('partial', withClaude.map(s => join(s, 'CLAUDE.md')), `${withClaude.length}/${subs.length}`);
      return result('missing', [], 'no submodule CLAUDE.md');
    } },
  { id: 4, key: 'adr', name: 'ADRs (docs/decisions/)', kind: 'static',
    detect: (r) => {
      if (!has(r, 'docs/decisions')) return result('missing', [], 'no docs/decisions/');
      const hasTemplate = has(r, 'docs/decisions/TEMPLATE.md');
      const hasAdr = dirHasFileMatching(r, 'docs/decisions', /^ADR-\d+.*\.md$/i);
      if (hasTemplate && hasAdr) return result('present', ['docs/decisions/']);
      return result('partial', ['docs/decisions/'], 'dir exists but missing TEMPLATE or ADR');
    } },
];

export function scanItem(rootDir, ctx, item) {
  const { status, evidence, reason } = item.detect(rootDir, ctx);
  return { id: item.id, key: item.key, name: item.name, kind: item.kind, status, evidence, reason };
}

export function computeScore(results) {
  const present = results.filter(r => r.status === 'present').length;
  const partial = results.filter(r => r.status === 'partial').length;
  const missing = results.filter(r => r.status === 'missing').length;
  const na = results.filter(r => r.status === 'na').length;
  const scored = present + partial + missing;
  const percent = scored === 0 ? 0 : Math.round(((present + partial * 0.5) / scored) * 100);
  return { present, partial, missing, na, percent };
}
```

> NOTE: `ITEMS` must reach 16 entries for the "16 entries" test. Add the remaining 13 detectors in Task 4 **before** running this test green, OR temporarily mark this one test `{ skip: true }` and unskip in Task 4. Recommended: implement Task 4's detectors first if running tests strictly per-task; the registry test lives with Task 4.

- [ ] **Step 4: Defer the "16 entries" assertion**

Edit the `ITEMS has exactly 16` test to `it('ITEMS has exactly 16 entries with unique keys', { skip: 'completed in Task 4' }, ...)` so Task 3 runs green for the detector/score tests. (Unskipped in Task 4 Step 1.)

- [ ] **Step 5: Run to verify pass**

Run: `node --test tests/lib/aidlc-scan.test.mjs`
Expected: PASS (score + agents-md + adr + submodule-claude tests; 16-entries skipped).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/aidlc-scan.mjs tests/lib/aidlc-scan.test.mjs
git commit -m "feat(aidlc): scan framework + score + items #1/#3/#4"
```

---

## Task 4: `aidlc-scan.mjs` — remaining 13 detectors + secret scan

**Files:**
- Modify: `scripts/lib/aidlc-scan.mjs`
- Test: `tests/lib/aidlc-scan.test.mjs`

- [ ] **Step 1: Unskip the 16-entries test + add secret + representative detector tests**

In `tests/lib/aidlc-scan.test.mjs`: remove the `{ skip: ... }` from the 16-entries test, and append:

```javascript
import { scanSecrets, scan } from '../../scripts/lib/aidlc-scan.mjs';

describe('detector: ci-pr (#11)', () => {
  it('present when a workflow has pull_request trigger', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.github/workflows'), { recursive: true });
    writeFileSync(join(d, '.github/workflows/ci.yml'), 'on:\n  pull_request:\njobs:\n  t:\n    steps: []\n');
    assert.equal(scanItem(d, ctx, ITEMS.find(i=>i.key==='ci-pr')).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('missing when no workflow', () => {
    const d = tmpRepo();
    assert.equal(scanItem(d, ctx, ITEMS.find(i=>i.key==='ci-pr')).status, 'missing');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detector: permission-matrix (#10)', () => {
  it('present for committed settings.json', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.claude'), { recursive: true });
    writeFileSync(join(d, '.claude/settings.json'), '{"permissions":{}}');
    assert.equal(scanItem(d, ctx, ITEMS.find(i=>i.key==='permission-matrix')).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('partial for local-only', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.claude'), { recursive: true });
    writeFileSync(join(d, '.claude/settings.local.json'), '{"permissions":{}}');
    assert.equal(scanItem(d, ctx, ITEMS.find(i=>i.key==='permission-matrix')).status, 'partial');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('scanSecrets', () => {
  it('flags a notion token, masked', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.claude'), { recursive: true });
    writeFileSync(join(d, '.claude/settings.local.json'), 'Bearer ntn_ABCDEFGHIJ1234567890');
    const s = scanSecrets(d);
    assert.equal(s.length, 1);
    assert.equal(s[0].kind, 'notion-token');
    assert.ok(!s[0].masked.includes('ABCDEFGHIJ1234567890'));
    rmSync(d, { recursive: true, force: true });
  });
  it('returns [] when clean', () => {
    const d = tmpRepo();
    assert.deepEqual(scanSecrets(d), []);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('scan (composite)', () => {
  it('empty repo → all 16 missing-or-na, percent low', () => {
    const d = tmpRepo();
    const r = scan(d, ctx);
    assert.equal(r.results.length, 16);
    assert.ok(r.score.percent <= 10);
    rmSync(d, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/lib/aidlc-scan.test.mjs`
Expected: FAIL — 16-entries assertion fails (only 3 items), `scanSecrets`/`scan` not exported, ci-pr/permission-matrix keys not found.

- [ ] **Step 3: Add the remaining 13 detectors + scanSecrets + scan**

Insert the following detector objects into the `ITEMS` array (between `id:4` and the closing `]`), keeping ascending `id`:

```javascript
  { id: 2, key: 'claude-md', name: 'CLAUDE.md at root', kind: 'authored',
    detect: (r) => has(r, 'CLAUDE.md') ? result('present', ['CLAUDE.md']) : result('missing') },
  { id: 5, key: 'specs-plans', name: 'Specs+Plans workflow', kind: 'static',
    detect: (r) => (has(r, 'docs/superpowers/specs') || has(r, 'docs/superpowers/plans'))
      ? result('present', ['docs/superpowers/'])
      : result('missing') },
  { id: 6, key: 'agent-policy', name: 'AI agent policy', kind: 'static',
    detect: (r) => has(r, 'docs/ai-agent-policy.md') ? result('present', ['docs/ai-agent-policy.md']) : result('missing') },
  { id: 7, key: 'runbook', name: 'Runbook + executable skill split', kind: 'static',
    detect: (r) => has(r, 'docs/oncall-runbook.md') || has(r, '.claude/commands')
      ? result('present', ['docs/oncall-runbook.md|.claude/commands']) : result('missing') },
  { id: 8, key: 'codesight', name: 'Codesight / context index', kind: 'authored',
    detect: (r) => has(r, '.codesight') ? result('present', ['.codesight/']) : result('missing') },
  { id: 9, key: 'hooks', name: 'Session/automation hooks', kind: 'static',
    detect: (r) => {
      if (has(r, 'hooks/hooks.json')) return result('present', ['hooks/hooks.json']);
      for (const s of ['.claude/settings.json', '.claude/settings.local.json'])
        if (has(r, s) && readFileSync(join(r, s), 'utf8').includes('hooks')) return result('present', [s]);
      return result('missing');
    } },
  { id: 10, key: 'permission-matrix', name: 'Permission matrix', kind: 'static',
    detect: (r) => {
      if (has(r, '.claude/settings.json')) return result('present', ['.claude/settings.json']);
      if (has(r, '.claude/settings.local.json')) return result('partial', ['.claude/settings.local.json'], 'local-only, not committed/shared');
      return result('missing');
    } },
  { id: 11, key: 'ci-pr', name: 'CI gate on every PR', kind: 'static',
    detect: (r) => {
      const dir = '.github/workflows';
      let files = [];
      try { files = readdirSync(join(r, dir)).filter(f => /\.ya?ml$/.test(f)); } catch { return result('missing'); }
      const prFile = files.find(f => readFileSync(join(r, dir, f), 'utf8').includes('pull_request'));
      if (prFile) return result('present', [join(dir, prFile)]);
      if (files.length) return result('partial', [dir], 'workflows exist but none PR-triggered');
      return result('missing');
    } },
  { id: 12, key: 'traceability', name: 'Intent→PR→deploy traceability', kind: 'static',
    detect: (r, ctx) => ctx.tickets && ctx.tickets.hasTickets
      ? result('partial', [], 'tickets used; confirm PR-title convention in interview')
      : result('partial', [], 'needs-confirm: no ticket convention detected') },
  { id: 13, key: 'doc-policy', name: 'Documentation policy', kind: 'static',
    detect: (r) => has(r, 'docs/documentation-policy.md') ? result('present', ['docs/documentation-policy.md']) : result('missing') },
  { id: 14, key: 'feature-flags', name: 'Graceful degradation / feature flags', kind: 'static',
    detect: (r) => result('partial', [], 'needs-confirm: integration gating reviewed in interview') },
  { id: 15, key: 'pre-push', name: 'Pre-push / pre-merge validation', kind: 'static',
    detect: (r) => has(r, 'scripts/check-before-push.sh') ? result('present', ['scripts/check-before-push.sh']) : result('missing') },
  { id: 16, key: 'unit-tests', name: 'Unit tests for deterministic logic', kind: 'static',
    detect: (r) => {
      if (!has(r, 'package.json')) return has(r, 'tests') ? result('present', ['tests/']) : result('missing');
      try {
        const pkg = JSON.parse(readFileSync(join(r, 'package.json'), 'utf8'));
        if (pkg.scripts && pkg.scripts.test && has(r, 'tests')) return result('present', ['tests/ + npm test']);
      } catch {}
      return has(r, 'tests') ? result('partial', ['tests/'], 'tests dir but no test script') : result('missing');
    } },
```

Then sort `ITEMS` by `id` (or keep insertion ascending) and append the secret scanner + composite scan:

```javascript
const SECRET_PATTERNS = [
  { kind: 'notion-token', re: /ntn_[A-Za-z0-9]{16,}/g },
  { kind: 'github-pat', re: /ghp_[A-Za-z0-9]{36}/g },
];
const SECRET_SCAN_FILES = ['.claude/settings.local.json', '.claude/settings.json', '.env', '.env.local'];

export function scanSecrets(rootDir) {
  const found = [];
  for (const rel of SECRET_SCAN_FILES) {
    const p = join(rootDir, rel);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const { kind, re } of SECRET_PATTERNS) {
      const m = text.match(re);
      if (m) found.push({ file: rel, kind, masked: m[0].slice(0, 8) + '…[REDACTED]' });
    }
  }
  return found;
}

export function scan(rootDir, ctx) {
  const results = ITEMS.slice().sort((a, b) => a.id - b.id).map(item => scanItem(rootDir, ctx, item));
  const secrets = scanSecrets(rootDir);
  return { results, secrets, score: computeScore(results) };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/lib/aidlc-scan.test.mjs`
Expected: PASS — 16-entries, ci-pr, permission-matrix, scanSecrets, scan all green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/aidlc-scan.mjs tests/lib/aidlc-scan.test.mjs
git commit -m "feat(aidlc): complete 16-item detectors + secret scan + composite scan()"
```

---

## Task 5: `aidlc-template.mjs` — substitute, non-destructive write, planFiles

**Files:**
- Create: `scripts/lib/aidlc-template.mjs`
- Test: `tests/lib/aidlc-template.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/aidlc-template.test.mjs`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { substitute, writeIfAbsent, planFiles } from '../../scripts/lib/aidlc-template.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'aidlc-tpl-')); }

describe('substitute', () => {
  it('replaces known vars, leaves unknown', () => {
    assert.equal(substitute('a {{NAME}} {{MISSING}}', { NAME: 'x' }), 'a x {{MISSING}}');
  });
});

describe('writeIfAbsent', () => {
  it('creates when absent', () => {
    const d = tmp(); const p = join(d, 'AGENTS.md');
    assert.deepEqual(writeIfAbsent(p, 'hello'), { written: true, reason: 'created' });
    assert.equal(readFileSync(p, 'utf8'), 'hello');
    rmSync(d, { recursive: true, force: true });
  });
  it('does NOT overwrite when present', () => {
    const d = tmp(); const p = join(d, 'AGENTS.md');
    writeFileSync(p, 'original');
    assert.deepEqual(writeIfAbsent(p, 'new'), { written: false, reason: 'exists' });
    assert.equal(readFileSync(p, 'utf8'), 'original');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('planFiles', () => {
  it('lists only missing items, excludes present/na', () => {
    const scanResult = { results: [
      { key: 'agents-md', kind: 'authored', status: 'missing' },
      { key: 'adr', kind: 'static', status: 'present' },
      { key: 'submodule-claude', kind: 'authored', status: 'na' },
      { key: 'doc-policy', kind: 'static', status: 'missing' },
    ] };
    const got = planFiles(scanResult, { structure: 'single' });
    assert.deepEqual(got.map(f => f.key).sort(), ['agents-md', 'doc-policy']);
    assert.equal(got.find(f => f.key === 'doc-policy').kind, 'static');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/lib/aidlc-template.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `scripts/lib/aidlc-template.mjs`:

```javascript
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function substitute(content, vars) {
  return content.replace(/\{\{([A-Z_]+)\}\}/g, (full, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : full);
}

export function writeIfAbsent(targetPath, content) {
  if (existsSync(targetPath)) return { written: false, reason: 'exists' };
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content);
  return { written: true, reason: 'created' };
}

// Maps each item key → the repo-relative path it scaffolds.
export const ITEM_PATHS = {
  'agents-md': 'AGENTS.md',
  'claude-md': 'CLAUDE.md',
  'adr': 'docs/decisions/TEMPLATE.md',
  'specs-plans': 'docs/superpowers/specs/README.md',
  'agent-policy': 'docs/ai-agent-policy.md',
  'doc-policy': 'docs/documentation-policy.md',
  'permission-matrix': '.claude/settings.json',
  'ci-pr': '.github/workflows/ci.yml',
  'pre-push': 'scripts/check-before-push.sh',
  'codesight': '.codesight/CODESIGHT.md',
};

export function planFiles(scanResult, ctx) {
  const out = [];
  for (const r of scanResult.results) {
    if (r.status !== 'missing') continue;            // non-destructive: only missing
    const path = ITEM_PATHS[r.key];
    if (!path) continue;                              // items with no single scaffold file (e.g. traceability) handled in skill
    out.push({ path, kind: r.kind, key: r.key });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/lib/aidlc-template.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/aidlc-template.mjs tests/lib/aidlc-template.test.mjs
git commit -m "feat(aidlc): template substitution, non-destructive write, planFiles"
```

---

## Task 6: Canonical templates (`templates/aidlc/`)

**Files:**
- Create: `templates/aidlc/docs/decisions/TEMPLATE.md`, `templates/aidlc/docs/decisions/README.md`
- Create: `templates/aidlc/docs/documentation-policy.md`
- Create: `templates/aidlc/docs/ai-agent-policy.md`
- Create: `templates/aidlc/.claude/settings.json`
- Create: `templates/aidlc/.github/workflows/ci.yml`
- Create: `templates/aidlc/scripts/check-before-push.sh`
- Create: `templates/aidlc/docs/superpowers/specs/README.md`, `templates/aidlc/docs/superpowers/plans/README.md`

- [ ] **Step 1: Create the ADR template**

`templates/aidlc/docs/decisions/TEMPLATE.md`:

```markdown
# ADR-NNNN: <title>

**Status:** Proposed | Accepted | Superseded by ADR-XXXX
**Date:** YYYY-MM-DD

## Context
What forces are at play, what problem are we solving?

## Decision
What we decided to do.

## Consequences
What becomes easier or harder as a result.
```

- [ ] **Step 2: Create the remaining canonical files**

`templates/aidlc/docs/decisions/README.md`:
```markdown
# Architecture Decision Records

Append-only log of load-bearing decisions. Copy `TEMPLATE.md` → `ADR-NNNN-<slug>.md`, never edit a decided ADR (supersede with a new one).
```

`templates/aidlc/.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: {{TEST_CMD}}
```

`templates/aidlc/scripts/check-before-push.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
# Block plaintext secrets before they leave the machine.
if git diff --cached -U0 | grep -nE 'ntn_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{36}'; then
  echo "❌ Potential secret in staged changes — aborting." >&2; exit 1
fi
echo "✅ pre-push checks passed"
```

`templates/aidlc/docs/superpowers/specs/README.md`:
```markdown
# Specs

Dated, feature-scoped design docs: `YYYY-MM-DD-<slug>-design.md`. Frozen after the feature ships (Scoped — see documentation-policy.md).
```

`templates/aidlc/docs/superpowers/plans/README.md`:
```markdown
# Plans

Dated implementation plans: `YYYY-MM-DD-<slug>.md`. One plan per feature, bite-sized tasks.
```

`templates/aidlc/docs/documentation-policy.md`:
```markdown
# Documentation Policy

| Category | Examples | Lifetime |
|----------|----------|----------|
| Permanent | README, AGENTS.md, CLAUDE.md | Lives with the code |
| ADR | docs/decisions/ADR-*.md | Append-only, never deleted |
| Scoped | docs/superpowers/specs+plans | Frozen after the feature ships |
| Ephemeral | scratch notes | Gitignored, never committed |
```

`templates/aidlc/docs/ai-agent-policy.md`:
```markdown
# AI Agent Policy

**Status:** Mandatory for all AI coding agents in this repo.

- Investigate before fixing: read the code/history first; no guessing.
- No sweeping multi-file `sed`/replace without verifying on one file first.
- Evidence before claims: run the test/build and read output before saying "done".
- Two-strikes: if the same approach fails twice, stop and reassess.

## Stack-specific traps
{{STACK_TRAPS}}
```

`templates/aidlc/.claude/settings.json`:
```json
{
  "permissions": {
    "allow": ["Bash(npm test)", "Bash(git status)", "Bash(git diff:*)"],
    "deny": ["Bash(rm -rf /:*)"]
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add templates/aidlc
git commit -m "feat(aidlc): canonical scaffolding templates"
```

---

## Task 7: `aidlc-cli.mjs` dispatcher + smoke tests

**Files:**
- Create: `scripts/aidlc-cli.mjs`
- Test: `tests/aidlc-cli.test.mjs`

- [ ] **Step 1: Write failing smoke tests**

Create `tests/aidlc-cli.test.mjs`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const CLI = resolve('scripts/aidlc-cli.mjs');
function tmp() { return mkdtempSync(join(tmpdir(), 'aidlc-cli-')); }
const run = (args, cwd) => JSON.parse(execFileSync('node', [CLI, ...args], { cwd }).toString());

describe('aidlc-cli', () => {
  it('detect → JSON with structure', () => {
    const d = tmp(); writeFileSync(join(d, 'package.json'), '{}');
    const out = run(['detect', d], d);
    assert.equal(out.structure, 'single');
    rmSync(d, { recursive: true, force: true });
  });
  it('scan → 16 results + score', () => {
    const d = tmp();
    const out = run(['scan', d], d);
    assert.equal(out.results.length, 16);
    assert.ok('percent' in out.score);
    rmSync(d, { recursive: true, force: true });
  });
  it('plan → missing files list', () => {
    const d = tmp();
    const out = run(['plan', d], d);
    assert.ok(Array.isArray(out));
    assert.ok(out.some(f => f.key === 'agents-md'));
    rmSync(d, { recursive: true, force: true });
  });
  it('apply-static → creates doc-policy, skips if present', () => {
    const d = tmp();
    run(['apply-static', d], d);
    assert.ok(existsSync(join(d, 'docs/documentation-policy.md')));
    rmSync(d, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/aidlc-cli.test.mjs`
Expected: FAIL — CLI file missing.

- [ ] **Step 3: Implement the dispatcher**

Create `scripts/aidlc-cli.mjs`:

```javascript
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from './lib/aidlc-detect.mjs';
import { scan } from './lib/aidlc-scan.mjs';
import { planFiles, substitute, writeIfAbsent, ITEM_PATHS } from './lib/aidlc-template.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(HERE, '../templates/aidlc');

const [cmd, targetArg] = process.argv.slice(2);
const root = resolve(targetArg || '.');
const out = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');

function testCmd(ctx) {
  const stacks = ctx.stacks.map(s => s.stack);
  if (stacks.includes('node')) return 'npm test';
  if (stacks.includes('go')) return 'go test ./...';
  if (stacks.includes('java')) return './gradlew test';
  if (stacks.includes('python')) return 'pytest';
  return 'echo "no test command configured"';
}

function applyStatic(ctx) {
  const sc = scan(root, ctx);
  const vars = {
    PROJECT_NAME: root.split('/').pop(),
    STACKS: ctx.stacks.map(s => s.stack).join(', ') || 'unknown',
    TICKET_PREFIX: ctx.tickets.sample ? ctx.tickets.sample.split('-')[0] : 'TASK',
    HOST: ctx.host || 'unknown',
    TEST_CMD: testCmd(ctx),
    STACK_TRAPS: '- (fill in stack-specific gotchas as you learn them)',
  };
  const report = [];
  for (const f of planFiles(sc, ctx)) {
    if (f.kind !== 'static') continue;                 // authored files handled by the skill
    const tplPath = join(TEMPLATES, ITEM_PATHS[f.key]);
    let content;
    try { content = substitute(readFileSync(tplPath, 'utf8'), vars); }
    catch { report.push({ key: f.key, path: f.path, result: 'no-template' }); continue; }
    const w = writeIfAbsent(join(root, f.path), content);
    report.push({ key: f.key, path: f.path, result: w.reason });
  }
  return report;
}

switch (cmd) {
  case 'detect': out(detect(root)); break;
  case 'scan': out(scan(root, detect(root))); break;
  case 'score': out(scan(root, detect(root)).score); break;
  case 'plan': out(planFiles(scan(root, detect(root)), detect(root))); break;
  case 'apply-static': out(applyStatic(detect(root))); break;
  default:
    process.stderr.write(`usage: aidlc-cli <detect|scan|score|plan|apply-static> <path>\n`);
    process.exit(1);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/aidlc-cli.test.mjs`
Expected: PASS (4 smoke tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all `aidlc-*` tests + existing tests PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/aidlc-cli.mjs tests/aidlc-cli.test.mjs
git commit -m "feat(aidlc): CLI dispatcher (detect/scan/score/plan/apply-static)"
```

---

## Task 8: `skills/aidlc-init/SKILL.md` (orchestrator)

**Files:**
- Create: `skills/aidlc-init/SKILL.md`

- [ ] **Step 1: Write the skill**

Create `skills/aidlc-init/SKILL.md` with this content:

````markdown
---
name: aidlc-init
description: Scaffold an AI-native AIDLC repo structure into a target path — analyze, interview, preview, apply (missing only), re-score. Non-destructive.
---

<Purpose>
Bring any repo up to the team's 16-item "AI-native repo" template. Diagnose what's present, ask only what can't be inferred, preview what will be created, then create only the MISSING pieces (never overwrite). Finish by re-scoring.
</Purpose>

<Use_When>
- `/codepresso:aidlc-init <target-path>` invoked
- User says "set up AIDLC structure", "make this repo AI-native", "scaffold AGENTS.md/ADR/policy"
</Use_When>

<Steps>
1. Resolve `<target-path>` (default = current project). Confirm it's a git repo; if not, warn and ask whether to continue.

2. **Analyze (CLI):** run `node ${plugin}/scripts/aidlc-cli.mjs detect <path>` then `... scan <path>`.
   Show the user a compact 16-item table (status + evidence) and the overall %. If `secrets[]` is non-empty, surface a 🔴 warning at the top and tell the user to rotate them — do NOT copy any secret value anywhere.

3. **Interview (AskUserQuestion, only the non-inferable):**
   - Confirm detected structure/stacks/submodules; let the user correct.
   - Tool targets (multi): AGENTS.md + CLAUDE.md always; optional `.cursor/rules`, `.amazonq/rules`, `.github/copilot-instructions.md`, `.clinerules`.
   - Integrations on/off (Notion/Figma/Google/AWS): default ALL OFF.
   - Ticket convention: confirm prefix (e.g. `TSK-`) or "none".

4. **Preview (CLI):** run `... plan <path>`. Show the file tree to be created, marking each as static vs authored. Ask for explicit confirmation. Do NOT write anything before confirmation.

5. **Apply:**
   a. Static: run `... apply-static <path>` (copies canonical templates, non-destructive).
   b. Authored: YOU write these files using the detect/scan output, ONLY if scan marked them missing, and ONLY via non-destructive create (check existence first):
      - `AGENTS.md` — the single authoritative entry point: build/test/run commands (use the detected stack's real commands), conventions, a short architecture overview. This holds the real content.
      - `CLAUDE.md` — a thin pointer: "See AGENTS.md for this repo's agent guidance." No duplicated content.
      - Selected tool-target files (`.cursor/rules` etc.) — thin pointers to AGENTS.md in each tool's format.
      - If `structure=mono`: for each submodule, author `<submodule>/CLAUDE.md` with that submodule's stack-specific guidance (this is the submodule's authoritative file).
      - `.codesight/CODESIGHT.md` — a structural summary (key dirs, entry points, how to run). For very large monorepos, summarize and **log what you omitted** (never silently truncate).

6. **Re-score (CLI):** run `... score <path>` and report the new % + remaining gaps.

7. End with a navigation hint: `💡 /codepresso:aidlc-doctor <path> — re-check compliance anytime`.
</Steps>

<Tool_Usage>
- `Bash` for the `aidlc-cli.mjs` subcommands
- `AskUserQuestion` for the interview + preview confirmation
- `Read`/`Write` for authored files (Write only after existence check — non-destructive)
</Tool_Usage>
````

- [ ] **Step 2: Verify skill is discoverable**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('skills/aidlc-init/SKILL.md','utf8');if(!/^---[\s\S]*name: aidlc-init[\s\S]*---/.test(s))throw new Error('bad frontmatter');console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add skills/aidlc-init/SKILL.md
git commit -m "feat(aidlc): aidlc-init orchestrator skill"
```

---

## Task 9: `skills/aidlc-doctor/SKILL.md` (diagnose-only)

**Files:**
- Create: `skills/aidlc-doctor/SKILL.md`

- [ ] **Step 1: Write the skill**

Create `skills/aidlc-doctor/SKILL.md`:

````markdown
---
name: aidlc-doctor
description: Diagnose-only AI-native compliance check for a target repo — detect + scan + score, no file changes. Use to re-check drift over time.
---

<Purpose>
Report how compliant a repo is against the 16-item AI-native template, without changing anything. The read-only companion to aidlc-init.
</Purpose>

<Use_When>
- `/codepresso:aidlc-doctor <target-path>` invoked
- User asks "how AI-native is this repo", "check compliance", "what's missing"
</Use_When>

<Steps>
1. Resolve `<target-path>` (default = current project).
2. Run `node ${plugin}/scripts/aidlc-cli.mjs scan <path>`.
3. Show the 16-item table (status + evidence + reason) and overall %.
4. If `secrets[]` non-empty → 🔴 surface (masked), recommend rotation. Never echo the raw value.
5. List the top missing/partial gaps, ordered by value. Suggest `/codepresso:aidlc-init <path>` to fix.
6. Do NOT write or modify any file.
</Steps>

<Tool_Usage>
- `Bash` for `aidlc-cli.mjs scan`
- (read-only — no Write)
</Tool_Usage>
````

- [ ] **Step 2: Commit**

```bash
git add skills/aidlc-doctor/SKILL.md
git commit -m "feat(aidlc): aidlc-doctor diagnose-only skill"
```

---

## Task 10: Document in `CLAUDE.md` + final suite

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add an AIDLC scaffolder section to CLAUDE.md**

Add under the skills/architecture area of `CLAUDE.md`:

```markdown
### AIDLC Scaffolder (`aidlc-init` / `aidlc-doctor`)

Scaffolds the 16-item AI-native repo template into any target path. Non-destructive (creates only Missing items). Pipeline: detect → scan → interview → preview → apply → re-score.

- Skills: `skills/aidlc-init/SKILL.md` (full pipeline), `skills/aidlc-doctor/SKILL.md` (diagnose-only).
- CLI: `scripts/aidlc-cli.mjs` — `detect`/`scan`/`score`/`plan`/`apply-static` (JSON out).
- Libs (pure, tested): `scripts/lib/aidlc-detect.mjs`, `aidlc-scan.mjs` (16 detectors + secret scan + score), `aidlc-template.mjs` (substitution + non-destructive write).
- Templates: `templates/aidlc/**` (canonical static files).
- State: `<target>/.codepresso/state/aidlc-scorecard.json` (last scan).
- Content model: structural/policy files = canonical templates; AGENTS.md/CLAUDE.md/codesight = repo-aware authored. AGENTS.md is the single authoritative entry point; CLAUDE.md + other tool files are thin pointers.
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests PASS (existing + 4 new aidlc test files).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(aidlc): document scaffolder skills, CLI, libs in CLAUDE.md"
```

---

## Self-Review Notes (for the planner)

- **Spec coverage:** §4.1 files → Tasks 1-10. §5 detect → T1-2. §6 scan+secrets+score → T3-4. §7 interview → T8 skill step 3. §8 apply (static+authored+preview+monorepo) → T7 (static) + T8 step 5 (authored/mono). §9 templates → T6. §10 doctor → T9. §11 error handling → T8 steps 1/4/5 + non-destructive guard (T5). §12 testing → T1-7 tests. §2.1 "existing features unaffected" → no existing skill/hook/script modified; only `CLAUDE.md` touched (T10).
- **Non-destructive guarantee:** every write path (static via `writeIfAbsent` T5/T7; authored via skill existence-check T8) cannot overwrite. Covered by `aidlc-template.test.mjs` "does NOT overwrite".
- **Type consistency:** `ctx` shape from `detect()` (T2) is consumed unchanged by `scan`/detectors (T3-4) and `planFiles` (T5). `status` enum `present|partial|missing|na` consistent across scan + planFiles + score. `ITEM_PATHS` keys (T5) match `ITEMS` keys (T3-4).
- **Item #12/#14** intentionally have no `ITEM_PATHS` entry (no single scaffold file) — confirmed/handled in interview, not auto-scaffolded; `planFiles` skips keys without a path. Consistent with spec §6 "needs-confirm".
