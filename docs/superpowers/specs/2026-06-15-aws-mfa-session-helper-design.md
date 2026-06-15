# AWS MFA Session Helper — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope owner:** kyeongwook.ma@codepresso.kr

## Problem

The team's AWS access uses **long-lived IAM access keys**. Console login is
MFA-protected (passkey), but the access keys bypass MFA entirely — a leaked key
grants full programmatic access (in this account, admin) with no second factor.
To close this, MFA is being enforced on IAM users via a `deny-unless-MFA` policy
(the `aws:MultiFactorAuthPresent` explicit-deny pattern; `sts:GetSessionToken`
left in the allow-list so the key can still bootstrap an MFA session).

Once that policy is active, **any AWS call made with the bare long-lived key is
denied** until the caller presents MFA. The Codepresso plugin (and the developer)
make AWS calls through several channels — the `cloud-dev` MCP server (EC2
start/stop/describe), raw `aws` CLI commands run in Bash (e.g. `aws logs`), and
potentially other AWS-backed MCP servers. All of these break under MFA
enforcement unless a valid MFA-backed session is available.

This feature lets **Claude refresh a short-lived MFA session on demand** — the
developer pastes their 6-digit code into the chat when (and only when) an AWS call
is blocked, and Claude mints + caches temporary credentials that every AWS channel
then picks up transparently.

## Goals / Non-goals

**Goals**
- Cover **all** of the developer's AWS access from one refresh: `cloud-dev` MCP,
  raw `aws` CLI in Bash, and any other AWS MCP — via the standard AWS credential
  chain.
- **Reactive** UX: prompt for the MFA code only when an AWS call is actually
  blocked, never eagerly per session.
- Short-lived sessions (**1 hour**) to minimize the leaked-cache window.
- Never expose secret credential values in chat, logs, or stdout.
- Per-developer setup that is repeatable enough to roll out to the team.
- Ship behind a flag (`aws.enabled`) so nothing changes until setup runs.

**Non-goals (separate org-policy track, NOT this spec)**
- The account-wide `deny-unless-MFA` policy for all 19 IAM users.
- The credential-hygiene bot (stale/unused key auditing).
- Cleanup of orphaned virtual MFA devices.
- aws-vault (dropped — the developer will not use it; the credential_process
  bridge is the single mechanism).

## Approach (chosen: credential_process bridge)

The refreshed temporary credentials are served to the standard AWS chain via a
`credential_process` helper wired into the `[default]` profile in
`~/.aws/config`. The long-lived key is relocated to a dedicated source profile and
used **only** to mint sessions.

```
~/.aws/config
  [default]
    credential_process = node <plugin>/scripts/aws-cred-process.mjs
    region = ap-northeast-2

~/.aws/credentials
  [codepresso-source]            # the long-lived IAM key, used only by refresh
    aws_access_key_id = ...
    aws_secret_access_key = ...

~/.codepresso/aws-session.json   # short-lived cache, chmod 600 (the refresh target)
```

Because there is no longer a `[default]` static key in `~/.aws/credentials`, the
`[default]` `credential_process` in `~/.aws/config` governs — so **every** CLI,
SDK, and MCP picks up the cached session with no `AWS_PROFILE` needed and no
fresh-shell env problem.

Alternatives considered and rejected:
- **Write session directly into `[default]` credentials** — simplest, but
  rewrites the main creds file every hour and gives weaker expiry semantics.
- **Custom file read only by our MCP** — cannot cover raw `aws` CLI or
  third-party AWS MCP servers, failing the broad-coverage goal.

## Components

Follows the plugin convention: pure tested lib + CLI dispatcher + markdown skill
(mirrors `inbox`/`aidlc`).

| Component | Type | Single purpose |
|---|---|---|
| `scripts/lib/aws-session.mjs` | pure lib (tested) | Cache read/write (atomic, chmod 600), expiry check, parse STS output → cache shape, `mfa_serial` autodetect from `list-mfa-devices` output, redaction, the reactive **detection classifiers** (bash error matcher + MCP error classifier). |
| `scripts/aws-cred-process.mjs` | credential_process entry | Read cache → if valid, emit exact `{Version:1, AccessKeyId, SecretAccessKey, SessionToken, Expiration}` JSON on stdout; if missing/expired, exit non-zero. The **only** file wired into `~/.aws/config`. Kept tiny — runs on every cache-miss. |
| `scripts/aws-cli.mjs` | CLI dispatcher | `detect-mfa`, `refresh --token-code`, `status`, `setup`. `refresh` runs `get-session-token` via the source profile, writes the cache atomically, prints a redacted result. Mirrors `inbox-cli.mjs`. |
| `skills/aws-login/SKILL.md` | skill | The refresh flow Claude follows: confirm `mfaSerial`, prompt 6-digit, call `aws-cli refresh`, report. Manual entry point **and** the target of the reactive trigger. |
| `skills/setup/SKILL.md` (extend) | skill | One-time per-dev setup: relocate long-term key → `[codepresso-source]`, write the `[default]` credential_process profile to `~/.aws/config`, detect + store `mfaSerial`, flip `aws.enabled`. Idempotent (re-run = repair). |
| `mcp/cloud-dev-server.mjs` (edit) | MCP | Catch block classifies MFA/expired/explicit-deny → returns structured `MFA_REQUIRED: run /codepresso:aws-login`. |
| `scripts/post-tool-git-watcher.mjs` (edit) | PostToolUse:Bash | Add AWS-deny detection **before** the existing `prNumber` early-return → inject `hookSpecificOutput.additionalContext` telling Claude to refresh. Guarded. |
| `~/.codepresso/config.json` → `aws` section | config | See schema below. |

