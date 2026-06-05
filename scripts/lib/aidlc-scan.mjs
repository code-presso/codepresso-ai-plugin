import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const has = (root, rel) => existsSync(join(root, rel));
const dirHasFileMatching = (root, rel, re) => {
  try { return readdirSync(join(root, rel)).some(f => re.test(f)); } catch { return false; }
};
const result = (status, evidence = [], reason = '') => ({ status, evidence, reason });

const readSafe = (root, rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch { return ''; } };
const mtimeWithinDays = (root, rel, days) => {
  try { return (Date.now() - statSync(join(root, rel)).mtimeMs) <= days * 86400000; } catch { return false; }
};

// True if any .claude settings file declares a SessionStart hook referencing codesight.
function hasCodesightHook(root) {
  for (const s of ['.claude/settings.json', '.claude/settings.local.json']) {
    if (!has(root, s)) continue;
    let json;
    try { json = JSON.parse(readSafe(root, s)); } catch { continue; }
    const ss = json && json.hooks && json.hooks.SessionStart;
    if (!ss) continue;
    if (JSON.stringify(ss).toLowerCase().includes('codesight')) return true;
  }
  return false;
}

// True if a lefthook config declares a pre-push section.
function lefthookHasPrePush(root) {
  for (const f of ['lefthook.yml', 'lefthook.yaml']) {
    const t = readSafe(root, f);
    if (t && /pre-push/.test(t)) return true;
  }
  return false;
}

// Pointer file(s) that satisfy a given agent-tool id (besides 'claude' → AGENTS.md/CLAUDE.md).
const TOOL_POINTERS = {
  cursor: ['.cursor', '.cursorrules'],
  opencode: ['.opencode'],
  cline: ['.clinerules'],
  copilot: ['.github/copilot-instructions.md'],
  gemini: ['GEMINI.md'],
  amazonq: ['.amazonq'],
};

