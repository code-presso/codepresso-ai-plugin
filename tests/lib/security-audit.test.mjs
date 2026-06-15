import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECKLIST } from '../../scripts/lib/security-checklist.mjs';

const CLI = join(process.cwd(), 'scripts', 'security-audit-cli.mjs');

function run(args, stdin) {
  return execFileSync('node', [CLI, ...args], {
    input: stdin, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
  });
}

describe('security-audit-cli', () => {
  let dir;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'sec-audit-'));
    // A deliberately vulnerable fixture (any-stack, no toolchain required).
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'fixture', dependencies: { left: '^1.0.0', right: 'latest' }
    }));
    writeFileSync(join(dir, 'server.py'),
      'import os\nq = "SELECT * FROM users WHERE id = " + user_id\nos.system("rm " + path)\n');
    writeFileSync(join(dir, 'config.js'),
      'const apiKey = "sk_live_abcdefghijklmnop1234";\nconst url = "http://api.example.com";\n');
    writeFileSync(join(dir, 'app.js'),
      "app.use(cors());\ntry { risky(); } catch {}\nel.innerHTML = userInput;\n");
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('checklist emits all OWASP 2025 categories as JSON', () => {
    const out = JSON.parse(run(['checklist']));
    assert.equal(out.length, CHECKLIST.length);
    assert.ok(out.some((c) => c.owasp === 'A03:2025'), 'has supply-chain category');
    assert.ok(out.every((c) => Array.isArray(c.interview) && c.interview.length > 0));
  });

  it('scan detects stack and surfaces findings across categories', () => {
    const out = JSON.parse(run(['scan', dir]));
    assert.ok(out.scannedFiles >= 4);
    assert.ok(out.stack.languages.includes('Python'));
    assert.ok(out.stack.languages.includes('JavaScript'));
    const ids = new Set(out.findings.map((f) => f.id));
    assert.ok(ids.has('SC-03'), 'flags unpinned deps / missing lockfile');
    assert.ok(ids.has('SC-04'), 'flags hardcoded secret');
    assert.ok(ids.has('SC-05'), 'flags injection sink');
    assert.ok(out.interviewTriggers.length >= 10);
  });

  it('scan masks secret values in evidence', () => {
    const out = JSON.parse(run(['scan', dir]));
    const secret = out.findings.find((f) => f.id === 'SC-04');
    assert.ok(secret, 'has a secret finding');
    assert.ok(!secret.evidence.includes('abcdefghijklmnop1234'), 'raw secret not leaked in evidence');
  });

  it('scan ignores env-var references (no false positive)', () => {
    const d2 = mkdtempSync(join(tmpdir(), 'sec-clean-'));
    writeFileSync(join(d2, 'ok.js'), 'const apiKey = process.env.API_KEY;\n');
    const out = JSON.parse(run(['scan', d2]));
    assert.equal(out.findings.filter((f) => f.id === 'SC-04').length, 0);
    rmSync(d2, { recursive: true, force: true });
  });

  it('scan-local probes the developer HOME without leaking secret values', () => {
    const h = mkdtempSync(join(tmpdir(), 'sec-home-'));
    mkdirSync(join(h, '.aws'), { recursive: true });
    writeFileSync(join(h, '.aws', 'credentials'),
      '[default]\naws_access_key_id = AKIAIOSFODNN7EXAMPLE\naws_secret_access_key = wJalrXUtnFEMI1234567890abcdefghijklmnopq\n');
    mkdirSync(join(h, '.ssh'), { recursive: true });
    writeFileSync(join(h, '.ssh', 'id_test'),
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ==\n-----END OPENSSH PRIVATE KEY-----\n');
    writeFileSync(join(h, '.npmrc'), '//registry.npmjs.org/:_authToken=npm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n');
    writeFileSync(join(h, '.git-credentials'), 'https://user:ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@github.com\n');

    const out = JSON.parse(run(['scan-local', h]));
    assert.equal(out.scope, 'developer-endpoint');
    const titles = out.findings.map((f) => f.title).join(' | ');
    assert.match(titles, /Long-lived AWS access key/);
    assert.match(titles, /Unencrypted SSH private key/);
    assert.match(titles, /npm auth token/);
    assert.match(titles, /Plaintext git credentials/);
    assert.ok(out.findings.every((f) => f.id === 'SC-12'));
    // No raw secret material in the output JSON.
    const blob = JSON.stringify(out);
    assert.ok(!blob.includes('AKIAIOSFODNN7EXAMPLE'), 'AWS key id not leaked');
    assert.ok(!blob.includes('wJalrXUtnFEMI'), 'AWS secret not leaked');
    assert.ok(!blob.includes('npm_aaaa'), 'npm token not leaked');
    assert.ok(!blob.includes('ghp_aaaa'), 'git token not leaked');
    rmSync(h, { recursive: true, force: true });
  });

  it('report merges repo scan + local scan findings', () => {
    const scan = JSON.parse(run(['scan', dir]));
    const localScan = { platform: 'linux', permissionChecks: 'enabled', checkedLocations: ['~/.aws/credentials'],
      findings: [{ id: 'SC-12', owasp: 'A04:2025 / A07:2025', severity: 'critical', title: 'Long-lived AWS access key', file: '~/.aws/credentials', line: 0, evidence: 'x' }] };
    const answers = [{ id: 'SC-12', status: 'fail', note: 'rotate to SSO' }];
    const md = run(['report'], JSON.stringify({ scan, localScan, answers }));
    assert.ok(md.includes('Developer endpoint scan:'), 'header reflects endpoint scan');
    assert.ok(md.includes('Developer Endpoint & Local Credential Hygiene'), 'SC-12 in scorecard');
  });

  it('report produces a scored markdown report from scan + answers', () => {
    const scan = JSON.parse(run(['scan', dir]));
    const answers = CHECKLIST.map((c, i) => ({ id: c.id, status: i % 2 ? 'pass' : 'fail', note: '' }));
    const md = run(['report'], JSON.stringify({ scan, answers }));
    assert.ok(/\d+\/100 \(grade [A-F]\)/.test(md), 'has a score');
    assert.ok(md.includes('## Scorecard'));
    assert.ok(md.includes('## Priority remediation'));
    assert.ok(md.includes('A03:2025'), 'cites OWASP categories');
  });
});
