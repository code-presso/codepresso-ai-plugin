#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
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
    PROJECT_NAME: basename(root) || 'project',
    STACKS: ctx.stacks.map(s => s.stack).join(', ') || 'unknown',
    TICKET_PREFIX: ctx.tickets.sample ? ctx.tickets.sample.split('-')[0] : 'TASK',
    HOST: ctx.host || 'unknown',
    TEST_CMD: testCmd(ctx),
    STACK_TRAPS: '- (fill in stack-specific gotchas as you learn them)',
  };
  const report = [];
  for (const f of planFiles(sc, ctx)) {
    if (f.kind !== 'static') continue;
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
  case 'scan': {
    const sc = scan(root, detect(root));
    const stateDir = join(root, '.codepresso/state');
    try { mkdirSync(stateDir, { recursive: true }); writeFileSync(join(stateDir, 'aidlc-scorecard.json'), JSON.stringify(sc, null, 2)); } catch {}
    out(sc);
    break;
  }
  case 'score': out(scan(root, detect(root)).score); break;
  case 'plan': { const ctx = detect(root); out(planFiles(scan(root, ctx), ctx)); break; }
  case 'apply-static': out(applyStatic(detect(root))); break;
  default:
    process.stderr.write(`usage: aidlc-cli <detect|scan|score|plan|apply-static> <path>\n`);
    process.exit(1);
}