// Each detector: (rootDir, ctx, profile) => { status, evidence, reason }
export const ITEMS = [
  { id: 1, key: 'agents-md', name: 'AGENTS.md at root', kind: 'authored',
    detect: (r) => has(r, 'AGENTS.md') ? result('present', ['AGENTS.md']) : result('missing', [], 'no AGENTS.md') },
  { id: 2, key: 'claude-md', name: 'CLAUDE.md at root', kind: 'authored',
    detect: (r) => has(r, 'CLAUDE.md') ? result('present', ['CLAUDE.md']) : result('missing') },
  { id: 3, key: 'submodule-claude', name: 'Per-submodule CLAUDE.md', kind: 'authored',
    detect: (r, ctx) => {
      if (ctx.structure !== 'mono') return result('na', [], 'single-package repo');
      const subs = ctx.submodules;
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
  { id: 5, key: 'specs-plans', name: 'Specs+Plans workflow', kind: 'static',
    detect: (r) => (has(r, 'docs/superpowers/specs') || has(r, 'docs/superpowers/plans'))
      ? result('present', ['docs/superpowers/']) : result('missing') },
  { id: 6, key: 'agent-policy', name: 'AI agent policy', kind: 'static',
    detect: (r) => has(r, 'docs/ai-agent-policy.md') ? result('present', ['docs/ai-agent-policy.md']) : result('missing') },
  { id: 7, key: 'runbook', name: 'Runbook + executable skill split', kind: 'static',
    detect: (r) => has(r, 'docs/oncall-runbook.md') || has(r, '.claude/commands')
      ? result('present', ['docs/oncall-runbook.md|.claude/commands']) : result('missing') },
  { id: 8, key: 'codesight', name: 'Codesight / context index', kind: 'authored',
    detect: (r) => {
      if (!has(r, '.codesight')) return result('missing', [], 'no .codesight/');
      const hasIndex = has(r, '.codesight/CODESIGHT.md');
      const fresh = hasIndex && mtimeWithinDays(r, '.codesight/CODESIGHT.md', 14);
      const hook = hasCodesightHook(r);
      if (hook || fresh) return result('present', ['.codesight/'], hook ? 'regen hook wired' : 'fresh index');
      return result('partial', ['.codesight/'], hasIndex ? 'stale and no regen hook' : 'CODESIGHT.md missing and no regen hook');
    } },
  { id: 9, key: 'hooks', name: 'Session/automation hooks', kind: 'static',
    detect: (r) => {
      if (has(r, 'hooks/hooks.json')) return result('present', ['hooks/hooks.json']);
      for (const s of ['.claude/settings.json', '.claude/settings.local.json']) {
        if (!has(r, s)) continue;
        try { if (readFileSync(join(r, s), 'utf8').includes('hooks')) return result('present', [s]); } catch {}
      }
      return result('missing');
    } },
  { id: 10, key: 'permission-matrix', name: 'Permission matrix', kind: 'static',
    detect: (r) => {
      if (has(r, '.claude/settings.json')) return result('present', ['.claude/settings.json']);
      if (has(r, '.claude/settings.local.json')) return result('partial', ['.claude/settings.local.json'], 'local-only, not committed/shared');
      return result('missing');
    } },
  { id: 11, key: 'ci-pr', name: 'CI gate on every PR', kind: 'static',
    detect: (r, ctx, profile) => {
      const host = (profile && profile.ciHost && profile.ciHost !== 'none') ? profile.ciHost : (ctx && ctx.host);
      if (!host || host === 'none') return result('na', [], 'no git host detected');
      const dir = '.github/workflows';
      let ghFiles = [];
      try { ghFiles = readdirSync(join(r, dir)).filter(f => /\.ya?ml$/.test(f)); } catch {}
      const hasGhPr = ghFiles.some(f => readSafe(r, join(dir, f)).includes('pull_request'));
      const glText = readSafe(r, '.gitlab-ci.yml');
      const bbText = readSafe(r, 'bitbucket-pipelines.yml');
      const hasGlPr = /merge_request/i.test(glText);
      const hasBbPr = /pull-requests/i.test(bbText);
      const anyWorkflow = ghFiles.length > 0 || has(r, '.gitlab-ci.yml') || has(r, 'bitbucket-pipelines.yml');
      if (host === 'github' && hasGhPr) return result('present', [dir]);
      if (host === 'gitlab' && hasGlPr) return result('present', ['.gitlab-ci.yml']);
      if (host === 'bitbucket' && hasBbPr) return result('present', ['bitbucket-pipelines.yml']);
      if (anyWorkflow) return result('partial', [], 'workflows exist but host mismatch or no PR trigger');
      return result('missing', [], 'no CI config');
    } },
  { id: 12, key: 'traceability', name: 'Intent→PR→deploy traceability', kind: 'static',
    detect: (r, ctx, profile) => {
      const hasPrdSchema = has(r, 'docs/prd/_schema.json') || has(r, 'docs/prd/_schema.md');
      const confirmedTickets = ctx.tickets && ctx.tickets.hasTickets
        && profile && profile.ticketPrefix && profile.ticketPrefix !== 'none';
      if (hasPrdSchema) return result('present', ['docs/prd/_schema.json'], 'PRD schema anchors intent');
      if (confirmedTickets) return result('present', [], `ticket convention ${profile.ticketPrefix}- confirmed`);
      if (ctx.tickets && ctx.tickets.hasTickets)
        return result('partial', [], 'tickets used; confirm PR-title convention in interview');
      return result('partial', [], 'needs-confirm: no ticket convention detected');
    } },
  { id: 13, key: 'doc-policy', name: 'Documentation policy', kind: 'static',
    detect: (r) => has(r, 'docs/documentation-policy.md') ? result('present', ['docs/documentation-policy.md']) : result('missing') },
  { id: 14, key: 'feature-flags', name: 'Graceful degradation / feature flags', kind: 'static',
    detect: (r) => result('partial', [], 'needs-confirm: integration gating reviewed in interview') },
  { id: 15, key: 'pre-push', name: 'Pre-push / pre-merge validation', kind: 'static',
    detect: (r) => {
      for (const p of ['.git/hooks/pre-push', '.husky/pre-push'])
        if (has(r, p)) return result('present', [p], 'hook wired');
      if (lefthookHasPrePush(r)) return result('present', ['lefthook'], 'lefthook pre-push');
      if (has(r, 'scripts/check-before-push.sh'))
        return result('partial', ['scripts/check-before-push.sh'], 'check script exists but not wired to a git hook');
      return result('missing');
    } },
  { id: 16, key: 'unit-tests', name: 'Unit tests for deterministic logic', kind: 'static',
    detect: (r) => {
      if (!has(r, 'package.json')) return has(r, 'tests') ? result('present', ['tests/']) : result('missing');
      try {
        const pkg = JSON.parse(readFileSync(join(r, 'package.json'), 'utf8'));
        if (pkg.scripts && pkg.scripts.test && has(r, 'tests')) return result('present', ['tests/ + npm test']);
      } catch {}
      return has(r, 'tests') ? result('partial', ['tests/'], 'tests dir but no test script') : result('missing');
    } },
  { id: 17, key: 'local-dev', name: 'Local dev one-command bring-up', kind: 'static',
    detect: (r, ctx) => {
      const ld = (ctx && ctx.localDev) || {};
      if (ld.makefileTarget || ld.script || ld.npmDev) {
        const ev = [ld.makefileTarget && 'Makefile up/dev', ld.script && 'scripts/local-up.sh', ld.npmDev && 'npm dev/start'].filter(Boolean);
        return result('present', ev);
      }
      if (ld.compose) return result('partial', ['docker-compose'], 'compose present but no documented one-command bring-up');
      return result('missing', [], 'no one-command local bring-up');
    } },
  { id: 18, key: 'multitool-coherence', name: 'Multi-tool pointer coherence', kind: 'authored',
    detect: (r, ctx, profile) => {
      const inUse = (profile && Array.isArray(profile.tools)) ? profile.tools : ((ctx && ctx.tools) || []);
      if (inUse.length === 0) return result('na', [], 'no tools recorded');
      if (inUse.length === 1) return result('na', [], 'single tool — AGENTS.md/CLAUDE.md suffices');
      if (!has(r, 'AGENTS.md')) return result('partial', [], 'no AGENTS.md anchor for tool pointers');
      const missingPtr = [];
      const unknown = [];
      for (const t of inUse) {
        if (t === 'claude') continue;
        const candidates = TOOL_POINTERS[t];
        if (!candidates) { unknown.push(t); continue; }
        if (!candidates.some(c => has(r, c))) missingPtr.push(t);
      }
      if (unknown.length) return result('partial', [], `unknown tool id(s): ${unknown.join(', ')}`);
      if (missingPtr.length === 0) return result('present', ['AGENTS.md + tool pointers']);
      return result('partial', [], `missing pointer(s): ${missingPtr.join(', ')}`);
    } },
];

// Profile-driven na-scoping: items for tools/hosts the team does not use are excluded.
function naItem(item, reason) {
  return { id: item.id, key: item.key, name: item.name, kind: item.kind, status: 'na', evidence: [], reason };
}

export function scanItem(rootDir, ctx, item, profile) {
  if (profile) {
    if (item.key === 'ci-pr' && profile.ciHost === 'none') return naItem(item, 'profile: no CI host in use');
    if (item.key === 'pre-push' && profile.prePush === 'skip') return naItem(item, 'profile: pre-push skipped');
    if (item.key === 'codesight' && profile.contextMode === 'off') return naItem(item, 'profile: context index off');
  }
  const { status, evidence, reason } = item.detect(rootDir, ctx, profile);
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
      if (m) for (const tok of m) found.push({ file: rel, kind, masked: tok.slice(0, 8) + '…[REDACTED]' });
    }
  }
  return found;
}

export function scan(rootDir, ctx, profile) {
  const results = ITEMS.slice().sort((a, b) => a.id - b.id).map(item => scanItem(rootDir, ctx, item, profile));
  const secrets = scanSecrets(rootDir);
  return { results, secrets, score: computeScore(results) };
}
