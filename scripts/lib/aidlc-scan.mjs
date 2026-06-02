import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
  { id: 2, key: 'claude-md', name: 'CLAUDE.md at root', kind: 'authored',
    detect: (r) => has(r, 'CLAUDE.md') ? result('present', ['CLAUDE.md']) : result('missing') },
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
  { id: 5, key: 'specs-plans', name: 'Specs+Plans workflow', kind: 'static',
    detect: (r) => (has(r, 'docs/superpowers/specs') || has(r, 'docs/superpowers/plans'))
      ? result('present', ['docs/superpowers/']) : result('missing') },
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
