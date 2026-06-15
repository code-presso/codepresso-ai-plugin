import { test } from 'node:test';
import assert from 'node:assert';
import { renameSection, upsertSectionKV } from '../../scripts/lib/aws-ini.mjs';

test('renameSection renames header, refuses if target exists', () => {
  const ini = '[default]\naws_access_key_id = AKIA\n';
  assert.strictEqual(renameSection(ini, 'default', 'codepresso-source'), '[codepresso-source]\naws_access_key_id = AKIA\n');
  const both = '[default]\nx = 1\n[codepresso-source]\ny = 2\n';
  assert.strictEqual(renameSection(both, 'default', 'codepresso-source'), both); // no clobber
});

test('upsertSectionKV inserts a new key into an existing section without duplicating it', () => {
  const ini = '[default]\nregion = ap-northeast-2\n';
  const out = upsertSectionKV(ini, 'default', { credential_process: 'node /x.mjs' });
  assert.ok(out.includes('credential_process = node /x.mjs'));
  assert.ok(out.includes('region = ap-northeast-2'));
  assert.strictEqual((out.match(/\[default\]/g) || []).length, 1);
});

test('upsertSectionKV creates section and updates keys in place', () => {
  let out = upsertSectionKV('', 'default', { credential_process: 'node /p/x.mjs', region: 'ap-northeast-2' });
  assert.ok(out.includes('[default]'));
  assert.ok(out.includes('credential_process = node /p/x.mjs'));
  out = upsertSectionKV(out, 'default', { region: 'us-east-1' });   // update existing key
  assert.ok(out.includes('region = us-east-1'));
  assert.ok(!out.includes('region = ap-northeast-2'));
  assert.strictEqual((out.match(/\[default\]/g) || []).length, 1);  // no duplicate section
});
