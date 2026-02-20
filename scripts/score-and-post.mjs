#!/usr/bin/env node

/**
 * Detached process: score prompts via Haiku, then post formatted PR comment.
 * Receives JSON payload via argv[2] (file path to temp JSON).
 */

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { scorePrompts } from './lib/prompt-scorer.mjs';
import { recordFlush } from './lib/analytics.mjs';

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) process.exit(1);

  let payload;
  try {
    payload = JSON.parse(readFileSync(payloadPath, 'utf-8'));
    try { unlinkSync(payloadPath); } catch {}
  } catch {
    process.exit(1);
  }

  const { entries, meta, prNumber, scoringEnabled, scoringModel, scoringBackend, scoringAwsRegion } = payload;

  let scores = entries.map(() => null);
  if (scoringEnabled !== false) {
    try {
      scores = await scorePrompts(
        entries.map(e => e.prompt),
        scoringModel,
        { backend: scoringBackend, awsRegion: scoringAwsRegion },
      );
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

  const body = formatComment(entries, scores, meta, scoringBackend);

  // Post to PR via temp file (avoids shell escaping issues with backticks)
  const bodyFile = join(meta.cwd || process.cwd(), '.omc', 'state', `codepresso-comment-${Date.now()}.md`);
  try {
    writeFileSync(bodyFile, body, 'utf-8');
    execSync(`gh pr comment ${prNumber} --body-file "${bodyFile}"`, {
      cwd: meta.cwd || process.cwd(),
      timeout: 30000,
      stdio: 'ignore',
    });
  } catch {
    // Silent failure
  } finally {
    try { unlinkSync(bodyFile); } catch {}
  }
}

function formatComment(entries, scores, meta, backend) {
  const sessionLabel = meta.sessionId ? meta.sessionId.slice(0, 8) : 'unknown';
  const hasScores = scores.some(s => s !== null);
  const validScores = scores.filter(s => s !== null);
  const avg = validScores.length > 0
    ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1)
    : null;

  // Header
  const lines = [
    '## :coffee: Codepresso Activity Log',
    '',
  ];

  // Meta line
  const metaParts = [];
  if (meta.branch) metaParts.push(`**Branch:** \`${meta.branch}\``);
  if (sessionLabel) metaParts.push(`**Session:** \`${sessionLabel}\``);
  if (avg !== null) metaParts.push(`**Avg Score:** ${scoreBar(parseFloat(avg))} ${avg}/10`);
  lines.push(`> ${metaParts.join(' · ')}`, '');

  // Prompt table
  if (hasScores) {
    lines.push('| # | Time | Score | Prompt |');
    lines.push('|--:|------|------:|--------|');
  } else {
    lines.push('| # | Time | Prompt |');
    lines.push('|--:|------|--------|');
  }

  entries.forEach((e, i) => {
    const num = i + 1;
    const time = new Date(e.timestamp).toISOString().split('T')[1].slice(0, 5);
    const prompt = e.prompt.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const score = scores[i];

    if (hasScores) {
      const scoreStr = score !== null ? `${scoreIcon(score)} **${score}**` : '—';
      lines.push(`| ${num} | ${time} | ${scoreStr} | ${prompt} |`);
    } else {
      lines.push(`| ${num} | ${time} | ${prompt} |`);
    }
  });

  // Tips for low-scoring prompts
  const lowScoreEntries = entries
    .map((e, i) => ({ prompt: e.prompt, score: scores[i], index: i + 1 }))
    .filter(e => e.score !== null && e.score < 5);

  if (lowScoreEntries.length > 0) {
    lines.push('');
    lines.push('<details>');
    lines.push('<summary>:bulb: Tips for improving low-scoring prompts</summary>');
    lines.push('');

    for (const entry of lowScoreEntries) {
      const tip = scoreTip(entry.score);
      lines.push(`**#${entry.index}** (${entry.score}/10): _"${truncate(entry.prompt, 60)}"_`);
      lines.push(`> ${tip}`);
      lines.push('');
    }

    lines.push('**Good prompts include:** the specific change, target file/function, and expected behavior.');
    lines.push('');
    lines.push('</details>');
  }

  // Footer
  const backendLabel = backend === 'bedrock' ? 'AWS Bedrock' : 'Anthropic API';
  lines.push('');
  lines.push('---');
  lines.push(`<sub>:coffee: Codepresso · Scored via ${backendLabel}</sub>`);

  return lines.join('\n');
}

function scoreIcon(score) {
  if (score >= 8) return ':star:';
  if (score >= 5) return ':white_check_mark:';
  if (score >= 3) return ':warning:';
  return ':x:';
}

function scoreBar(avg) {
  const filled = Math.round(avg / 2);   // 0-5 blocks
  return ':green_square:'.repeat(filled) + ':white_large_square:'.repeat(5 - filled);
}

function scoreTip(score) {
  if (score <= 2) {
    return 'Too vague — specify **what** to change, **where** (file/function), and the **expected outcome**.';
  }
  return 'Add more context — mention the **target file or function** and **acceptance criteria**.';
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max) + '...';
}

main();
