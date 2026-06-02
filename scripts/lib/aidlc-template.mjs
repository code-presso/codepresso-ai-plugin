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
    if (!path) continue;                              // items with no single scaffold file handled in skill
    out.push({ path, kind: r.kind, key: r.key });
  }
  return out;
}
