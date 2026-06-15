import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandHome, isSessionValid, readCache, writeCache, parseStsSessionToken, parseMfaSerial, toCredentialProcessOutput, redact, shouldPromptMfa, isMfaCredentialError } from '../../scripts/lib/aws-session.mjs';

test('expandHome expands leading ~', () => {
  assert.ok(expandHome('~/x').endsWith('/x'));
  assert.ok(!expandHome('~/x').startsWith('~'));
  assert.strictEqual(expandHome('/abs/x'), '/abs/x');
});

test('isSessionValid honors expiry minus skew', () => {
  const exp = new Date(Date.now() + 120000).toISOString(); // +2 min
  assert.strictEqual(isSessionValid({ AccessKeyId: 'A', SecretAccessKey: 'S', SessionToken: 'T', Expiration: exp }), true);
  const soon = new Date(Date.now() + 30000).toISOString();  // +30s, inside 60s skew
  assert.strictEqual(isSessionValid({ AccessKeyId: 'A', SecretAccessKey: 'S', SessionToken: 'T', Expiration: soon }), false);
  assert.strictEqual(isSessionValid(null), false);
  assert.strictEqual(isSessionValid({ Expiration: 'nope' }), false);
  const future = new Date(Date.now() + 600000).toISOString();
  assert.strictEqual(isSessionValid({ AccessKeyId: 'A', Expiration: future }), false); // missing secret/session
  assert.strictEqual(isSessionValid({ AccessKeyId: 'A', SecretAccessKey: 'S', SessionToken: 'T', Expiration: future }), true);
});

test('writeCache writes atomically with 0600 and readCache roundtrips', () => {
  const dir = mkdtempSync(join(tmpdir(), 'awssess-'));
  const file = join(dir, 'aws-session.json');
  const cache = { AccessKeyId: 'A', SecretAccessKey: 'S', SessionToken: 'T', Expiration: '2030-01-01T00:00:00Z' };
  writeCache(file, cache);
  assert.deepStrictEqual(readCache(file), cache);
  assert.strictEqual(statSync(file).mode & 0o777, 0o600);
  assert.strictEqual(readCache(join(dir, 'missing.json')), null);
  rmSync(dir, { recursive: true, force: true });
});

test('parseStsSessionToken extracts credentials from STS JSON', () => {
  const sts = { Credentials: { AccessKeyId: 'ASIA', SecretAccessKey: 'sk', SessionToken: 'tok', Expiration: '2030-01-01T00:00:00Z' } };
  const c = parseStsSessionToken(sts);
  assert.strictEqual(c.AccessKeyId, 'ASIA');
  assert.throws(() => parseStsSessionToken({ Credentials: {} }), /Invalid/);
  assert.throws(() => parseStsSessionToken('{"bad":1}'), /Invalid/);
});

test('parseMfaSerial picks virtual TOTP (:mfa/), ignores passkey (:u2f/)', () => {
  const j = { MFADevices: [
    { SerialNumber: 'arn:aws:iam::1:u2f/user/x/passkey-AAA' },
    { SerialNumber: 'arn:aws:iam::1:mfa/maphone' },
  ] };
  assert.strictEqual(parseMfaSerial(j), 'arn:aws:iam::1:mfa/maphone');
  assert.strictEqual(parseMfaSerial({ MFADevices: [{ SerialNumber: 'arn:aws:iam::1:u2f/x' }] }), null);
  assert.strictEqual(parseMfaSerial({ MFADevices: [] }), null);
});

test('toCredentialProcessOutput emits AWS Version:1 shape', () => {
  const cache = { AccessKeyId: 'A', SecretAccessKey: 'S', SessionToken: 'T', Expiration: 'E' };
  assert.deepStrictEqual(toCredentialProcessOutput(cache), { Version: 1, AccessKeyId: 'A', SecretAccessKey: 'S', SessionToken: 'T', Expiration: 'E' });
});

test('redact masks secret-bearing keys', () => {
  const r = redact({ AccessKeyId: 'ASIAabcd1234', SecretAccessKey: 'supersecretvalue', Expiration: 'E' });
  assert.strictEqual(r.Expiration, 'E');
  assert.ok(!r.SecretAccessKey.includes('supersecretvalue'));
  assert.ok(r.SecretAccessKey.includes('REDACTED'));
  assert.strictEqual(r.AccessKeyId, 'ASIAabcd1234');
});

test('shouldPromptMfa only fires on signature AND invalid cache', () => {
  const deny = 'User: ... is not authorized ... with an explicit deny in an identity-based policy';
  assert.strictEqual(shouldPromptMfa(deny, { cacheValid: false }), true);
  assert.strictEqual(shouldPromptMfa(deny, { cacheValid: true }), false);   // real authz error, not MFA
  assert.strictEqual(shouldPromptMfa('ExpiredToken: token expired', { cacheValid: false }), true);
  assert.strictEqual(shouldPromptMfa('some unrelated output', { cacheValid: false }), false);
});

test('isMfaCredentialError matches credential/expiry/deny errors', () => {
  assert.strictEqual(isMfaCredentialError({ name: 'CredentialsProviderError', message: '' }), true);
  assert.strictEqual(isMfaCredentialError({ name: 'ExpiredTokenException', message: 'x' }), true);
  assert.strictEqual(isMfaCredentialError({ name: 'ValidationError', message: 'bad param' }), false);
});
