import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ITEMS, scanItem, computeScore, scanSecrets, scan } from '../../scripts/lib/aidlc-scan.mjs';

function tmpRepo() { return mkdtempSync(join(tmpdir(), 'aidlc-scan-')); }
const ctx = { structure: 'single', submodules: [], stacks: [{ path: '.', stack: 'node' }], host: 'github', tickets: { hasTickets: false } };
const itemByKey = (k) => ITEMS.find(i => i.key === k);

describe('computeScore', () => {
  it('present=1 partial=0.5 missing=0, na excluded', () => {
    const r = computeScore([
      { status: 'present' }, { status: 'present' }, { status: 'partial' }, { status: 'missing' }, { status: 'na' },
    ]);
    assert.deepEqual(r, { present: 2, partial: 1, missing: 1, na: 1, percent: 63 });
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

it('ITEMS has exactly 18 entries with unique keys', () => {
  assert.equal(ITEMS.length, 18);
  assert.equal(new Set(ITEMS.map(i => i.key)).size, 18);
});

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
  it('empty repo → all 18 missing-or-na, percent low', () => {
    const d = tmpRepo();
    const r = scan(d, ctx);
    assert.equal(r.results.length, 18);
    assert.ok(r.score.percent <= 10);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('scanSecrets — multiple', () => {
  it('reports every token, not just the first', () => {
    const d = mkdtempSync(join(tmpdir(), 'aidlc-scan-'));
    mkdirSync(join(d, '.claude'), { recursive: true });
    writeFileSync(join(d, '.claude/settings.local.json'), 'a ntn_AAAAAAAAAA1111111111 b ntn_BBBBBBBBBB2222222222');
    const s = scanSecrets(d);
    assert.equal(s.length, 2);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detector: pre-push (#15) husky', () => {
  it('present with .husky/pre-push', () => {
    const d = mkdtempSync(join(tmpdir(), 'aidlc-scan-'));
    mkdirSync(join(d, '.husky'), { recursive: true });
    writeFileSync(join(d, '.husky/pre-push'), '#!/bin/sh');
    assert.equal(scanItem(d, ctx, ITEMS.find(i=>i.key==='pre-push')).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
});

const prePush = () => ITEMS.find(i => i.key === 'pre-push');
const codesight = () => ITEMS.find(i => i.key === 'codesight');
const ciPr = () => ITEMS.find(i => i.key === 'ci-pr');
const localDevItem = () => ITEMS.find(i => i.key === 'local-dev');
const multitool = () => ITEMS.find(i => i.key === 'multitool-coherence');

describe('detector: pre-push (#15) functional wiring', () => {
  it('partial when only a check script exists but not wired', () => {
    const d = tmpRepo(); mkdirSync(join(d, 'scripts'), { recursive: true });
    writeFileSync(join(d, 'scripts/check-before-push.sh'), '#!/bin/sh');
    assert.equal(scanItem(d, ctx, prePush()).status, 'partial');
    rmSync(d, { recursive: true, force: true });
  });
  it('present when real .git/hooks/pre-push (not .sample)', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.git/hooks'), { recursive: true });
    writeFileSync(join(d, '.git/hooks/pre-push'), '#!/bin/sh\necho hi');
    assert.equal(scanItem(d, ctx, prePush()).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('missing when nothing', () => {
    const d = tmpRepo();
    assert.equal(scanItem(d, ctx, prePush()).status, 'missing');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detector: codesight (#8) functional', () => {
  it('missing when no .codesight dir', () => {
    const d = tmpRepo();
    assert.equal(scanItem(d, ctx, codesight()).status, 'missing');
    rmSync(d, { recursive: true, force: true });
  });
  it('partial when dir exists, stale, no hook', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.codesight'), { recursive: true });
    const p = join(d, '.codesight/CODESIGHT.md');
    writeFileSync(p, '# old');
    const old = new Date(Date.now() - 30 * 86400000);
    utimesSync(p, old, old);
    assert.equal(scanItem(d, ctx, codesight()).status, 'partial');
    rmSync(d, { recursive: true, force: true });
  });
  it('present when fresh CODESIGHT.md (<14d)', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.codesight'), { recursive: true });
    writeFileSync(join(d, '.codesight/CODESIGHT.md'), '# fresh');
    assert.equal(scanItem(d, ctx, codesight()).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('present when a SessionStart hook references codesight (even if stale)', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.codesight'), { recursive: true });
    const p = join(d, '.codesight/CODESIGHT.md'); writeFileSync(p, '# old');
    const old = new Date(Date.now() - 30 * 86400000); utimesSync(p, old, old);
    mkdirSync(join(d, '.claude'), { recursive: true });
    writeFileSync(join(d, '.claude/settings.json'), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ command: 'node scripts/codesight-scan.mjs' }] }] },
    }));
    assert.equal(scanItem(d, ctx, codesight()).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detector: ci-pr (#11) host-aware', () => {
  it('na when host is none/null', () => {
    const d = tmpRepo();
    const c = { ...ctx, host: null };
    assert.equal(scanItem(d, c, ciPr()).status, 'na');
    rmSync(d, { recursive: true, force: true });
  });
  it('present for github with pull_request trigger', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.github/workflows'), { recursive: true });
    writeFileSync(join(d, '.github/workflows/ci.yml'), 'on:\n  pull_request:\n');
    assert.equal(scanItem(d, { ...ctx, host: 'github' }, ciPr()).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('present for gitlab with merge_request', () => {
    const d = tmpRepo();
    writeFileSync(join(d, '.gitlab-ci.yml'), 'rules:\n  - if: $CI_MERGE_REQUEST_IID\n');
    assert.equal(scanItem(d, { ...ctx, host: 'gitlab' }, ciPr()).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('present for bitbucket with pull-requests', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'bitbucket-pipelines.yml'), 'pipelines:\n  pull-requests:\n    "**": []\n');
    assert.equal(scanItem(d, { ...ctx, host: 'bitbucket' }, ciPr()).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('partial when github workflow exists but no PR trigger', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.github/workflows'), { recursive: true });
    writeFileSync(join(d, '.github/workflows/ci.yml'), 'on:\n  push:\n');
    assert.equal(scanItem(d, { ...ctx, host: 'github' }, ciPr()).status, 'partial');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detector: local-dev (#17)', () => {
  it('missing when no signal', () => {
    const d = tmpRepo();
    const c = { ...ctx, localDev: { compose: false, makefileTarget: false, script: false, npmDev: false } };
    assert.equal(scanItem(d, c, localDevItem()).status, 'missing');
    rmSync(d, { recursive: true, force: true });
  });
  it('present when makefileTarget', () => {
    const d = tmpRepo();
    const c = { ...ctx, localDev: { compose: false, makefileTarget: true, script: false, npmDev: false } };
    assert.equal(scanItem(d, c, localDevItem()).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('present when npmDev', () => {
    const d = tmpRepo();
    const c = { ...ctx, localDev: { compose: false, makefileTarget: false, script: false, npmDev: true } };
    assert.equal(scanItem(d, c, localDevItem()).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('partial when compose only', () => {
    const d = tmpRepo();
    const c = { ...ctx, localDev: { compose: true, makefileTarget: false, script: false, npmDev: false } };
    assert.equal(scanItem(d, c, localDevItem()).status, 'partial');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detector: multitool-coherence (#18)', () => {
  const ctxTools = (tools) => ({ ...ctx, tools });
  it('na when <=1 tool in use', () => {
    const d = tmpRepo();
    assert.equal(scanItem(d, ctxTools(['claude']), multitool()).status, 'na');
    rmSync(d, { recursive: true, force: true });
  });
  it('present when AGENTS.md + every non-claude tool pointer present', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'AGENTS.md'), '# x');
    writeFileSync(join(d, 'GEMINI.md'), '# g');
    assert.equal(scanItem(d, ctxTools(['claude', 'gemini']), multitool()).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('partial when a non-claude tool pointer is missing', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'AGENTS.md'), '# x');
    // gemini in use but GEMINI.md absent
    assert.equal(scanItem(d, ctxTools(['claude', 'gemini']), multitool()).status, 'partial');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('na-scoping via profile', () => {
  it('ciHost none → #11 na even with workflows', () => {
    const d = tmpRepo(); mkdirSync(join(d, '.github/workflows'), { recursive: true });
    writeFileSync(join(d, '.github/workflows/ci.yml'), 'on:\n  pull_request:\n');
    const profile = { tools: ['claude'], ciHost: 'none', prePush: 'raw', contextMode: 'regen-node' };
    assert.equal(scanItem(d, { ...ctx, host: 'github' }, ciPr(), profile).status, 'na');
    rmSync(d, { recursive: true, force: true });
  });
  it('prePush skip → #15 na', () => {
    const d = tmpRepo();
    const profile = { tools: ['claude'], prePush: 'skip' };
    assert.equal(scanItem(d, ctx, prePush(), profile).status, 'na');
    rmSync(d, { recursive: true, force: true });
  });
  it('contextMode off → #8 na', () => {
    const d = tmpRepo();
    const profile = { tools: ['claude'], contextMode: 'off' };
    assert.equal(scanItem(d, ctx, codesight(), profile).status, 'na');
    rmSync(d, { recursive: true, force: true });
  });
  it('#18 considers only profile tools when profile present', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'AGENTS.md'), '# x');
    // repo has gemini pointer present in ctx.tools, but profile only lists claude → <=1 → na
    const profile = { tools: ['claude'] };
    assert.equal(scanItem(d, { ...ctx, tools: ['claude', 'gemini'] }, multitool(), profile).status, 'na');
    rmSync(d, { recursive: true, force: true });
  });
  it('scan(rootDir, ctx, profile) applies na-scoping across items', () => {
    const d = tmpRepo();
    const profile = { tools: ['claude'], ciHost: 'none', prePush: 'skip', contextMode: 'off' };
    const r = scan(d, { ...ctx, host: 'github' }, profile);
    const byKey = (k) => r.results.find(x => x.key === k);
    assert.equal(byKey('ci-pr').status, 'na');
    assert.equal(byKey('pre-push').status, 'na');
    assert.equal(byKey('codesight').status, 'na');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detector: traceability (#12) promotion', () => {
  const trace = () => ITEMS.find(i => i.key === 'traceability');
  it('present when ticket convention confirmed via profile', () => {
    const d = tmpRepo();
    const c = { ...ctx, tickets: { hasTickets: true, sample: 'TSK-1' } };
    assert.equal(scanItem(d, c, trace(), { ticketPrefix: 'TSK' }).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('present when docs/prd/_schema.json exists', () => {
    const d = tmpRepo();
    mkdirSync(join(d, 'docs/prd'), { recursive: true });
    writeFileSync(join(d, 'docs/prd/_schema.json'), '{}');
    assert.equal(scanItem(d, ctx, trace()).status, 'present');
    rmSync(d, { recursive: true, force: true });
  });
  it('partial when ticketPrefix is none', () => {
    const d = tmpRepo();
    const c = { ...ctx, tickets: { hasTickets: true, sample: 'TSK-1' } };
    assert.equal(scanItem(d, c, trace(), { ticketPrefix: 'none' }).status, 'partial');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detector: multitool-coherence (#18) unknown tool', () => {
  it('partial when an unknown tool id is in use', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'AGENTS.md'), '# a');
    assert.equal(scanItem(d, { ...ctx, tools: ['claude', 'aider'] }, multitool()).status, 'partial');
    rmSync(d, { recursive: true, force: true });
  });
});
