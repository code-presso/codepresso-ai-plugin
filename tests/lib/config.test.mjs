import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isExcluded, isSetupComplete, ensureSetup, loadConfig } from '../../scripts/lib/config.mjs';
import { existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

describe('config.mjs', () => {
  describe('isExcluded', () => {
    it('returns false for empty patterns array', () => {
      assert.strictEqual(isExcluded('/some-command', []), false);
    });

    it('returns false when prompt does not match any pattern', () => {
      const patterns = ['^/oh-my-claudecode:', '^(cancelomc|stopomc)$'];
      assert.strictEqual(isExcluded('/regular-command', patterns), false);
      assert.strictEqual(isExcluded('some text', patterns), false);
    });

    it('returns true when prompt matches a pattern', () => {
      const patterns = ['^/oh-my-claudecode:', '^(cancelomc|stopomc)$'];
      assert.strictEqual(isExcluded('/oh-my-claudecode:help', patterns), true);
      assert.strictEqual(isExcluded('/oh-my-claudecode:executor', patterns), true);
      assert.strictEqual(isExcluded('cancelomc', patterns), true);
      assert.strictEqual(isExcluded('stopomc', patterns), true);
    });

    it('handles invalid regex gracefully', () => {
      const patterns = ['[invalid(regex'];
      assert.strictEqual(isExcluded('test', patterns), false);
    });

    it('returns false for null/undefined patterns', () => {
      assert.strictEqual(isExcluded('test', null), false);
      assert.strictEqual(isExcluded('test', undefined), false);
    });

    it('supports complex regex patterns', () => {
      const patterns = ['^/skill:', '\\btest\\b'];
      assert.strictEqual(isExcluded('/skill:commit', patterns), true);
      assert.strictEqual(isExcluded('run test suite', patterns), true);
      assert.strictEqual(isExcluded('testing', patterns), false);
    });
  });

  describe('isSetupComplete', () => {
    it('returns false when global config does not exist', () => {
      assert.strictEqual(isSetupComplete('/tmp/nonexistent-codepresso-config.json'), false);
    });

    it('returns true when global config exists', () => {
      // package.json always exists in the project root — use it as a stand-in
      assert.strictEqual(isSetupComplete(fileURLToPath(new URL('../../package.json', import.meta.url))), true);
    });
  });

  describe('ensureSetup', () => {
    it('creates config file when it does not exist', () => {
      const dir = join(tmpdir(), `codepresso-test-${Date.now()}`);
      const configPath = join(dir, 'config.json');

      assert.strictEqual(existsSync(configPath), false);
      const result = ensureSetup(configPath);
      assert.strictEqual(result, true);
      assert.strictEqual(existsSync(configPath), true);

      // Cleanup
      unlinkSync(configPath);
      rmdirSync(dir);
    });

    it('returns true when config already exists', () => {
      // package.json always exists — use as stand-in
      const existing = fileURLToPath(new URL('../../package.json', import.meta.url));
      assert.strictEqual(ensureSetup(existing), true);
    });
  });

  describe('loadConfig', () => {
    it('returns default config structure when no files exist', () => {
      // Use a non-existent directory to ensure no config files are found
      const config = loadConfig('/tmp/nonexistent-codepresso-test-dir-12345', { globalConfigPath: '/tmp/nonexistent-global-codepresso-config.json' });

      assert.strictEqual(typeof config, 'object');
      assert.strictEqual(config.github.token, null);
      assert.strictEqual(config.prLogging.enabled, true);
      assert.strictEqual(config.prLogging.batchIntervalSeconds, 60);
      assert.strictEqual(config.scoring.enabled, true);
      assert.strictEqual(config.scoring.model, 'claude-haiku-4-5-20251001');
      assert.strictEqual(config.deploy.enabled, false);
      assert(Array.isArray(config.excludePatterns));
      assert.strictEqual(config.excludePatterns.length, 2);
    });

    it('returns Notion config defaults including user identity fields', () => {
      const config = loadConfig('/tmp/nonexistent-codepresso-test-dir-12345', { globalConfigPath: '/tmp/nonexistent-global-codepresso-config.json' });

      assert.strictEqual(config.notion.apiKey, null);
      assert.strictEqual(config.notion.defaultDatabaseId, null);
      assert.strictEqual(config.notion.userId, null);
      assert.strictEqual(config.notion.displayName, null);
      assert.strictEqual(config.notion.assigneeProperty, 'Assignee');
    });

    it('returns sprint workflow config defaults', () => {
      const config = loadConfig('/tmp/nonexistent-codepresso-test-dir-12345', { globalConfigPath: '/tmp/nonexistent-global-codepresso-config.json' });

      assert.strictEqual(config.notion.databases.sprint, null);
      assert.strictEqual(config.notion.databases.epic, null);
      assert.strictEqual(config.notion.databases.task, null);
      assert.strictEqual(config.notion.sprintWorkflow.enabled, false);
      assert.strictEqual(config.notion.sprintWorkflow.autoTransition, true);
      assert.strictEqual(config.notion.sprintWorkflow.epicAutoComplete, true);
    });

    it('returns epicDocs config defaults', () => {
      const config = loadConfig('/tmp/nonexistent-codepresso-test-dir-12345', { globalConfigPath: '/tmp/nonexistent-global-codepresso-config.json' });

      assert.strictEqual(config.epicDocs.enabled, true);
      assert.strictEqual(config.epicDocs.outputDir, 'docs/prd');
      assert.strictEqual(config.epicDocs.includeTaskDetails, true);
      assert(Array.isArray(config.epicDocs.customSections));
      assert.strictEqual(config.epicDocs.customSections.length, 0);
    });

    it('merges nested sections correctly', () => {
      // Test with current directory (may or may not have config)
      const config = loadConfig();

      // Verify structure integrity after merge
      assert(config.prLogging);
      assert(typeof config.prLogging.enabled === 'boolean');
      assert(typeof config.prLogging.batchIntervalSeconds === 'number');

      assert(config.scoring);
      assert(typeof config.scoring.enabled === 'boolean');
      assert(typeof config.scoring.model === 'string');

      assert(config.deploy);
      assert(typeof config.deploy.enabled === 'boolean');
    });

    it('preserves all default sections', () => {
      const config = loadConfig('/tmp/nonexistent-codepresso-test-dir-12345', { globalConfigPath: '/tmp/nonexistent-global-codepresso-config.json' });

      const expectedSections = ['github', 'notion', 'prLogging', 'scoring', 'deploy', 'epicDocs', 'excludePatterns'];
      for (const section of expectedSections) {
        assert(config.hasOwnProperty(section), `Missing section: ${section}`);
      }
    });

  });
});
