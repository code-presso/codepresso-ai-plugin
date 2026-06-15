#!/usr/bin/env node
// Codepresso AWS MFA session CLI. Commands: status | detect-mfa | refresh | setup
import { execFileSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';
import { getSessionFile, readCache, isSessionValid, parseMfaSerial } from './lib/aws-session.mjs';

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

const cmd = process.argv[2];
const handlers = { status: cmdStatus, 'detect-mfa': cmdDetectMfa };
if (!handlers[cmd]) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
handlers[cmd]();