## Configuration

```jsonc
"aws": {
  "enabled": false,                                 // flipped true by setup
  "sourceProfile": "codepresso-source",
  "mfaSerial": null,                                // detected at setup, e.g. arn:aws:iam::204573508773:mfa/maphone
  "sessionTtlSeconds": 3600,                        // 1 hour
  "sessionFile": "~/.codepresso/aws-session.json",
  "region": "ap-northeast-2"
}
```

Cache file `~/.codepresso/aws-session.json` (chmod 600, values never printed):

```json
{ "AccessKeyId": "ASIA…", "SecretAccessKey": "…", "SessionToken": "…",
  "Expiration": "2026-06-15T07:30:00Z" }
```

## Flows

### Flow 1 — One-time setup (per developer, `/codepresso:setup`)
1. Relocate the long-lived key from `~/.aws/credentials [default]` → `[codepresso-source]` (no `[default]` static key remains).
2. `aws iam list-mfa-devices --profile codepresso-source` (allowed without MFA — in the policy NotAction). Found a virtual TOTP → store its ARN as `aws.mfaSerial`. Only a passkey / none → instruct the user to register a virtual TOTP first, then stop.
3. Write `~/.aws/config` `[default]` with `credential_process = node <plugin>/scripts/aws-cred-process.mjs` and `region`.
4. Write the `aws` config section and flip `aws.enabled = true`.
   Idempotent: re-running detects an existing setup and repairs rather than duplicating.

### Flow 2 — Normal call (session valid)
AWS call → chain resolves `[default]` → `credential_process` → `aws-cred-process.mjs` → cache valid → emits creds JSON → success. (SDK/CLI cache until `Expiration`, so the helper is not re-invoked every call.)

### Flow 3 — Reactive refresh (session missing/expired) — core loop
```
AWS call → cred-process exits non-zero (expired/missing) → call fails
  ├─ cloud-dev / our MCP : catch → returns "MFA_REQUIRED: run /codepresso:aws-login"
  └─ bash `aws …`        : PostToolUse hook detects the error output
                           (guard: only when the cache is actually invalid)
  → Claude runs /codepresso:aws-login:
       · confirm aws.mfaSerial
       · prompt "MFA 6-digit?"
       · node aws-cli.mjs refresh --token-code <code>
            → aws sts get-session-token --profile codepresso-source
                 --serial-number <mfaSerial> --token-code <code> --duration-seconds 3600
            → write cache atomically (chmod 600; no secret values printed)
  → Claude retries the original AWS call → cred-process returns valid creds → success
```

## Error handling / edge cases

| Case | Handling |
|---|---|
| Expiry判定 | Treat as expired when `now >= Expiration − 60s` (clock-skew margin). |
| Wrong 6-digit code | `get-session-token` returns AccessDenied/invalid → `aws-cli refresh` reports failure → skill re-prompts (max 2 retries) → then aborts with guidance. |
| No `mfaSerial` / passkey only | setup & refresh detect → instruct to register a virtual TOTP first; do not proceed. |
| Refresh from a temporary-credential session | `get-session-token` fails ("Cannot call GetSessionToken with session credentials") → message: run from a normal shell. |
| Concurrent refresh race | Cache written atomically (temp + rename). A single Claude conversation serializes prompts, so no file lock (YAGNI). |
| False-positive guard (bash) | Inject the refresh instruction only when (deny/expired signature) **AND** (cache missing/expired). Cache valid + denied → real authz error → pass through untouched. |
| Secret hygiene | Cache chmod 600; `aws-cli refresh` and `aws-cred-process` print only `Expiration`/"ok"; logs redact; no secret value ever returned or echoed. |
| Rollout safety | All reactive behavior + cred-process gated behind `aws.enabled`. Until setup flips it, plugin behavior is unchanged. |

Bash-hook detection signatures (CLI error strings, locale-stable English):
`CredentialsProviderError` / `credential_process` failure / `ExpiredToken` /
`TokenRefreshRequired` / `with an explicit deny` — each AND-ed with the
cache-invalid guard.

## Testing

`node:test` + `node:assert`, in `tests/lib/`, run via `node --test tests/lib/*.test.mjs`. **No real AWS calls in the suite.**

- **`aws-session.mjs`**: cache read/write roundtrip + atomic write; expiry boundary (`Expiration − 60s`: just-before = valid, just-after = expired); `list-mfa-devices` parse → TOTP ARN (passkey-only → null); STS `get-session-token` JSON → cache shape; redaction assertions (no secret in any return/log); detection classifiers (bash matcher + MCP classifier given error × cache-state).
- **`aws-cred-process.mjs`**: valid cache (path injected via env) → exact `{Version:1,…}` on stdout; expired/missing → non-zero exit, no secret on stdout.
- **`aws-cli.mjs`**: pure parts (arg parse, config read, building the `get-session-token` arg array); network call factored out so cache-write is tested with a fixture STS response.
- **Manual runbook (documented in the skill/spec)**: attach `deny-unless-MFA` → confirm bare-key denial → `/codepresso:aws-login` refresh → retry succeeds. Network/interactive parts kept thin; logic lives in tested pure functions.

## Open items / follow-ups
- Org-policy track (account-wide deny-unless-MFA for all 19 users, hygiene bot,
  orphaned-MFA cleanup) — separate spec.
- `aws-cli.mjs setup` may live inside the existing `setup` wizard rather than as a
  standalone command; confirm during planning.
