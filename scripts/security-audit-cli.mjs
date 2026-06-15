#!/usr/bin/env node
// security-audit-cli.mjs
//
// Tech-stack-agnostic harness for the /codepresso:security-audit skill.
//
// Commands:
//   scan [path]        Walk a repo and gather security *evidence* (no network, no stack assumptions).
//                      Emits JSON: { target, scannedFiles, stack, findings[], interviewTriggers[], summary }.
//   checklist          Emit the full checklist (OWASP 2025 + 2025–2026 incident grounding) as JSON.
//   report             Read JSON {scan, answers[]} from stdin, emit a scored markdown report to stdout.
//
// Deterministic only: regex/file probes + scoring + markdown rendering. All human
// judgment (interview Q&A, severity decisions) lives in skills/security-audit/SKILL.md.
//
// Works on any language/framework: it keys off file content + manifest presence,
// never on a specific toolchain being installed.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, extname, sep } from 'node:path';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { CHECKLIST, SEVERITY_RANK, STATUS_CREDIT } from './lib/security-checklist.mjs';

// ---------------------------------------------------------------------------
// Repo walking
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor',
  '.venv', 'venv', '__pycache__', 'target', '.next', '.nuxt', '.svelte-kit',
  '.cache', '.gradle', 'bin', 'obj', '.idea', '.vscode', 'Pods'
]);

const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte', '.py',
  '.rb', '.go', '.rs', '.java', '.kt', '.php', '.cs', '.scala', '.ex', '.exs',
  '.json', '.yml', '.yaml', '.toml', '.ini', '.env', '.cfg', '.conf', '.xml',
  '.html', '.htm', '.sh', '.bash', '.tf', '.tfvars', '.hcl', '.sql', '.properties',
  '.gradle', '.dockerfile', '.txt', '.md'
]);

const MAX_FILE_BYTES = 1.5 * 1024 * 1024; // skip files > 1.5MB (likely data/binary)
const MAX_LINE_EVIDENCE = 160;

function listFiles(root) {
  // Prefer git's tracked-file list (respects .gitignore, fast, accurate).
  try {
    const out = execSync('git ls-files', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const files = out.split('\n').map((f) => f.trim()).filter(Boolean).map((f) => join(root, f));
    if (files.length) return files;
  } catch {
    /* not a git repo — fall through to manual walk */
  }
  const acc = [];
  walk(root, acc, 0);
  return acc;
}

function walk(dir, acc, depth) {
  if (depth > 12) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && (e.name === '.git')) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(join(dir, e.name), acc, depth + 1);
    } else if (e.isFile()) {
      acc.push(join(dir, e.name));
    }
  }
}

function isTextFile(path) {
  const ext = extname(path).toLowerCase();
  const name = basename(path).toLowerCase();
  if (name === 'dockerfile' || name.startsWith('dockerfile.') || name === '.npmrc' || name === '.env') return true;
  return TEXT_EXT.has(ext);
}

function safeRead(path) {
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Secret detection
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'AWS secret access key', re: /aws_secret[^=:]*[:=]\s*['"][A-Za-z0-9/+=]{40}['"]/i },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { name: 'Notion integration token', re: /\b(?:ntn_|secret_)[A-Za-z0-9]{40,}\b/ },
  { name: 'Stripe live key', re: /\bsk_live_[A-Za-z0-9]{16,}\b/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/ },
  { name: 'Generic hardcoded credential', re: /(?:api[_-]?key|secret|token|passwd|password|access[_-]?key)\s*[:=]\s*['"][^'"\s${}]{12,}['"]/i }
];

// Values that look like secrets but are placeholders / references — suppress these.
const SECRET_FALSE_POSITIVE = /(process\.env|os\.environ|getenv|import\.meta\.env|\$\{|<[^>]+>|example|sample|placeholder|dummy|changeme|your[_-]?|xxxx|0{8,}|test[_-]?(key|token|secret)|fake)/i;

function buildRegex(spec) {
  // Support an inline "(?i)" prefix for case-insensitivity (not native in JS).
  let src = spec;
  let flags = '';
  if (src.startsWith('(?i)')) {
    src = src.slice(4);
    flags = 'i';
  }
  return new RegExp(src, flags);
}

function scanSecrets(rel, content, findings) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 1000) continue;
    for (const p of SECRET_PATTERNS) {
      const re = typeof p.re === 'string' ? buildRegex(p.re) : p.re;
      if (re.test(line)) {
        if (SECRET_FALSE_POSITIVE.test(line)) continue;
        findings.push({
          id: 'SC-04', owasp: 'A04:2025', severity: 'critical',
          title: `Possible hardcoded secret: ${p.name}`,
          file: rel, line: i + 1,
          evidence: redactLine(line)
        });
        break; // one finding per line is enough
      }
    }
  }
}

