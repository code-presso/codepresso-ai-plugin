#!/usr/bin/env node
// Codepresso AWS MFA session CLI. Commands: status | detect-mfa | refresh | setup
import { execFileSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';
import { getSessionFile, readCache, isSessionValid, parseMfaSerial, parseStsSessionToken, writeCache, redact } from './lib/aws-session.mjs';

function awsJson(args) {
  return JSON.parse(execFileSync('aws', [...args, '--output', 'json'], { encoding: 'utf-8' }));
}

function cmdStatus() {
  const cfg = loadConfig();
  const cache = readCache(getSessionFile(cfg));
  const valid = isSessionValid(cache);
  console.log(JSON.stringify({
    enabled: !!cfg.aws?.enabled,
    sourceProfile: cfg.aws?.sourceProfile,
    mfaSerial: cfg.aws?.mfaSerial,
    sessionValid: valid,
    expiration: cache?.Expiration || null,
  }));
}

function cmdDetectMfa() {
  const cfg = loadConfig();
  const profile = cfg.aws?.sourceProfile || 'codepresso-source';
  const out = awsJson(['iam', 'list-mfa-devices', '--profile', profile]);
  const serial = parseMfaSerial(out);
  console.log(JSON.stringify({ mfaSerial: serial }));
}

function cmdRefresh() {
  const cfg = loadConfig();
  const aws = cfg.aws || {};
  if (!aws.mfaSerial) {
    console.error(JSON.stringify({ ok: false, error: 'NO_MFA_SERIAL', hint: 'Register a virtual TOTP, then run: aws-cli detect-mfa' }));
    process.exit(1);
  }
  const i = process.argv.indexOf('--token-code');
  const code = i >= 0 ? process.argv[i + 1] : null;
  if (!code || !/^\d{6}$/.test(code)) {
    console.error(JSON.stringify({ ok: false, error: 'BAD_CODE', hint: 'Pass --token-code <6 digits>' }));
    process.exit(1);
  }
  try {
    const sts = awsJson([
      'sts', 'get-session-token',
      '--profile', aws.sourceProfile || 'codepresso-source',
      '--serial-number', aws.mfaSerial,
      '--token-code', code,
      '--duration-seconds', String(aws.sessionTtlSeconds || 3600),
    ]);
    const cache = parseStsSessionToken(sts);
    writeCache(getSessionFile(cfg), cache);
    console.log(JSON.stringify({ ok: true, expiration: cache.Expiration, redacted: redact(cache) }));
  } catch (e) {
    const msg = String(e.stderr || e.message || '');
    let error = 'REFRESH_FAILED';
    if (/session credentials/i.test(msg)) error = 'TEMP_SESSION';      // running inside temp creds
    else if (/AccessDenied|MultiFactorAuthentication|invalid.*token|not authorized/i.test(msg)) error = 'BAD_OR_DENIED_CODE';
    console.error(JSON.stringify({ ok: false, error, hint: error === 'TEMP_SESSION' ? 'Run from a normal shell (not inside temp credentials).' : 'Check the 6-digit code and retry.' }));
    process.exit(1);
  }
}

const cmd = process.argv[2];
const handlers = { status: cmdStatus, 'detect-mfa': cmdDetectMfa, refresh: cmdRefresh };
if (!handlers[cmd]) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
handlers[cmd]();
