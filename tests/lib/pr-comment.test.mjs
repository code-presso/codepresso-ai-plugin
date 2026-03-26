import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendToBatch, flushIfReady, forceFlush, getSidecarPath, applyPrLabels } from '../../scripts/lib/pr-comment.mjs';

describe('pr-comment exports', () => {
  it('exports appendToBatch as a function', () => {
    assert.equal(typeof appendToBatch, 'function');
  });

  it('exports flushIfReady as a function', () => {
    assert.equal(typeof flushIfReady, 'function');
  });

  it('exports forceFlush as a function', () => {
    assert.equal(typeof forceFlush, 'function');
  });

  it('exports getSidecarPath as a function', () => {
    assert.equal(typeof getSidecarPath, 'function');
  });

  it('exports applyPrLabels as a function', () => {
    assert.equal(typeof applyPrLabels, 'function');
  });
});

describe('getSidecarPath()', () => {
  it('generates a slugified path for a branch name', () => {
    const path = getSidecarPath('feature/my-branch');
    assert.ok(path.includes('codepresso-prepr-'));
    assert.ok(path.endsWith('.jsonl'));
  });

  it('handles special characters in branch names', () => {
    const path = getSidecarPath('feat/UPPER_case.dots');
    assert.ok(path.includes('codepresso-prepr-'));
    assert.ok(!path.includes('/feat'));
  });

  it('truncates long branch names to 80 chars', () => {
    const longBranch = 'a'.repeat(120);
    const path = getSidecarPath(longBranch);
    const filename = path.split('/').pop();
    // prefix (17) + slug (80) + ext (6) = 103
    assert.ok(filename.length <= 103);
  });
});
