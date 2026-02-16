import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildQaPrompt, parseQaResponse, formatQaComment } from '../../scripts/lib/qa-evaluator.mjs';

const ALL_DIMS = ['quality', 'security', 'testing', 'documentation', 'performance'];

describe('qa-evaluator.mjs', () => {
  describe('parseQaResponse', () => {
    it('parses valid JSON response', () => {
      const text = JSON.stringify({
        overallScore: 7.5,
        dimensions: {
          quality: { score: 8, findings: ['Good structure'] },
          security: { score: 7, findings: ['Input validated'] },
          testing: { score: 6, findings: ['Missing edge cases'] },
          documentation: { score: 7, findings: [] },
          performance: { score: 9, findings: ['No issues'] },
        },
      });

      const result = parseQaResponse(text, ALL_DIMS);
      assert.strictEqual(result.overallScore, 7.5);
      assert.strictEqual(result.dimensions.quality.score, 8);
      assert.strictEqual(result.dimensions.security.score, 7);
      assert.deepStrictEqual(result.dimensions.quality.findings, ['Good structure']);
    });

    it('handles invalid JSON gracefully', () => {
      const result = parseQaResponse('not json at all', ALL_DIMS);
      assert.strictEqual(result.overallScore, null);
      for (const dim of ALL_DIMS) {
        assert.strictEqual(result.dimensions[dim].score, null);
        assert.deepStrictEqual(result.dimensions[dim].findings, []);
      }
    });

    it('strips markdown fences', () => {
      const json = JSON.stringify({
        overallScore: 6,
        dimensions: {
          quality: { score: 6, findings: [] },
          security: { score: 6, findings: [] },
          testing: { score: 6, findings: [] },
          documentation: { score: 6, findings: [] },
          performance: { score: 6, findings: [] },
        },
      });
      const text = '```json\n' + json + '\n```';

      const result = parseQaResponse(text, ALL_DIMS);
      assert.strictEqual(result.overallScore, 6);
      assert.strictEqual(result.dimensions.quality.score, 6);
    });

    it('clamps scores to 0-10 range', () => {
      const text = JSON.stringify({
        overallScore: 15,
        dimensions: {
          quality: { score: -3, findings: [] },
          security: { score: 12, findings: [] },
          testing: { score: 5, findings: [] },
          documentation: { score: 5, findings: [] },
          performance: { score: 5, findings: [] },
        },
      });

      const result = parseQaResponse(text, ALL_DIMS);
      assert.strictEqual(result.overallScore, 10);
      assert.strictEqual(result.dimensions.quality.score, 0);
      assert.strictEqual(result.dimensions.security.score, 10);
    });

    it('handles missing dimensions', () => {
      const text = JSON.stringify({
        overallScore: 7,
        dimensions: {
          quality: { score: 8, findings: ['Good'] },
          // missing: security, testing, documentation, performance
        },
      });

      const result = parseQaResponse(text, ALL_DIMS);
      assert.strictEqual(result.dimensions.quality.score, 8);
      assert.strictEqual(result.dimensions.security.score, null);
      assert.strictEqual(result.dimensions.testing.score, null);
    });

    it('caps findings at 10 items', () => {
      const findings = Array.from({ length: 15 }, (_, i) => `Finding ${i + 1}`);
      const text = JSON.stringify({
        overallScore: 5,
        dimensions: {
          quality: { score: 5, findings },
          security: { score: 5, findings: [] },
          testing: { score: 5, findings: [] },
          documentation: { score: 5, findings: [] },
          performance: { score: 5, findings: [] },
        },
      });

      const result = parseQaResponse(text, ALL_DIMS);
      assert.strictEqual(result.dimensions.quality.findings.length, 10);
      assert.strictEqual(result.dimensions.quality.findings[0], 'Finding 1');
      assert.strictEqual(result.dimensions.quality.findings[9], 'Finding 10');
    });

    it('computes overallScore from dimensions when missing', () => {
      const text = JSON.stringify({
        dimensions: {
          quality: { score: 8, findings: [] },
          security: { score: 6, findings: [] },
          testing: { score: 4, findings: [] },
          documentation: { score: 6, findings: [] },
          performance: { score: 6, findings: [] },
        },
      });

      const result = parseQaResponse(text, ALL_DIMS);
      // (8 + 6 + 4 + 6 + 6) / 5 = 6.0
      assert.strictEqual(result.overallScore, 6);
    });

    it('extracts JSON from surrounding text', () => {
      const text = 'Here is my analysis:\n' + JSON.stringify({
        overallScore: 7,
        dimensions: {
          quality: { score: 7, findings: ['OK'] },
          security: { score: 7, findings: [] },
          testing: { score: 7, findings: [] },
          documentation: { score: 7, findings: [] },
          performance: { score: 7, findings: [] },
        },
      }) + '\nThat is my report.';

      const result = parseQaResponse(text, ALL_DIMS);
      assert.strictEqual(result.overallScore, 7);
    });
  });

  describe('buildQaPrompt', () => {
    it('includes all specified dimensions', () => {
      const prompt = buildQaPrompt('+ const x = 1;', ALL_DIMS);
      for (const dim of ALL_DIMS) {
        assert(prompt.includes(dim), `Prompt should include dimension "${dim}"`);
      }
    });

    it('includes the diff content', () => {
      const diff = '+ const myVar = "hello";\n- const old = "bye";';
      const prompt = buildQaPrompt(diff, ['quality']);
      assert(prompt.includes('myVar'), 'Prompt should include the diff content');
      assert(prompt.includes('old'), 'Prompt should include the diff content');
    });

    it('requests JSON format', () => {
      const prompt = buildQaPrompt('+ x', ['quality']);
      assert(prompt.includes('JSON'), 'Prompt should request JSON format');
    });
  });

  describe('formatQaComment', () => {
    it('formats a complete report', () => {
      const report = {
        overallScore: 7.2,
        dimensions: {
          quality: { score: 8, findings: ['Good structure'] },
          security: { score: 6, findings: ['Missing validation'] },
        },
      };
      const meta = {
        sessionId: 'abc12345-6789',
        branch: 'feature/test',
        filesChanged: 3,
        linesAdded: 50,
        linesRemoved: 10,
      };

      const comment = formatQaComment(report, meta);
      assert(comment.includes('QA Report'), 'Should include QA Report header');
      assert(comment.includes('abc12345'), 'Should include session ID prefix');
      assert(comment.includes('feature/test'), 'Should include branch');
      assert(comment.includes('7.2/10'), 'Should include overall score');
      assert(comment.includes('3 files'), 'Should include files changed');
      assert(comment.includes('+50/-10'), 'Should include line counts');
      assert(comment.includes('Quality'), 'Should include dimension name');
      assert(comment.includes('Good structure'), 'Should include findings');
      assert(comment.includes('Missing validation'), 'Should include findings');
    });

    it('handles null scores gracefully', () => {
      const report = {
        overallScore: null,
        dimensions: {
          quality: { score: null, findings: [] },
        },
      };

      const comment = formatQaComment(report, {});
      assert(comment.includes('N/A'), 'Should show N/A for null scores');
      assert(comment.includes('unknown'), 'Should show unknown for missing session');
    });
  });
});
