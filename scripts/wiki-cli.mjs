#!/usr/bin/env node
// LLM Wiki helper. Deterministic bits only (path resolution + scaffolding); the actual
// ingest/query/lint reasoning lives in skills/llm-wiki/SKILL.md and the vault's CLAUDE.md.
import { existsSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';

const cwd = process.cwd();
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(SCRIPT_DIR, '..', 'templates', 'llm-wiki-vault');
const GLOBAL_CONFIG_PATH = join(homedir(), '.codepresso', 'config.json');

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

function loadConfigOrExit() {
  try {
    return loadConfig(cwd);
  } catch (err) {
    process.stderr.write(`wiki-cli: failed to load config: ${err.message}\n`);
    process.exit(2);
  }
}

function resolveVaultPath(config, override) {
  const raw = override || config.wiki?.vaultPath || '~/Documents/Obsidian/llm-wiki';
  return { raw, resolved: expandHome(raw) };
}

function readGlobalConfig() {
  try {
    return JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

// Persist vault location to ~/.codepresso/config.json, preserving all other keys.
function setWikiConfig(vaultPath) {
  const cfg = readGlobalConfig();
  cfg.wiki = { ...(cfg.wiki || {}), enabled: true, vaultPath };
  mkdirSync(dirname(GLOBAL_CONFIG_PATH), { recursive: true });
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

// template filename -> path inside the vault; `subst` files get {{DATE}} replaced.
const FILE_MAP = [
  { src: 'CLAUDE.md', dest: 'CLAUDE.md' },
  { src: 'README.md', dest: 'README.md' },
  { src: 'index.md', dest: 'index.md' },
  { src: 'log.md', dest: 'log.md', subst: true },
  { src: 'gitignore', dest: '.gitignore' },
  { src: 'obsidian-app.json', dest: '.obsidian/app.json' },
];

function scaffold(vault) {
  const today = new Date().toISOString().slice(0, 10);
  for (const dir of ['sources', 'pages', '.obsidian']) {
    mkdirSync(join(vault, dir), { recursive: true });
  }
  for (const f of FILE_MAP) {
    const destPath = join(vault, f.dest);
    mkdirSync(dirname(destPath), { recursive: true });
    let content = readFileSync(join(TEMPLATE_DIR, f.src), 'utf-8');
    if (f.subst) content = content.replaceAll('{{DATE}}', today);
    writeFileSync(destPath, content, 'utf-8');
  }
  // Best-effort: let Codex/other tools share the schema via AGENTS.md.
  try {
    symlinkSync('CLAUDE.md', join(vault, 'AGENTS.md'));
  } catch {
    /* symlink unsupported or already exists — non-fatal */
  }
}

function gitInit(vault) {
  try {
    if (!existsSync(join(vault, '.git'))) {
      execFileSync('git', ['init', '-b', 'main'], { cwd: vault, stdio: 'ignore' });
    }
    execFileSync('git', ['add', '-A'], { cwd: vault, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'feat: bootstrap LLM Wiki'], { cwd: vault, stdio: 'ignore' });
    return 'committed';
  } catch (err) {
    return `init-only (commit skipped: ${err.message.split('\n')[0]})`;
  }
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

const cmd = process.argv[2];
const arg = process.argv[3];

switch (cmd) {
  case 'path': {
    const config = loadConfigOrExit();
    const { raw, resolved } = resolveVaultPath(config, arg);
    out({
      enabled: config.wiki?.enabled ?? false,
      vaultPath: resolved,
      raw,
      exists: existsSync(resolved),
      hasSchema: existsSync(join(resolved, 'CLAUDE.md')),
      remote: config.wiki?.remote ?? null,
    });
    break;
  }
  case 'init': {
    const config = loadConfigOrExit();
    const { resolved } = resolveVaultPath(config, arg);
    if (existsSync(join(resolved, 'CLAUDE.md'))) {
      setWikiConfig(resolved);
      out({
        initialized: false,
        alreadyInitialized: true,
        vaultPath: resolved,
        configUpdated: true,
        note: 'CLAUDE.md already present — left untouched.',
      });
      break;
    }
    scaffold(resolved);
    const git = gitInit(resolved);
    setWikiConfig(resolved);
    out({ initialized: true, vaultPath: resolved, git, configUpdated: true });
    break;
  }
  default: {
    process.stderr.write(
      'wiki-cli: unknown command\n' +
      'usage:\n' +
      '  node scripts/wiki-cli.mjs path [override-path]   # resolve configured vault path\n' +
      '  node scripts/wiki-cli.mjs init [path]            # scaffold vault + git + write config\n'
    );
    process.exit(2);
  }
}
