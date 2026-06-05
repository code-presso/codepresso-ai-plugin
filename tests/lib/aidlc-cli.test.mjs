import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/aidlc-cli.mjs');
const run = (args) => JSON.parse(execFileSync('node', [CLI, ...args], { encoding: 'utf8' }));
const tmpRepo = () => mkdtempSync(join(tmpdir(), 'aidlc-cli-'));

describe('aidlc-cli detect', () => {
  it('emits extended detection fields', () => {
    const d = tmpRepo();
    writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { test: 'x', dev: 'y' } }));
    const r = run(['detect', d]);
    for (const k of ['structure', 'tools', 'ci', 'hookFramework', 'localDev']) assert.ok(k in r, `missing ${k}`);
    assert.equal(r.localDev.npmDev, true);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('aidlc-cli scan', () => {
  it('returns 18 items + numeric score and persists scorecard.json', () => {
    const d = tmpRepo();
    const r = run(['scan', d]);
    assert.equal(r.results.length, 18);
    assert.equal(typeof r.score.percent, 'number');
    assert.ok(existsSync(join(d, '.codepresso/state/aidlc-scorecard.json')));
    rmSync(d, { recursive: true, force: true });
  });

  it('profile ciHost=none → ci-pr na (na-scoping)', () => {
    const d = tmpRepo();
    const p = join(d, 'profile.json');
    writeFileSync(p, JSON.stringify({ tools: ['claude'], ciHost: 'none', prePush: 'skip' }));
    const r = run(['scan', d, '--profile', p]);
    assert.equal(r.results.find(x => x.key === 'ci-pr').status, 'na');
    assert.equal(r.results.find(x => x.key === 'pre-push').status, 'na');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('aidlc-cli plan', () => {
  it('profile ciHost=gitlab → ci-pr planned at .gitlab-ci.yml', () => {
    const d = tmpRepo();
    const p = join(d, 'profile.json');
    writeFileSync(p, JSON.stringify({ ciHost: 'gitlab' }));
    const plan = run(['plan', d, '--profile', p]);
    const ci = plan.find(x => x.key === 'ci-pr');
    assert.ok(ci && ci.path === '.gitlab-ci.yml', 'ci-pr should plan to .gitlab-ci.yml');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('aidlc-cli apply-static', () => {
  it('creates missing static files, never overwrites on rerun', () => {
    const d = tmpRepo();
    const first = run(['apply-static', d]);
    assert.equal(first.find(x => x.key === 'doc-policy').result, 'created');
    const fp = join(d, 'docs/documentation-policy.md');
    assert.ok(existsSync(fp));
    writeFileSync(fp, 'SENTINEL — user edited');     // simulate a hand edit
    run(['apply-static', d]);                         // rerun must be non-destructive
    assert.equal(readFileSync(fp, 'utf8'), 'SENTINEL — user edited');
    rmSync(d, { recursive: true, force: true });
  });

  it('profile ciHost=gitlab applies .gitlab-ci.yml from template', () => {
    const d = tmpRepo();
    const p = join(d, 'profile.json');
    writeFileSync(p, JSON.stringify({ ciHost: 'gitlab' }));
    run(['apply-static', d, '--profile', p]);
    assert.ok(existsSync(join(d, '.gitlab-ci.yml')));
    rmSync(d, { recursive: true, force: true });
  });

  it('localDev=scaffold writes an executable scripts/local-up.sh; default does not', () => {
    const d = tmpRepo();
    assert.ok(!existsSync(join(d, 'scripts/local-up.sh')), 'no scaffold without opt-in');
    run(['apply-static', d]);                       // no profile → local-dev not scaffolded
    assert.ok(!existsSync(join(d, 'scripts/local-up.sh')));
    const p = join(d, 'profile.json');
    writeFileSync(p, JSON.stringify({ localDev: 'scaffold' }));
    run(['apply-static', d, '--profile', p]);
    const sh = join(d, 'scripts/local-up.sh');
    assert.ok(existsSync(sh));
    assert.ok(statSync(sh).mode & 0o100, 'owner-exec bit set');
    rmSync(d, { recursive: true, force: true });
  });
});
