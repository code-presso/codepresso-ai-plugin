import { existsSync, readdirSync } from 'node:fs';
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
