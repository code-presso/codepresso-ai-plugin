// security-checklist.mjs
//
// Tech-stack-agnostic web security checklist, grounded in the OWASP Top 10:2025
// release and the notable 2025–2026 web security incidents that motivated each item.
//
// Each item is consumed by two surfaces:
//   - scripts/security-audit-cli.mjs `scan`  → runs the regex/file probes in `autoChecks`
//     against a target repo to gather *evidence* before the interview.
//   - skills/security-audit/SKILL.md          → drives the human interview using `interview`,
//     then maps answers + evidence into a scored report via `report`.
//
// `weight` feeds the posture score (0–100). `severityIfFail` is the default severity
// when a category is judged failing during the interview.

export const CHECKLIST = [
  {
    id: 'SC-01',
    owasp: 'A01:2025',
    title: 'Broken Access Control (IDOR / BOLA / privilege escalation)',
    incident:
      'Broken Access Control held #1 in OWASP 2025. Many 2025 breaches began not with a 0-day but a missing authorization check in an API — e.g. object IDs accepted without an ownership check (IDOR/BOLA).',
    weight: 14,
    severityIfFail: 'critical',
    // Access control is mostly logic — the scanner can only surface hints; the interview decides.
    autoChecks: [
      { kind: 'grep', pattern: '\\breq\\.(params|query|body)\\.[a-zA-Z_]*[iI]d\\b', label: 'request uses caller-supplied id (verify ownership check exists)' },
      { kind: 'grep', pattern: '(?i)findById|get_object_or_404|\\.objects\\.get\\(', label: 'direct object lookup by id (verify scoped to current user)' }
    ],
    interview: [
      'Are object-level authorization checks enforced server-side for every resource fetched by an id (no trusting the client)?',
      'Are admin/privileged routes protected by a role check that runs on the server, not just hidden in the UI?',
      'Is access control denied-by-default (deny unless explicitly allowed) rather than allowed-by-default?'
    ]
  },
  {
    id: 'SC-02',
    owasp: 'A02:2025',
    title: 'Security Misconfiguration (headers, CORS, debug, defaults)',
    incident:
      'Security Misconfiguration rose from #5 (2021) to #2 (2025). Cloud misconfiguration was the single largest breach cause in 2025 — over-permissive CORS, debug mode in production, default credentials, and missing security headers recur in incident reports.',
    weight: 12,
    severityIfFail: 'high',
    autoChecks: [
      { kind: 'grep', pattern: 'Access-Control-Allow-Origin["\']?\\s*[:,]\\s*["\']?\\*', label: 'wildcard CORS (Access-Control-Allow-Origin: *)' },
      { kind: 'grep', pattern: '(?i)cors\\(\\s*\\)|origin\\s*:\\s*(true|["\']\\*["\'])', label: 'permissive CORS config (reflect/any origin)' },
      { kind: 'grep', pattern: '(?i)(DEBUG|FLASK_DEBUG|django\\.conf.*DEBUG)\\s*[:=]\\s*(True|true|1)\\b', label: 'debug mode enabled' },
      { kind: 'grep', pattern: '(?i)rejectUnauthorized\\s*:\\s*false|verify\\s*=\\s*False|InsecureSkipVerify\\s*:\\s*true', label: 'TLS certificate verification disabled' },
      { kind: 'grep', pattern: 'http://(?!localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0)[a-zA-Z]', label: 'plaintext http:// endpoint (non-localhost)' }
    ],
    interview: [
      'Are security headers set in production (HSTS, X-Content-Type-Options, a Content-Security-Policy, X-Frame-Options/frame-ancestors)?',
      'Is CORS restricted to a known allow-list of origins (no "*" with credentials)?',
      'Is debug/verbose-error mode disabled in production, and are default/sample credentials removed?'
    ]
  },
  {
    id: 'SC-03',
    owasp: 'A03:2025',
    title: 'Software Supply Chain Failures (dependencies, lockfiles, build)',
    incident:
      'NEW in OWASP 2025. The Sept 2025 npm "Qix" compromise poisoned chalk/debug/ansi-styles (~2.6B weekly downloads); the self-propagating Shai-Hulud worm hit 500+ packages and stole cloud tokens; the March 2026 Axios compromise weaponized one of npm\'s most-downloaded packages. Unpinned/unverified dependencies are now a top-tier risk.',
    weight: 13,
    severityIfFail: 'critical',
    autoChecks: [
      { kind: 'manifest-no-lockfile', label: 'dependency manifest without a committed lockfile' },
      { kind: 'grep', glob: 'package.json', pattern: '["\'][~^*]|"\\*"|:\\s*"latest"', label: 'unpinned dependency version range (^ ~ * latest)' },
      { kind: 'grep', glob: '*.{yml,yaml}', pattern: '(?i)(curl|wget)\\s+[^|]*\\|\\s*(sh|bash)', label: 'pipe-to-shell install in CI (curl | bash)' }
    ],
    interview: [
      'Are dependencies installed from a committed lockfile with integrity hashes (npm ci / pip install --require-hashes / equivalent), not floating ranges?',
      'Do you run automated dependency vulnerability + advisory scanning (npm audit / Dependabot / Snyk / OSV) in CI, and were you exposed to the Sept-2025 npm or Shai-Hulud advisories?',
      'Are CI/CD build steps and third-party GitHub Actions pinned to a verified version/commit SHA rather than a mutable tag?'
    ]
  },
  {
    id: 'SC-04',
    owasp: 'A04:2025',
    title: 'Cryptographic Failures & Secret Management',
    incident:
      'Credential-based attacks — valid logins and over-privileged tokens harvested from leaks — drove the majority of 2025\'s largest breaches. Secrets hardcoded in source or shipped to the front-end (weak/reversible "client-side encryption") repeatedly exposed entire data lakes.',
    weight: 13,
    severityIfFail: 'critical',
    autoChecks: [
      { kind: 'secret-scan', label: 'hardcoded secret / API key / private key in source' },
      { kind: 'tracked-file', patterns: ['.env', '.env.*', '*.pem', '*.key', 'id_rsa', 'credentials', '*.p12', '*.pfx'], label: 'secret-bearing file tracked in git' },
      { kind: 'grep', pattern: '(?i)(md5|sha1)\\s*\\(', label: 'weak hash (MD5/SHA1) — verify not used for passwords/integrity' }
    ],
    interview: [
      'Are all secrets injected from a vault / secret manager / environment at runtime (never committed, never sent to the browser)?',
      'Are passwords stored with a slow adaptive hash (bcrypt/scrypt/argon2) and data encrypted in transit (TLS) and at rest?',
      'Is there a rotation + revocation process for API keys/tokens, and are token scopes least-privilege?'
    ]
  },
  {
    id: 'SC-05',
    owasp: 'A05:2025',
    title: 'Injection (SQLi, XSS, command, template)',
    incident:
      'XSS and SQL injection together accounted for ~38% of all web weaknesses found in H1 2025. They remain the most common path from a public form/portal to data exfiltration.',
    weight: 12,
    severityIfFail: 'critical',
    autoChecks: [
      { kind: 'grep', pattern: '(?i)(SELECT|INSERT|UPDATE|DELETE)\\b[^;]*["\']\\s*\\+|f["\'].*(SELECT|INSERT|UPDATE|DELETE)\\b|%\\s*\\(.*(SELECT|INSERT)', label: 'string-concatenated SQL (use parameterized queries)' },
      { kind: 'grep', pattern: 'dangerouslySetInnerHTML|\\.innerHTML\\s*=|v-html\\b|\\|\\s*safe\\b', label: 'raw HTML sink (XSS risk)' },
      { kind: 'grep', pattern: '\\beval\\s*\\(|new Function\\s*\\(|os\\.system\\s*\\(|subprocess\\.[a-z]+\\([^)]*shell\\s*=\\s*True|child_process', label: 'dynamic code / shell execution sink' }
    ],
    interview: [
      'Are all database queries parameterized / use an ORM with bound parameters (never string concatenation of user input)?',
      'Is untrusted output contextually escaped, and is a Content-Security-Policy in place as XSS defense-in-depth?',
      'Are OS-command, template, and deserialization sinks fed only validated/allow-listed input?'
    ]
  },
  {
    id: 'SC-06',
    owasp: 'A06:2025',
    title: 'Insecure Design (threat modeling, rate limits, business logic)',
    incident:
      'OWASP 2025 emphasizes root causes over symptoms. 2025 incidents frequently abused missing rate limits, weak password-reset/MFA flows, and unbounded business-logic operations rather than a single coding bug.',
    weight: 8,
    severityIfFail: 'high',
    autoChecks: [
      { kind: 'grep', pattern: '(?i)rate.?limit|throttle|express-rate-limit|slowapi|bucket4j', label: 'rate-limiting present (confirms a control exists)', positive: true }
    ],
    interview: [
      'Have you threat-modeled the critical flows (auth, payment, password reset, data export) and added abuse/rate limits?',
      'Are sensitive actions protected against automation (rate limiting, CAPTCHA, anomaly detection) and replay?',
      'Are trust boundaries explicit — is every input from the client treated as hostile, including from your own front-end?'
    ]
  },
  {
    id: 'SC-07',
    owasp: 'A07:2025',
    title: 'Authentication & Session Failures (MFA, OAuth scopes, sessions)',
    incident:
      'Over-permissioned OAuth tokens were a recurring 2025 entry point — developers granted third-party apps more access than needed. Credential stuffing against logins without MFA or lockout was a leading initial-access vector.',
    weight: 10,
    severityIfFail: 'critical',
    autoChecks: [
      { kind: 'grep', pattern: '(?i)jwt[._]?(secret|key)\\s*[:=]\\s*["\'][^"\']+["\']|algorithm\\s*[:=]\\s*["\']none["\']', label: 'hardcoded JWT secret or alg=none' },
      { kind: 'grep', pattern: '(?i)(httpOnly\\s*:\\s*false|secure\\s*:\\s*false)\\b', label: 'cookie missing HttpOnly/Secure flag' }
    ],
    interview: [
      'Is MFA available/enforced for sensitive accounts, with lockout/throttling against credential stuffing?',
      'Are sessions/tokens short-lived, rotated on privilege change, invalidated on logout, and cookies HttpOnly+Secure+SameSite?',
      'Are OAuth/third-party integration scopes least-privilege and periodically reviewed (no broad "all access" grants)?'
    ]
  },
  {
    id: 'SC-08',
    owasp: 'A08:2025',
    title: 'Software & Data Integrity Failures (CI/CD, deserialization, updates)',
    incident:
      'OWASP 2025 keeps integrity high. The Shai-Hulud worm spread through compromised CI tokens and unsigned package updates; insecure deserialization and unsigned auto-update channels let attacker-controlled code execute.',
    weight: 8,
    severityIfFail: 'high',
    autoChecks: [
      { kind: 'grep', pattern: '(?i)pickle\\.loads|yaml\\.load\\((?!.*Loader)|Marshal\\.load|ObjectInputStream|unserialize\\(', label: 'unsafe deserialization of untrusted data' },
      { kind: 'grep', glob: '*.{yml,yaml}', pattern: 'uses:\\s*[^@\\n]+@(main|master|latest|v\\d+)\\s*$', label: 'GitHub Action pinned to mutable tag (not a SHA)' }
    ],
    interview: [
      'Are CI/CD secrets scoped and rotated, and are deploy artifacts built from verified, integrity-checked sources?',
      'Is untrusted data never deserialized into objects (or only via safe, schema-validated formats)?',
      'Are auto-updates / plugins signed and verified before execution?'
    ]
  },
  {
    id: 'SC-09',
    owasp: 'A09:2025',
    title: 'Security Logging & Alerting Failures',
    incident:
      'Renamed in OWASP 2025 to stress *alerting*. In 2025 a misconfigured cloud bucket exposed millions of records "undetected for weeks" — the failure was not the bug but the absence of detection and alerting.',
    weight: 6,
    severityIfFail: 'medium',
    autoChecks: [
      { kind: 'grep', pattern: '(?i)console\\.log\\([^)]*(password|token|secret|authorization)|print\\([^)]*(password|token|secret)', label: 'sensitive value possibly written to logs' }
    ],
    interview: [
      'Are authentication, access-control, and server-side validation failures logged with enough context to investigate?',
      'Do logs feed alerting/monitoring so suspicious activity is detected in minutes, not weeks — and are logs tamper-resistant?',
      'Are logs scrubbed of secrets/PII (no passwords, tokens, full card/PII in log lines)?'
    ]
  },
  {
    id: 'SC-10',
    owasp: 'A10:2025',
    title: 'Mishandling of Exceptional Conditions (errors, timeouts, fail-open)',
    incident:
      'NEW in OWASP 2025. Apps that mishandle timeouts, overloads, or unexpected input create openings — fail-open error paths, leaked stack traces, and unhandled exceptions that bypass security checks featured in 2025 incidents.',
    weight: 5,
    severityIfFail: 'medium',
    autoChecks: [
      { kind: 'grep', pattern: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}|except\\s*:\\s*pass|catch\\s*\\{\\s*\\}', label: 'swallowed/empty exception handler (fail-open risk)' },
      { kind: 'grep', pattern: '(?i)(printStackTrace|traceback\\.print_exc|res\\.send\\(.*err|return.*err\\.stack)', label: 'error/stack trace possibly returned to client' }
    ],
    interview: [
      'Do error paths fail closed (deny on error), never fail-open past an auth/authorization check?',
      'Are detailed errors/stack traces hidden from clients (generic message out, full detail to logs)?',
      'Are timeouts, retries, and resource limits set so overload/abuse degrades safely?'
    ]
  },
  {
    id: 'SC-12',
    owasp: 'A04:2025 / A07:2025',
    title: 'Developer Endpoint & Local Credential Hygiene',
    incident:
      'The Sept-2025 npm "Qix" attack started by phishing a maintainer\'s npm token; the Shai-Hulud worm spread by stealing cloud tokens and CI secrets sitting on developer machines. Most 2025 breaches began with valid credentials harvested from endpoints — long-lived AWS keys, unencrypted SSH keys, plaintext npm/docker/git tokens in dotfiles.',
    weight: 9,
    severityIfFail: 'critical',
    local: true, // scored against `scan-local`, not the repo scan
    autoChecks: [], // handled by the dedicated local-credential probe
    interview: [
      'Are cloud credentials short-lived (SSO / aws sso / OIDC / temporary STS) rather than long-lived AKIA access keys stored in ~/.aws/credentials?',
      'Are SSH private keys passphrase-encrypted and registry/npm/docker/git tokens kept out of plaintext dotfiles (use a credential helper / keychain / 1Password / vault)?',
      'Is full-disk encryption + screen lock enabled, and is there a fast revocation path if a laptop or token is compromised (the Shai-Hulud / Qix scenario)?'
    ]
  },
  {
    id: 'SC-11',
    owasp: 'A03:2025 / SSRF',
    title: 'AI / LLM Integration & SSRF (prompt injection, tool abuse)',
    incident:
      'EchoLeak (2025) was the first real-world zero-click prompt-injection exploit in a production LLM system; Cursor MCP CVEs (CVE-2025-54135/54136) enabled arbitrary command execution. PortSwigger frames insecure LLM integrations as a modern cousin of SSRF and API abuse. Only applies if the app integrates an LLM or fetches user-supplied URLs.',
    weight: 5,
    severityIfFail: 'high',
    optional: true,
    autoChecks: [
      { kind: 'grep', pattern: '(?i)openai|anthropic|@langchain|llamaindex|modelcontextprotocol|requests\\.get\\([^)]*url|fetch\\([^)]*req\\.(body|query)', label: 'LLM client or server-side fetch of user-supplied URL (SSRF/prompt-injection surface)' }
    ],
    interview: [
      'If the app uses an LLM: is untrusted content (user input, fetched pages, emails) kept out of the privileged/instruction context, and are model-triggered tool/function calls allow-listed and authorized?',
      'Are server-side fetches (webhooks, link unfurling, image proxy, LLM URL retrieval) restricted to an allow-list and blocked from internal/metadata addresses (169.254.169.254, RFC1918)?',
      'Is LLM/tool output treated as untrusted before it reaches a sink (rendered HTML, shell, DB, downstream API)?'
    ]
  }
];

export const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

// Status the interview can assign per category.
export const STATUSES = ['pass', 'partial', 'fail', 'na'];

// Fractional credit each status earns toward the weighted posture score.
export const STATUS_CREDIT = { pass: 1, partial: 0.5, fail: 0, na: null };