function redactLine(line) {
  let t = line.trim().slice(0, MAX_LINE_EVIDENCE);
  // Mask the middle of long secret-like runs (quoted or not): keep a short head/tail for context.
  t = t.replace(/([A-Za-z0-9/+_\-=]{6})[A-Za-z0-9/+_\-=]{10,}([A-Za-z0-9/+_\-=]{4})/g, '$1…REDACTED…$2');
  return t;
}

// ---------------------------------------------------------------------------
// Generic grep checks (from checklist autoChecks)
// ---------------------------------------------------------------------------

function globMatch(glob, name) {
  if (!glob) return true;
  // tiny glob: support "*.ext", "name.ext", and brace sets "*.{a,b}"
  const brace = glob.match(/^(.*)\{([^}]+)\}(.*)$/);
  if (brace) {
    const [, pre, opts, post] = brace;
    return opts.split(',').some((o) => globMatch(`${pre}${o}${post}`, name));
  }
  if (glob.startsWith('*.')) return name.toLowerCase().endsWith(glob.slice(1).toLowerCase());
  return name.toLowerCase() === glob.toLowerCase();
}

function runGrepCheck(item, check, files, fileCache, findings) {
  const re = buildRegex(check.pattern);
  let hit = null;
  for (const { rel, name, content } of fileCache) {
    if (!globMatch(check.glob, name)) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 2000) continue;
      if (re.test(lines[i])) {
        hit = { rel, line: i + 1, evidence: redactLine(lines[i]) };
        break;
      }
    }
    if (hit) break;
  }
  if (check.positive) {
    // "positive" checks confirm a control exists — only informational, no finding on hit.
    return;
  }
  if (hit) {
    findings.push({
      id: item.id, owasp: item.owasp, severity: item.severityIfFail,
      title: check.label, file: hit.rel, line: hit.line, evidence: hit.evidence
    });
  }
}

// ---------------------------------------------------------------------------
// Supply-chain / manifest checks
// ---------------------------------------------------------------------------

const LOCKFILES = {
  'package.json': ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'],
  'requirements.txt': ['requirements.lock', 'poetry.lock', 'Pipfile.lock'],
  'pyproject.toml': ['poetry.lock', 'pdm.lock', 'uv.lock'],
  'Gemfile': ['Gemfile.lock'],
  'composer.json': ['composer.lock'],
  'go.mod': ['go.sum'],
  'Cargo.toml': ['Cargo.lock'],
  'build.gradle': ['gradle.lockfile'],
  'pom.xml': [] // maven uses ranges rarely; skip lock requirement
};

