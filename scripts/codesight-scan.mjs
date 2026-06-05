#!/usr/bin/env node
// Pure-Node context-index generator (ZERO external deps).
// Regenerates <target>/.codesight/CODESIGHT.md so the agent context index never goes stale.
// Usage: node codesight-scan.mjs [targetPath]   (defaults to cwd)
// Wire as a Claude Code SessionStart hook — see templates/aidlc/.claude/settings.codesight-hook.json
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { detect } from './lib/aidlc-detect.mjs';

const root = resolve(process.argv[2] || '.');
const ts = new Date().toISOString();

let ctx;
try { ctx = detect(root); }
catch { ctx = { structure: 'single', submodules: [], stacks: [], host: null }; }

const IGNORE = new Set([
  '.git', 'node_modules', '.codesight', '.omc', '.codepresso', '.worktrees',
  'dist', 'build', '.next', 'coverage', '.cache', '.venv', 'venv', '__pycache__',
]);

function topDirs(dir) {
  const out = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !IGNORE.has(e.name) && !e.name.startsWith('.')) out.push(e.name);
    }
  } catch { /* unreadable dir — skip */ }
  return out.sort();
}

const dirs = topDirs(root);
const stacks = ctx.stacks.map(s => `${s.path} → ${s.stack}`).join(', ') || 'unknown';

const lines = [
  '# CODESIGHT — Repo Context Index',
  '',
  `Generated: ${ts} · structure: ${ctx.structure} · host: ${ctx.host || 'n/a'}`,
  `Stacks: ${stacks}`,
];
if (ctx.submodules && ctx.submodules.length) lines.push(`Submodules: ${ctx.submodules.join(', ')}`);
lines.push('', '## Top-level directories');
for (const d of dirs) lines.push(`- \`${d}/\``);
lines.push('', '> Regenerated on session start by codesight-scan.mjs (no external deps). Do not edit by hand.', '');

try {
  const dest = join(root, '.codesight');
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'CODESIGHT.md'), lines.join('\n'));
  process.stdout.write(`codesight: wrote .codesight/CODESIGHT.md (${dirs.length} dirs)\n`);
} catch (e) {
  process.stderr.write(`codesight: failed to write index: ${e.message}\n`);
}
