import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectSubmodules, detectStructure } from '../../scripts/lib/aidlc-detect.mjs';

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
