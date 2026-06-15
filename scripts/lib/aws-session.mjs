/**
 * aws-session.mjs — pure helpers for AWS MFA session management.
 * No side-effects beyond file I/O. No network calls.
 */

import { readFileSync, writeFileSync, chmodSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Task 2: path / expiry / cache / getSessionFile
// ---------------------------------------------------------------------------

const EXPIRY_SKEW_MS = 60_000; // treat sessions expiring within 60s as invalid

export function expandHome(p) {
  if (typeof p === 'string' && p.startsWith('~/')) {
    return homedir() + p.slice(1);
  }
  return p;
}

export function getSessionFile(cfg) {
  return expandHome((cfg && cfg.aws && cfg.aws.sessionFile) || '~/.codepresso/aws-session.json');
}

export function isSessionValid(cache) {
  if (!cache || !cache.AccessKeyId || !cache.Expiration) return false;
  const exp = new Date(cache.Expiration).getTime();
  if (isNaN(exp)) return false;
  return exp - Date.now() > EXPIRY_SKEW_MS;
}

export function readCache(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeCache(file, cache) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

// ---------------------------------------------------------------------------
// Task 3: STS/MFA parsing, cred-process output, redaction
// ---------------------------------------------------------------------------

export function parseStsSessionToken(input) {
  const obj = typeof input === 'string' ? JSON.parse(input) : input;
  const c = obj && obj.Credentials;
  if (!c || !c.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration) {
    throw new Error('Invalid get-session-token output');
  }
  return { AccessKeyId: c.AccessKeyId, SecretAccessKey: c.SecretAccessKey, SessionToken: c.SessionToken, Expiration: c.Expiration };
}

export function parseMfaSerial(input) {
  const obj = typeof input === 'string' ? JSON.parse(input) : input;
  const devices = (obj && obj.MFADevices) || [];
  const totp = devices.find((d) => typeof d.SerialNumber === 'string' && d.SerialNumber.includes(':mfa/'));
  return totp ? totp.SerialNumber : null;
}

export function toCredentialProcessOutput(cache) {
  return {
    Version: 1,
    AccessKeyId: cache.AccessKeyId,
    SecretAccessKey: cache.SecretAccessKey,
    SessionToken: cache.SessionToken,
    Expiration: cache.Expiration,
  };
}

const SECRET_KEY = /SecretAccessKey|SessionToken|AccessKeyId|aws_secret|aws_access_key|token/i;
export function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY.test(k) && typeof v === 'string') {
      out[k] = v.length <= 4 ? '****' : `${v.slice(0, 4)}…REDACTED…`;
    } else if (v && typeof v === 'object') {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Task 4: reactive MFA detection classifiers
// ---------------------------------------------------------------------------

export const MFA_SIGNATURES = /CredentialsProviderError|credential_process|ExpiredToken|TokenRefreshRequired|with an explicit deny/i;

export function shouldPromptMfa(output, { cacheValid }) {
  if (cacheValid) return false;
  return MFA_SIGNATURES.test(String(output || ''));
}

export function isMfaCredentialError(error) {
  const text = `${(error && error.name) || ''} ${(error && error.message) || ''}`;
  return /CredentialsProviderError|ExpiredToken|ExpiredTokenException|TokenRefreshRequired|InvalidClientTokenId|UnrecognizedClient|with an explicit deny|AccessDenied/i.test(text);
}
