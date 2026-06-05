import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { detectSubmodules, detectStructure, detectStacks, detectHost, detectTickets, detectTools, detectCI, detectHookFramework, detectLocalDev, detect } from '../../scripts/lib/aidlc-detect.mjs';

function tmpRepo() { return mkdtempSync(join(tmpdir(), 'aidlc-')); }

describe('detectSubmodules', () => {
  it('parses .gitmodules paths', () => {
    const d = tmpRepo();
    writeFileSync(join(d, '.gitmodules'),
      '[submodule "backend/main"]\n\tpath = backend/main\n\turl = x\n' +
      '[submodule "tests"]\n\tpath = tests\n\turl = y\n');
    assert.deepEqual(detectSubmodules(d).sort(), ['backend/main', 'tests']);
    rmSync(d, { recursive: true, force: true });
  });
  it('returns [] when no .gitmodules', () => {
    const d = tmpRepo();
    assert.deepEqual(detectSubmodules(d), []);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detectStructure', () => {
  it('mono when .gitmodules has multiple submodules', () => {
    const d = tmpRepo();
    writeFileSync(join(d, '.gitmodules'), '[submodule "a"]\n\tpath = a\n[submodule "b"]\n\tpath = b\n');
    assert.equal(detectStructure(d), 'mono');
    rmSync(d, { recursive: true, force: true });
  });
  it('mono when multiple package manifests in distinct subdirs', () => {
    const d = tmpRepo();
    mkdirSync(join(d, 'svc-a')); writeFileSync(join(d, 'svc-a/package.json'), '{}');
    mkdirSync(join(d, 'svc-b')); writeFileSync(join(d, 'svc-b/go.mod'), 'module b');
    assert.equal(detectStructure(d), 'mono');
    rmSync(d, { recursive: true, force: true });
  });
  it('single for one root manifest', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'package.json'), '{}');
    assert.equal(detectStructure(d), 'single');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detectStacks', () => {
  it('maps manifests to stacks for single repo', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'package.json'), '{}');
    assert.deepEqual(detectStacks(d, { structure: 'single', submodules: [] }), [{ path: '.', stack: 'node' }]);
    rmSync(d, { recursive: true, force: true });
  });
  it('maps per-submodule for mono', () => {
    const d = tmpRepo();
    mkdirSync(join(d, 'be')); writeFileSync(join(d, 'be/pom.xml'), '<project/>');
    mkdirSync(join(d, 'infra')); writeFileSync(join(d, 'infra/main.tf'), '');
    const got = detectStacks(d, { structure: 'mono', submodules: ['be', 'infra'] });
    assert.deepEqual(got.sort((a,b)=>a.path<b.path?-1:1),
      [{ path: 'be', stack: 'java' }, { path: 'infra', stack: 'terraform' }]);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detectHost', () => {
  it('reads github from git remote', () => {
    const d = tmpRepo();
    execFileSync('git', ['init', '-q'], { cwd: d });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/x/y.git'], { cwd: d });
    assert.equal(detectHost(d), 'github');
    rmSync(d, { recursive: true, force: true });
  });
  it('null when no remote', () => {
    const d = tmpRepo();
    execFileSync('git', ['init', '-q'], { cwd: d });
    assert.equal(detectHost(d), null);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detectTickets', () => {
  it('finds ticket pattern in git log', () => {
    const d = tmpRepo();
    execFileSync('git', ['init', '-q'], { cwd: d });
    execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '--allow-empty', '-q', '-m', 'TSK-123 do thing'], { cwd: d });
    const r = detectTickets(d);
    assert.equal(r.hasTickets, true);
    assert.match(r.sample, /TSK-123/);
    rmSync(d, { recursive: true, force: true });
  });
  it('returns hasTickets:false when no ticket pattern', () => {
    const d = tmpRepo();
    execFileSync('git', ['init', '-q'], { cwd: d });
    execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t',
      'commit', '--allow-empty', '-q', '-m', 'fix typo'], { cwd: d });
    const r = detectTickets(d);
    assert.equal(r.hasTickets, false);
    assert.equal(r.sample, null);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detectTools', () => {
  it('includes claude when AGENTS.md exists', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'AGENTS.md'), '# x');
    assert.deepEqual(detectTools(d), ['claude']);
    rmSync(d, { recursive: true, force: true });
  });
  it('includes claude when CLAUDE.md exists', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'CLAUDE.md'), '# x');
    assert.ok(detectTools(d).includes('claude'));
    rmSync(d, { recursive: true, force: true });
  });
  it('detects cursor via .cursorrules', () => {
    const d = tmpRepo();
    writeFileSync(join(d, '.cursorrules'), 'x');
    assert.ok(detectTools(d).includes('cursor'));
    rmSync(d, { recursive: true, force: true });
  });
  it('detects cursor via .cursor dir', () => {
    const d = tmpRepo();
    mkdirSync(join(d, '.cursor'));
    assert.ok(detectTools(d).includes('cursor'));
    rmSync(d, { recursive: true, force: true });
  });
  it('detects opencode, cline, copilot, gemini, amazonq', () => {
    const d = tmpRepo();
    mkdirSync(join(d, '.opencode'));
    writeFileSync(join(d, '.clinerules'), 'x');
    mkdirSync(join(d, '.github'), { recursive: true });
    writeFileSync(join(d, '.github/copilot-instructions.md'), 'x');
    writeFileSync(join(d, 'GEMINI.md'), 'x');
    mkdirSync(join(d, '.amazonq'));
    const t = detectTools(d);
    for (const id of ['opencode', 'cline', 'copilot', 'gemini', 'amazonq']) assert.ok(t.includes(id), id);
    rmSync(d, { recursive: true, force: true });
  });
  it('returns [] for bare repo', () => {
    const d = tmpRepo();
    assert.deepEqual(detectTools(d), []);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detectCI', () => {
  it('lists github workflow yml/yaml files', () => {
    const d = tmpRepo();
    mkdirSync(join(d, '.github/workflows'), { recursive: true });
    writeFileSync(join(d, '.github/workflows/ci.yml'), 'on: pull_request');
    writeFileSync(join(d, '.github/workflows/deploy.yaml'), 'on: push');
    const ci = detectCI(d, 'github');
    assert.equal(ci.host, 'github');
    assert.deepEqual(ci.files.sort(), ['.github/workflows/ci.yml', '.github/workflows/deploy.yaml']);
    rmSync(d, { recursive: true, force: true });
  });
  it('lists gitlab and bitbucket configs', () => {
    const d = tmpRepo();
    writeFileSync(join(d, '.gitlab-ci.yml'), 'x');
    writeFileSync(join(d, 'bitbucket-pipelines.yml'), 'x');
    const ci = detectCI(d, 'gitlab');
    assert.ok(ci.files.includes('.gitlab-ci.yml'));
    assert.ok(ci.files.includes('bitbucket-pipelines.yml'));
    rmSync(d, { recursive: true, force: true });
  });
  it('empty files when none', () => {
    const d = tmpRepo();
    assert.deepEqual(detectCI(d, null).files, []);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detectHookFramework', () => {
  it('husky via .husky dir', () => {
    const d = tmpRepo();
    mkdirSync(join(d, '.husky'));
    assert.equal(detectHookFramework(d), 'husky');
    rmSync(d, { recursive: true, force: true });
  });
  it('husky via package.json devDeps', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'package.json'), JSON.stringify({ devDependencies: { husky: '^9' } }));
    assert.equal(detectHookFramework(d), 'husky');
    rmSync(d, { recursive: true, force: true });
  });
  it('lefthook via lefthook.yml', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'lefthook.yml'), 'pre-push:');
    assert.equal(detectHookFramework(d), 'lefthook');
    rmSync(d, { recursive: true, force: true });
  });
  it('raw when neither', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'package.json'), '{}');
    assert.equal(detectHookFramework(d), 'raw');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detectLocalDev', () => {
  it('compose via docker-compose.yml', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'docker-compose.yml'), 'services:');
    assert.equal(detectLocalDev(d).compose, true);
    rmSync(d, { recursive: true, force: true });
  });
  it('compose via compose.yaml', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'compose.yaml'), 'services:');
    assert.equal(detectLocalDev(d).compose, true);
    rmSync(d, { recursive: true, force: true });
  });
  it('makefileTarget when Makefile has up: target', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'Makefile'), 'up:\n\tdocker compose up\n');
    assert.equal(detectLocalDev(d).makefileTarget, true);
    rmSync(d, { recursive: true, force: true });
  });
  it('script via scripts/local-up.sh', () => {
    const d = tmpRepo();
    mkdirSync(join(d, 'scripts'));
    writeFileSync(join(d, 'scripts/local-up.sh'), '#!/bin/sh');
    assert.equal(detectLocalDev(d).script, true);
    rmSync(d, { recursive: true, force: true });
  });
  it('npmDev via package.json scripts.dev', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    assert.equal(detectLocalDev(d).npmDev, true);
    rmSync(d, { recursive: true, force: true });
  });
  it('all false for bare repo', () => {
    const d = tmpRepo();
    assert.deepEqual(detectLocalDev(d), { compose: false, makefileTarget: false, script: false, npmDev: false });
    rmSync(d, { recursive: true, force: true });
  });
});

describe('detect', () => {
  it('returns the composite shape', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'package.json'), '{}');
    execFileSync('git', ['init', '-q'], { cwd: d });
    const r = detect(d);
    assert.equal(r.structure, 'single');
    assert.deepEqual(r.submodules, []);
    assert.deepEqual(r.stacks, [{ path: '.', stack: 'node' }]);
    assert.equal(r.host, null);
    assert.equal(typeof r.tickets.hasTickets, 'boolean');
    assert.ok(Array.isArray(r.tools));
    assert.ok(r.ci && Array.isArray(r.ci.files));
    assert.ok(['husky', 'lefthook', 'raw'].includes(r.hookFramework));
    assert.ok(r.localDev && typeof r.localDev.compose === 'boolean');
    rmSync(d, { recursive: true, force: true });
  });
});
