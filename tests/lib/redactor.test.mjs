import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from '../../scripts/lib/redactor.mjs';

describe('redactor.mjs', () => {
  describe('redactSecrets', () => {
    it('returns input unchanged when no secrets present', () => {
      const text = 'Fix the authentication bug in src/auth.ts';
      assert.equal(redactSecrets(text), text);
    });

    it('returns empty/null/undefined unchanged', () => {
      assert.equal(redactSecrets(''), '');
      assert.equal(redactSecrets(null), null);
      assert.equal(redactSecrets(undefined), undefined);
    });

    it('redacts Anthropic API keys', () => {
      const text = 'Use key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
      assert.ok(!redactSecrets(text).includes('sk-ant-'));
      assert.ok(redactSecrets(text).includes('[REDACTED_API_KEY]'));
    });

    it('redacts OpenAI API keys', () => {
      const text = 'key is sk-proj1234567890abcdefghij';
      assert.ok(!redactSecrets(text).includes('sk-proj'));
      assert.ok(redactSecrets(text).includes('[REDACTED_API_KEY]'));
    });

    it('redacts Notion tokens', () => {
      const text = 'notion token: ntn_abcdefghijklmnopqrstuvwxyz';
      assert.ok(!redactSecrets(text).includes('ntn_'));
      assert.ok(redactSecrets(text).includes('[REDACTED_NOTION_TOKEN]'));
    });

    it('redacts AWS access key IDs', () => {
      const text = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      assert.ok(!redactSecrets(text).includes('AKIAIOSFODNN7EXAMPLE'));
      assert.ok(redactSecrets(text).includes('[REDACTED_AWS_KEY]'));
    });

    it('redacts GitHub tokens', () => {
      const text = 'token: ghp_abcdefghijklmnopqrstuvwxyz1234';
      assert.ok(!redactSecrets(text).includes('ghp_'));
      assert.ok(redactSecrets(text).includes('[REDACTED_GITHUB_TOKEN]'));
    });

    it('redacts GitHub PAT tokens', () => {
      const text = 'github_pat_abcdefghijklmnopqrstuvwxyz1234';
      assert.ok(!redactSecrets(text).includes('github_pat_'));
      assert.ok(redactSecrets(text).includes('[REDACTED_GITHUB_TOKEN]'));
    });

    it('redacts Bearer tokens', () => {
      const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const result = redactSecrets(text);
      assert.ok(!result.includes('eyJ'));
      assert.ok(result.includes('Bearer'));
      assert.ok(result.includes('[REDACTED'));
    });

    it('redacts JWT tokens', () => {
      const text = 'jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.Gfx6VO9tcxwk6xqx9yYzSfebfeakGqoC_IgASdXtKrE';
      assert.ok(!redactSecrets(text).includes('eyJhbGci'));
    });

    it('redacts connection strings with passwords', () => {
      const text = 'DATABASE_URL=postgresql://user:supersecret@localhost:5432/mydb';
      const result = redactSecrets(text);
      assert.ok(!result.includes('supersecret'));
      assert.ok(result.includes('[REDACTED]'));
      assert.ok(result.includes('user:'));
    });

    it('redacts password fields', () => {
      const text = 'password: "my-secret-pass123"';
      const result = redactSecrets(text);
      assert.ok(!result.includes('my-secret-pass123'));
      assert.ok(result.includes('[REDACTED]'));
    });

    it('redacts api_key fields', () => {
      const text = 'api_key=abc123secretvalue';
      const result = redactSecrets(text);
      assert.ok(!result.includes('abc123secretvalue'));
    });

    it('does not redact short normal text', () => {
      const text = 'Fix the login bug and add tests';
      assert.equal(redactSecrets(text), text);
    });

    it('does not redact normal code references', () => {
      const text = 'Edit src/auth/middleware.ts line 42';
      assert.equal(redactSecrets(text), text);
    });

    it('handles extra user-defined patterns', () => {
      const text = 'internal-secret-abc123 should be hidden';
      const result = redactSecrets(text, ['internal-secret-[a-z0-9]+']);
      assert.ok(!result.includes('internal-secret-abc123'));
      assert.ok(result.includes('[REDACTED]'));
    });

    it('handles invalid extra patterns gracefully', () => {
      const text = 'some text';
      assert.equal(redactSecrets(text, ['[invalid']), text);
    });

    it('redacts multiple secrets in same text', () => {
      const text = 'Use ghp_abcdefghijklmnopqrstuvwxyz1234 with password: "secret123"';
      const result = redactSecrets(text);
      assert.ok(!result.includes('ghp_'));
      assert.ok(!result.includes('secret123'));
    });
  });
});
