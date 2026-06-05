#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from './lib/aidlc-detect.mjs';
import { scan } from './lib/aidlc-scan.mjs';
import { planFiles, substitute, writeIfAbsent } from './lib/aidlc-template.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(HERE, '../templates/aidlc');

// argv: <cmd> [path] [--profile <path>]
const argv = process.argv.slice(2);
const cmd = argv[0];
let profilePath = null;
const positional = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--profile') {
    if (i + 1 >= argv.length) { process.stderr.write('aidlc: --profile requires a path argument\n'); process.exit(1); }
    profilePath = argv[++i];
  } else positional.push(argv[i]);
}
const root = resolve(positional[0] || '.');
const out = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');

function loadProfile(p) {
  if (!p) return undefined;
  let raw;
  try { raw = readFileSync(resolve(p), 'utf8'); } catch { return undefined; }
  try { return JSON.parse(raw); }
  catch { process.stderr.write(`aidlc: warning: could not parse profile at ${p} — running baseline\n`); return undefined; }
}
const profile = loadProfile(profilePath);

function testCmd(ctx) {
  const stacks = ctx.stacks.map(s => s.stack);
  if (stacks.includes('node')) return 'npm test';
  if (stacks.includes('go')) return 'go test ./...';
  if (stacks.includes('java')) return './gradlew test';
  if (stacks.includes('python')) return 'pytest';
  return 'echo "no test command configured"';
}

function applyStatic(ctx) {
  const sc = scan(root, ctx, profile);
  const vars = {
    PROJECT_NAME: basename(root) || 'project',
    STACKS: ctx.stacks.map(s => s.stack).join(', ') || 'unknown',
    TICKET_PREFIX: (profile && profile.ticketPrefix && profile.ticketPrefix !== 'none') ? profile.ticketPrefix
      : (ctx.tickets.sample ? ctx.tickets.sample.split('-')[0] : 'TASK'),
    HOST: ctx.host || 'unknown',
    TEST_CMD: testCmd(ctx),
    STACK_TRAPS: '- (fill in stack-specific gotchas as you learn them)',
  };
  const report = [];
  for (const f of planFiles(sc, ctx, profile)) {
    if (f.kind !== 'static') continue;
    // Template ships at the same repo-relative path under templates/aidlc/ (incl. host CI variants).
    const tplPath = join(TEMPLATES, f.path);
    let content;
    try { content = substitute(readFileSync(tplPath, 'utf8'), vars); }
    catch { report.push({ key: f.key, path: f.path, result: 'no-template' }); continue; }
    const dest = join(root, f.path);
    const w = writeIfAbsent(dest, content);
    if (w.written && f.path.endsWith('.sh')) { try { chmodSync(dest, 0o755); } catch {} }  // scaffolded scripts must be runnable
    report.push({ key: f.key, path: f.path, result: w.reason });
  }
  return report;
}

switch (cmd) {
  case 'detect': out(detect(root)); break;
  case 'scan': {
    const sc = scan(root, detect(root), profile);
    const stateDir = join(root, '.codepresso/state');
    try { mkdirSync(stateDir, { recursive: true }); writeFileSync(join(stateDir, 'aidlc-scorecard.json'), JSON.stringify(sc, null, 2)); } catch {}
    out(sc);
    break;
  }
  case 'score': out(scan(root, detect(root), profile).score); break;
  case 'plan': { const ctx = detect(root); out(planFiles(scan(root, ctx, profile), ctx, profile)); break; }
  case 'apply-static': out(applyStatic(detect(root))); break;
  default:
    process.stderr.write(`usage: aidlc-cli <detect|scan|score|plan|apply-static> <path>\n`);
    process.exit(1);
}