function checkManifestLockfiles(byBasename, findings) {
  for (const [manifest, locks] of Object.entries(LOCKFILES)) {
    if (!locks.length) continue;
    if (byBasename.has(manifest)) {
      const hasLock = locks.some((l) => byBasename.has(l));
      if (!hasLock) {
        findings.push({
          id: 'SC-03', owasp: 'A03:2025', severity: 'high',
          title: `Dependency manifest "${manifest}" has no committed lockfile (supply-chain integrity gap)`,
          file: byBasename.get(manifest), line: 0,
          evidence: `expected one of: ${locks.join(', ')}`
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tracked-file checks (secret-bearing files committed to git)
// ---------------------------------------------------------------------------

function checkTrackedFiles(files, root, findings) {
  const item = CHECKLIST.find((c) => c.autoChecks.some((a) => a.kind === 'tracked-file'));
  const check = item?.autoChecks.find((a) => a.kind === 'tracked-file');
  if (!check) return;
  for (const f of files) {
    const name = basename(f);
    for (const pat of check.patterns) {
      if (globMatch(pat, name) || name === pat) {
        // .env.example / .env.sample are conventional templates — allow them.
        if (/\.(example|sample|template|dist)$/i.test(name)) break;
        findings.push({
          id: 'SC-04', owasp: 'A04:2025', severity: 'high',
          title: `Secret-bearing file tracked in git: ${name}`,
          file: relative(root, f), line: 0, evidence: check.label
        });
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Stack detection (informational; drives which interview branches apply)
// ---------------------------------------------------------------------------

function detectStack(byBasename, fileCache) {
  const languages = new Set();
  const extLang = {
    '.js': 'JavaScript', '.mjs': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript',
    '.jsx': 'JavaScript', '.vue': 'Vue', '.svelte': 'Svelte', '.py': 'Python', '.rb': 'Ruby',
    '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.php': 'PHP', '.cs': 'C#'
  };
  for (const { name } of fileCache) {
    const ext = extname(name).toLowerCase();
    if (extLang[ext]) languages.add(extLang[ext]);
  }
  const manifests = ['package.json', 'requirements.txt', 'pyproject.toml', 'Gemfile', 'composer.json', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle']
    .filter((m) => byBasename.has(m));
  return {
    languages: [...languages],
    manifests,
    hasDocker: [...byBasename.keys()].some((n) => n.toLowerCase().startsWith('dockerfile') || n === 'docker-compose.yml' || n === 'docker-compose.yaml'),
    hasIaC: fileCache.some((f) => f.name.endsWith('.tf') || f.name.endsWith('.hcl')) || byBasename.has('serverless.yml') || byBasename.has('template.yaml'),
    hasCI: fileCache.some((f) => f.rel.includes('.github/workflows') || f.rel.includes('.gitlab-ci') || f.name === 'Jenkinsfile' || f.rel.includes('.circleci')),
    usesLLM: fileCache.some((f) => /(openai|anthropic|langchain|llamaindex|modelcontextprotocol)/i.test(f.content))
  };
}

// ---------------------------------------------------------------------------
// scan command
// ---------------------------------------------------------------------------

function cmdScan(target) {
  const root = target || process.cwd();
  if (!existsSync(root)) {
    process.stderr.write(`Target not found: ${root}\n`);
    process.exit(2);
  }
  const files = listFiles(root);
  const fileCache = [];
  const byBasename = new Map();
  let scannedFiles = 0;

  for (const f of files) {
    const name = basename(f);
    if (!byBasename.has(name)) byBasename.set(name, relative(root, f));
    if (!isTextFile(f)) continue;
    const content = safeRead(f);
    if (content == null) continue;
    scannedFiles++;
    fileCache.push({ rel: relative(root, f).split(sep).join('/'), name, content });
  }

  const findings = [];

  // 1. Secret scan across all text files.
  for (const { rel, content } of fileCache) {
    // skip lockfiles + this checklist's own pattern file to avoid self-matching
    if (/(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|security-checklist\.mjs|security-audit-cli\.mjs)$/.test(rel)) continue;
    scanSecrets(rel, content, findings);
  }

  // 2. Per-checklist grep autoChecks.
  for (const item of CHECKLIST) {
    for (const check of item.autoChecks) {
      if (check.kind === 'grep') runGrepCheck(item, check, files, fileCache, findings);
    }
  }

  // 3. Manifest lockfile + tracked-secret-file checks.
  checkManifestLockfiles(byBasename, findings);
  checkTrackedFiles(files, root, findings);

  const stack = detectStack(byBasename, fileCache);

  // Interview triggers: every non-optional category, plus the LLM/SSRF one only if relevant.
  const interviewTriggers = CHECKLIST
    .filter((c) => !c.optional || stack.usesLLM)
    .map((c) => c.id);

  // Dedup findings (same id+file+line) and cap noise per category.
  const seen = new Set();
  const deduped = [];
  const perCat = {};
  for (const fnd of findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])) {
    const key = `${fnd.id}|${fnd.file}|${fnd.line}|${fnd.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    perCat[fnd.id] = (perCat[fnd.id] || 0) + 1;
    if (perCat[fnd.id] > 10) continue; // cap per category; note truncation below
    deduped.push(fnd);
  }

  const summary = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of deduped) summary[f.severity] = (summary[f.severity] || 0) + 1;

  const truncated = Object.entries(perCat).filter(([, n]) => n > 10).map(([id]) => id);

  process.stdout.write(JSON.stringify({
    target: root,
    scannedFiles,
    stack,
    findings: deduped,
    interviewTriggers,
    summary,
    truncatedCategories: truncated
  }, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// checklist command
// ---------------------------------------------------------------------------

function cmdChecklist() {
  process.stdout.write(JSON.stringify(CHECKLIST, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// scan-local command — developer endpoint credential hygiene
//
// Probes well-known credential locations in the developer's HOME. Reports
// presence + risk type ONLY — never prints a secret value. Cross-platform:
// POSIX permission checks run on mac/linux; skipped (noted) on Windows.
// ---------------------------------------------------------------------------

function homeExists(home, rel) {
  return existsSync(join(home, rel));
}

function readHead(path, maxBytes = 8192) {
  try {
    const buf = readFileSync(path);
    return buf.slice(0, maxBytes).toString('utf8');
  } catch {
    return null;
  }
}

function posixPermsTooOpen(path) {
  if (process.platform === 'win32') return null; // ACL model differs; skip
  try {
    const mode = statSync(path).mode & 0o777;
    return (mode & 0o077) !== 0 ? mode.toString(8).padStart(3, '0') : null;
  } catch {
    return null;
  }
}

function pushLocal(findings, sev, title, where, note) {
  findings.push({ id: 'SC-12', owasp: 'A04:2025 / A07:2025', severity: sev, title, file: where, line: 0, evidence: note });
}

function cmdScanLocal(home) {
  const HOME = home || homedir();
  const findings = [];
  const checked = [];

  // 1. AWS credentials — long-lived keys.
  if (homeExists(HOME, '.aws/credentials')) {
    checked.push('~/.aws/credentials');
    const c = readHead(join(HOME, '.aws/credentials')) || '';
    if (/\bAKIA[0-9A-Z]{16}\b/.test(c) || /aws_secret_access_key/i.test(c)) {
      pushLocal(findings, 'critical', 'Long-lived AWS access key in ~/.aws/credentials', '~/.aws/credentials',
        'static IAM key on disk — prefer AWS SSO / temporary STS credentials');
    }
    const perm = posixPermsTooOpen(join(HOME, '.aws/credentials'));
    if (perm) pushLocal(findings, 'high', 'AWS credentials file is group/world-readable', '~/.aws/credentials', `mode ${perm} — chmod 600`);
  }

  // 2. SSH private keys — unencrypted / loose perms.
  const sshDir = join(HOME, '.ssh');
  if (existsSync(sshDir)) {
    checked.push('~/.ssh');
    let entries = [];
    try { entries = readdirSync(sshDir); } catch { /* unreadable */ }
    for (const name of entries) {
      if (/\.pub$/.test(name) || ['known_hosts', 'config', 'authorized_keys'].includes(name)) continue;
      const full = join(sshDir, name);
      const head = readHead(full, 2048);
      if (head && /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(head)) {
        const encrypted = /ENCRYPTED/.test(head) || /bcrypt/i.test(head) || /Proc-Type:.*ENCRYPTED/.test(head);
        if (!encrypted) {
          pushLocal(findings, 'high', `Unencrypted SSH private key: ~/.ssh/${name}`, `~/.ssh/${name}`,
            'private key has no passphrase — add one (ssh-keygen -p) or move to an agent/keychain');
        }
        const perm = posixPermsTooOpen(full);
        if (perm) pushLocal(findings, 'high', `SSH private key is group/world-readable: ~/.ssh/${name}`, `~/.ssh/${name}`, `mode ${perm} — chmod 600`);
      }
    }
  }

  // 3. npm auth token (the Sept-2025 npm attack vector).
  if (homeExists(HOME, '.npmrc')) {
    checked.push('~/.npmrc');
    const c = readHead(join(HOME, '.npmrc')) || '';
    if (/_authToken\s*=/.test(c) || /_password\s*=/.test(c)) {
      pushLocal(findings, 'critical', 'npm auth token stored in plaintext in ~/.npmrc', '~/.npmrc',
        'plaintext registry token — maintainer-token theft drove the Sept-2025 npm supply-chain attacks; use a short-lived/granular token or CI-only secret');
    }
  }

  // 4. Docker registry credentials.
  if (homeExists(HOME, '.docker/config.json')) {
    checked.push('~/.docker/config.json');
    const c = readHead(join(HOME, '.docker/config.json')) || '';
    if (/"auth"\s*:\s*"[A-Za-z0-9+/=]{8,}"/.test(c)) {
      pushLocal(findings, 'high', 'Docker registry credentials stored (base64, not encrypted) in ~/.docker/config.json', '~/.docker/config.json',
        'base64 is not encryption — use a credential helper (credsStore)');
    }
  }

  // 5. git plaintext credentials.
  if (homeExists(HOME, '.git-credentials')) {
    checked.push('~/.git-credentials');
    pushLocal(findings, 'critical', 'Plaintext git credentials in ~/.git-credentials', '~/.git-credentials',
      'URLs with embedded passwords/tokens — switch to a git credential helper / OS keychain');
  }

  // 6. Other well-known token stores (presence is the signal).
  const tokenStores = [
    { rel: '.netrc', sev: 'high', note: 'machine/login/password in plaintext — restrict perms or use a keychain' },
    { rel: '.pypirc', sev: 'high', note: 'PyPI upload token in plaintext — use a scoped token / keyring' },
    { rel: '.config/gh/hosts.yml', sev: 'medium', note: 'GitHub CLI token on disk — fine if scoped; revoke on device loss' },
    { rel: '.kube/config', sev: 'medium', note: 'Kubernetes credentials — ensure tokens are short-lived/OIDC' },
    { rel: '.config/gcloud/credentials.db', sev: 'high', note: 'gcloud stored credentials — prefer ADC / short-lived tokens' }
  ];
  for (const t of tokenStores) {
    if (homeExists(HOME, t.rel)) {
      checked.push('~/' + t.rel);
      pushLocal(findings, t.sev, `Credential store present: ~/${t.rel}`, '~/' + t.rel, t.note);
    }
  }

  // 7. Shell history leaking secrets (names/patterns only; values masked).
  const histories = ['.bash_history', '.zsh_history', '.sh_history',
    '.local/share/powershell/PSReadLine/ConsoleHost_history.txt'];
  const histSecret = /(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-|sk_live_[A-Za-z0-9]{16,}|(?:export\s+)?(?:AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|NPM_TOKEN|API_KEY|SECRET)\s*=\s*\S{8,})/;
  for (const h of histories) {
    const full = join(HOME, h);
    if (!existsSync(full)) continue;
    checked.push('~/' + h);
    const c = readHead(full, 256 * 1024) || '';
    if (histSecret.test(c)) {
      pushLocal(findings, 'high', `Secret-like value found in shell history: ~/${h}`, '~/' + h,
        'tokens typed on the command line persist in history — rotate them and clear the entry');
    }
  }

  // 8. Secret-bearing env vars in THIS shell (report names only, never values).
  const envHits = Object.keys(process.env).filter((k) =>
    /(SECRET|TOKEN|_KEY$|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE)/i.test(k) &&
    (process.env[k] || '').length >= 12 &&
    !/(PATH|PUBLIC|KEYWORD|TOKENS?_FILE|_PATH$)/i.test(k));
  if (envHits.length) {
    pushLocal(findings, 'medium', `Secret-like environment variables set in current shell (${envHits.length})`, 'process.env',
      `names only: ${envHits.slice(0, 12).join(', ')}${envHits.length > 12 ? ', …' : ''} — avoid exporting long-lived secrets into the shell profile`);
  }

  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const summary = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) summary[f.severity] = (summary[f.severity] || 0) + 1;

  process.stdout.write(JSON.stringify({
    target: HOME,
    scope: 'developer-endpoint',
    platform: process.platform,
    permissionChecks: process.platform === 'win32' ? 'skipped (Windows ACL model)' : 'enabled',
    checkedLocations: checked,
    findings,
    interviewTriggers: ['SC-12'],
    summary
  }, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// report command — read {scan, answers[]} from stdin, render scored markdown
// ---------------------------------------------------------------------------

function readStdinSync() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function cmdReport() {
  const raw = readStdinSync();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stderr.write('report: stdin must be JSON {scan, answers[]}\n');
    process.exit(2);
  }
  const scan = input.scan || {};
  const localScan = input.localScan || null;
  const answers = input.answers || [];
  const ansById = new Map(answers.map((a) => [a.id, a]));

  // Merge repo-scan and (optional) developer-endpoint-scan findings.
  const allFindings = [...(scan.findings || []), ...(localScan?.findings || [])];
  const hasFindingFor = (id) => allFindings.some((f) => f.id === id);

  // Weighted posture score: pass=1, partial=0.5, fail=0; n/a excluded from denominator.
  let num = 0;
  let den = 0;
  const rows = [];
  for (const item of CHECKLIST) {
    if (item.optional && !(scan.stack && scan.stack.usesLLM) && !ansById.has(item.id)) continue;
    // Skip the developer-endpoint category unless a local scan ran or it was answered.
    if (item.local && !localScan && !ansById.has(item.id) && !hasFindingFor(item.id)) continue;
    const a = ansById.get(item.id);
    const status = a?.status || 'fail';
    const credit = STATUS_CREDIT[status];
    if (credit !== null) {
      num += credit * item.weight;
      den += item.weight;
    }
    rows.push({ item, status, note: a?.note || '' });
  }
  const score = den > 0 ? Math.round((num / den) * 100) : 0;
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'F';

  const findingsByCat = {};
  for (const f of allFindings) (findingsByCat[f.id] ||= []).push(f);

  // Combined severity summary (repo + endpoint).
  const sev = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of allFindings) sev[f.severity] = (sev[f.severity] || 0) + 1;

  const icon = { pass: '✅', partial: '🟡', fail: '❌', na: '⚪' };
  const now = input.date || '';

  let md = '';
  md += `# Web Security Audit Report\n\n`;
  md += `- **Target:** \`${scan.target || 'n/a'}\`${now ? `\n- **Date:** ${now}` : ''}\n`;
  md += `- **Posture score:** ${score}/100 (grade ${grade})\n`;
  md += `- **Automated findings:** ${sev.critical} critical · ${sev.high} high · ${sev.medium} medium · ${sev.low} low\n`;
  md += `- **Detected stack:** ${(scan.stack?.languages || []).join(', ') || 'unknown'}${scan.stack?.hasDocker ? ' · Docker' : ''}${scan.stack?.hasIaC ? ' · IaC' : ''}${scan.stack?.hasCI ? ' · CI' : ''}${scan.stack?.usesLLM ? ' · LLM' : ''}\n`;
  if (localScan) {
    md += `- **Developer endpoint scan:** ${localScan.platform} · ${(localScan.checkedLocations || []).length} credential locations checked · perm-checks ${localScan.permissionChecks}\n`;
  }
  md += `\n`;

  md += `## Scorecard\n\n`;
  md += `| Category | OWASP | Status | Auto-findings |\n|---|---|---|---|\n`;
  for (const { item, status } of rows) {
    md += `| ${item.title} | ${item.owasp} | ${icon[status] || ''} ${status} | ${(findingsByCat[item.id] || []).length} |\n`;
  }
  md += `\n`;

  // Prioritized remediation: failing/partial categories, worst-severity first.
  const order = { fail: 0, partial: 1, pass: 2, na: 3 };
  const action = rows.filter((r) => r.status === 'fail' || r.status === 'partial')
    .sort((a, b) => order[a.status] - order[b.status]);
  if (action.length) {
    md += `## Priority remediation\n\n`;
    let n = 1;
    for (const { item, status, note } of action) {
      md += `### ${n++}. ${item.title} — ${status.toUpperCase()} (${item.severityIfFail})\n`;
      md += `*${item.owasp} · why it matters:* ${item.incident}\n\n`;
      if (note) md += `**Interview note:** ${note}\n\n`;
      const fs = findingsByCat[item.id] || [];
      if (fs.length) {
        md += `**Evidence from scan:**\n`;
        for (const f of fs.slice(0, 8)) {
          md += `- \`${f.file}${f.line ? ':' + f.line : ''}\` — ${f.title}\n`;
        }
        md += `\n`;
      }
      md += `**Controls to put in place (must all be true):**\n`;
      for (const q of item.interview) md += `- [ ] ${q}\n`;
      md += `\n`;
    }
  } else {
    md += `## Priority remediation\n\nNo failing or partial categories. Maintain controls and re-audit after major changes.\n\n`;
  }

  md += `## Passing controls\n\n`;
  const passed = rows.filter((r) => r.status === 'pass');
  md += passed.length ? passed.map((r) => `- ✅ ${r.item.title}`).join('\n') + '\n' : '_None recorded._\n';

  process.stdout.write(md);
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

const [, , cmd, arg] = process.argv;
switch (cmd) {
  case 'scan': cmdScan(arg); break;
  case 'scan-local': cmdScanLocal(arg); break;
  case 'checklist': cmdChecklist(); break;
  case 'report': cmdReport(); break;
  default:
    process.stderr.write('usage: security-audit-cli.mjs <scan [path] | scan-local [home] | checklist | report>\n');
    process.exit(1);
}
