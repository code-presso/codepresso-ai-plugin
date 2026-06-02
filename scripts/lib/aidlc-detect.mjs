import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

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

const STACK_BY_MANIFEST = [
  ['package.json', 'node'], ['go.mod', 'go'], ['pom.xml', 'java'], ['build.gradle', 'java'],
  ['pyproject.toml', 'python'], ['requirements.txt', 'python'], ['Cargo.toml', 'rust'],
];

function stackOf(dir) {
  for (const [file, stack] of STACK_BY_MANIFEST) if (existsSync(join(dir, file))) return stack;
  try { if (readdirSync(dir).some(f => f.endsWith('.tf'))) return 'terraform'; } catch {}
  return null;
}

export function detectStacks(rootDir, { structure, submodules }) {
  const out = [];
  if (structure === 'mono') {
    let dirs = submodules;
    if (!dirs.length) {
      try {
        dirs = readdirSync(rootDir, { withFileTypes: true })
          .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
          .map(e => e.name);
      } catch { dirs = []; }
    }
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
