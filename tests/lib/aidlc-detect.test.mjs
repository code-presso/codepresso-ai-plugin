import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { detectSubmodules, detectStructure, detectStacks, detectHost, detectTickets, detect } from '../../scripts/lib/aidlc-detect.mjs';

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
    rmSync(d, { recursive: true, force: true });
  });
});
