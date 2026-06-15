#!/usr/bin/env node
// AWS credential_process entry. Emits cached MFA session creds, or exits 1.
import { loadConfig } from './lib/config.mjs';
import { getSessionFile, readCache, isSessionValid, toCredentialProcessOutput } from './lib/aws-session.mjs';

function main() {
  const file = process.env.AWS_CRED_PROCESS_SESSION_FILE || getSessionFile(loadConfig());
  const cache = readCache(file);
  if (!isSessionValid(cache)) {
    process.stderr.write('codepresso: no valid AWS MFA session — run /codepresso:aws-login\n');
    process.exit(1);
  }
  // isSessionValid guarantees AccessKeyId/SecretAccessKey/SessionToken/Expiration are present
  process.stdout.write(JSON.stringify(toCredentialProcessOutput(cache)) + '\n');
}

main();
