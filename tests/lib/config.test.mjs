import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isExcluded, loadConfig } from '../../scripts/lib/config.mjs';

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

      const expectedSections = ['github', 'notion', 'prLogging', 'scoring', 'deploy', 'qa', 'excludePatterns'];
      for (const section of expectedSections) {
        assert(config.hasOwnProperty(section), `Missing section: ${section}`);
      }
    });

    it('returns QA config defaults', () => {
      const config = loadConfig('/tmp/nonexistent-codepresso-test-dir-12345', { globalConfigPath: '/tmp/nonexistent-global-codepresso-config.json' });

      assert.strictEqual(config.qa.enabled, true);
      assert(Array.isArray(config.qa.dimensions));
      assert.strictEqual(config.qa.dimensions.length, 5);
      assert(config.qa.dimensions.includes('quality'));
      assert(config.qa.dimensions.includes('security'));
      assert(config.qa.dimensions.includes('testing'));
      assert(config.qa.dimensions.includes('documentation'));
      assert(config.qa.dimensions.includes('performance'));
      assert.strictEqual(config.qa.minScoreThreshold, 5);
      assert.strictEqual(config.qa.postToPr, true);
      assert.strictEqual(config.qa.model, 'claude-haiku-4-5-20251001');
    });
  });
});
