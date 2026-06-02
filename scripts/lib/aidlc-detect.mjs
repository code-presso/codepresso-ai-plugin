import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
