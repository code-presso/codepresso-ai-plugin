#!/usr/bin/env node

/**
 * Detached process: evaluate code quality via Haiku, record analytics, post PR comment.
 * Receives JSON payload via argv[2] (file path to temp JSON).
 * Follows same pattern as score-and-post.mjs.
 */

import { readFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { getSessionDiff } from './lib/git-utils.mjs';
import { evaluateQa, formatQaComment } from './lib/qa-evaluator.mjs';
import { recordQaReport } from './lib/analytics.mjs';

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) process.exit(1);

  let payload;
  try {
    payload = JSON.parse(readFileSync(payloadPath, 'utf-8'));
    // Clean up temp file
    try { unlinkSync(payloadPath); } catch {}
  } catch {
    process.exit(1);
  }

  const { sessionId, branch, prNumber, headCommit, dimensions, model, postToPr, paths, cwd } = payload;

  // Get diff since session start (optionally scoped to paths for monorepos)
  const diffResult = getSessionDiff(headCommit, cwd || process.cwd(), paths || []);
  if (!diffResult || !diffResult.diff) {
    // No changes — nothing to evaluate
    process.exit(0);
  }

  // Evaluate via Anthropic API
  const report = await evaluateQa(diffResult.diff, dimensions, model);
  if (!report) {
    // API failure — exit silently
    process.exit(0);
  }

  // Record analytics
  try {
    const dimensionScores = {};
    for (const [dim, data] of Object.entries(report.dimensions)) {
      dimensionScores[dim] = data.score;
    }
    recordQaReport({
      sessionId,
      branch,
      prNumber,
      overallScore: report.overallScore,
      dimensionScores,
      filesChanged: diffResult.filesChanged,
      linesAdded: diffResult.linesAdded,
      linesRemoved: diffResult.linesRemoved,
    });
  } catch {
    // Analytics failure must never block PR comment
  }

  // Post PR comment (if enabled and PR exists)
  if (postToPr && prNumber) {
    const comment = formatQaComment(report, {
      sessionId,
      branch,
      filesChanged: diffResult.filesChanged,
      linesAdded: diffResult.linesAdded,
      linesRemoved: diffResult.linesRemoved,
    });

    try {
      execSync(`gh pr comment ${prNumber} --body ${JSON.stringify(comment)}`, {
        cwd: cwd || process.cwd(),
        timeout: 30000,
        stdio: 'ignore',
      });
    } catch {
      // Silent failure
    }
  }
}

main();
