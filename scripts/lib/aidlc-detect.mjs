import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const MANIFESTS = ['package.json', 'go.mod', 'pom.xml', 'build.gradle', 'pyproject.toml', 'requirements.txt', 'Cargo.toml'];

const has = (root, rel) => existsSync(join(root, rel));

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

// Detect agent-tool pointer files. Returns canonical tool ids.
export function detectTools(rootDir) {
  const tools = [];
  try {
    if (has(rootDir, 'AGENTS.md') || has(rootDir, 'CLAUDE.md')) tools.push('claude');
    if (has(rootDir, '.cursor') || has(rootDir, '.cursorrules')) tools.push('cursor');
    if (has(rootDir, '.opencode')) tools.push('opencode');
    if (has(rootDir, '.clinerules')) tools.push('cline');
    if (has(rootDir, '.github/copilot-instructions.md')) tools.push('copilot');
    if (has(rootDir, 'GEMINI.md')) tools.push('gemini');
    if (has(rootDir, '.amazonq')) tools.push('amazonq');
  } catch {}
  return tools;
}

// Detect CI config files. host is the detected git host (may be null).
export function detectCI(rootDir, host) {
  const files = [];
  try {
    let wf = [];
    try { wf = readdirSync(join(rootDir, '.github/workflows')).filter(f => /\.ya?ml$/.test(f)); } catch {}
    for (const f of wf.sort()) files.push(join('.github/workflows', f));
    for (const f of ['.gitlab-ci.yml', 'bitbucket-pipelines.yml']) if (has(rootDir, f)) files.push(f);
  } catch {}
  return { host: host || null, files };
}

export function detectHookFramework(rootDir) {
  try {
    if (has(rootDir, '.husky')) return 'husky';
    if (has(rootDir, 'package.json')) {
      try {
        const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
        const dd = { ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };
        if (dd.husky) return 'husky';
      } catch {}
    }
    if (has(rootDir, 'lefthook.yml') || has(rootDir, 'lefthook.yaml')) return 'lefthook';
  } catch {}
  return 'raw';
}

export function detectLocalDev(rootDir) {
  const out = { compose: false, makefileTarget: false, script: false, npmDev: false };
  try {
    out.compose = has(rootDir, 'docker-compose.yml') || has(rootDir, 'compose.yaml');
    if (has(rootDir, 'Makefile')) {
      try {
        const mk = readFileSync(join(rootDir, 'Makefile'), 'utf8');
        out.makefileTarget = /^(up|dev|start):/m.test(mk);
      } catch {}
    }
    out.script = has(rootDir, 'scripts/local-up.sh') || has(rootDir, 'scripts/dev.sh');
    if (has(rootDir, 'package.json')) {
      try {
        const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
        out.npmDev = !!(pkg.scripts && (pkg.scripts.dev || pkg.scripts.start));
      } catch {}
    }
  } catch {}
  return out;
}

export function detect(rootDir) {
  const submodules = detectSubmodules(rootDir);
  const structure = detectStructure(rootDir);
  const host = detectHost(rootDir);
  return {
    structure,
    submodules,
    stacks: detectStacks(rootDir, { structure, submodules }),
    host,
    tickets: detectTickets(rootDir),
    tools: detectTools(rootDir),
    ci: detectCI(rootDir, host),
    hookFramework: detectHookFramework(rootDir),
    localDev: detectLocalDev(rootDir),
  };
}
