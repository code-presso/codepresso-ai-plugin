#!/usr/bin/env node

/**
 * Detached process: score prompts via Haiku, then post formatted PR comment.
 * Receives JSON payload via argv[2] (file path to temp JSON).
 */

import { readFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { scorePrompts } from './lib/prompt-scorer.mjs';
import { recordFlush } from './lib/analytics.mjs';

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

  const { entries, meta, prNumber, scoringEnabled, scoringModel } = payload;

  let scores = entries.map(() => null);
  if (scoringEnabled !== false) {
    try {
      scores = await scorePrompts(entries.map(e => e.prompt), scoringModel);
    } catch {
      // Scoring failed, continue without scores
    }
  }

  // Record analytics (silent — never block comment posting)
  try {
    recordFlush({
      sessionId: meta.sessionId,
      branch: meta.branch,
      prNumber,
      scores,
      promptCount: entries.length,
    });
  } catch {
    // Analytics failure must never block PR comment
  }

  // Format comment
  const sessionLabel = meta.sessionId ? meta.sessionId.slice(0, 8) : 'unknown';
  const hasScores = scores.some(s => s !== null);

  const header = hasScores
    ? '| Time (UTC) | Score | Prompt |'
    : '| Time (UTC) | Prompt |';
  const divider = hasScores
    ? '|------------|-------|--------|'
    : '|------------|--------|';

  const rows = entries.map((e, i) => {
    const time = new Date(e.timestamp).toISOString().split('T')[1].replace('Z', '').slice(0, 8);
    const prompt = e.prompt.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const score = scores[i];
    const scoreStr = score !== null ? scoreEmoji(score) : '-';

    if (hasScores) {
      return `| ${time} | ${scoreStr} | ${prompt} |`;
    }
    return `| ${time} | ${prompt} |`;
  });

  // Calculate average score
  const validScores = scores.filter(s => s !== null);
  const avgLine = validScores.length > 0
    ? `\n**Avg Score:** ${(validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1)}/10`
    : '';

  const body = [
    '### :robot: Claude Code Activity Log',
    '',
    `**Session:** \`${sessionLabel}\` | **Branch:** \`${meta.branch}\`${avgLine}`,
    '',
    header,
    divider,
    ...rows,
    '',
    '---',
    '<sub>Logged by Codepresso</sub>',
  ].join('\n');

  // Post to PR
  try {
    execSync(`gh pr comment ${prNumber} --body ${JSON.stringify(body)}`, {
      cwd: meta.cwd || process.cwd(),
      timeout: 30000,
      stdio: 'ignore',
    });
  } catch {
    // Silent failure
  }
}

function scoreEmoji(score) {
  if (score >= 8) return `**${score}** ⭐`;
  if (score >= 5) return `**${score}** ✅`;
  if (score >= 3) return `**${score}** ⚠️`;
  return `**${score}** ❌`;
}

main();
