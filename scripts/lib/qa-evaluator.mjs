/**
 * QA evaluator: scores code changes across 5 quality dimensions.
 * Uses Anthropic API (same pattern as prompt-scorer.mjs).
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const DIMENSION_DESCRIPTIONS = {
  quality: 'Code quality: readability, naming conventions, structure, error handling, code smells',
  security: 'Security: injection vulnerabilities, auth issues, exposed secrets, input validation, dependency risks',
  testing: 'Testing: untested logic paths, missing edge cases, assertion quality, test coverage gaps',
  documentation: 'Documentation: JSDoc/comments, README updates needed, undocumented APIs or complex logic',
  performance: 'Performance: N+1 queries, memory leaks, blocking operations, unnecessary allocations',
};

/**
 * Build the evaluation prompt for the Anthropic API.
 * @param {string} diff - The git diff to evaluate
 * @param {string[]} dimensions - Dimensions to evaluate
 * @returns {string} The prompt text
 */
export function buildQaPrompt(diff, dimensions) {
  const dimList = dimensions
    .map((d) => `- **${d}**: ${DIMENSION_DESCRIPTIONS[d] || d}`)
    .join('\n');

  return `You are a senior code reviewer. Evaluate the following code diff across these quality dimensions:

${dimList}

For each dimension, provide:
1. A score from 0 to 10 (0 = critical issues, 5 = acceptable, 10 = excellent)
2. Up to 3 specific findings (issues or positive observations)

Also provide an overall score (weighted average of all dimensions).

Respond with ONLY valid JSON in this exact format:
{
  "overallScore": 7,
  "dimensions": {
    "quality": { "score": 8, "findings": ["Good error handling", "Consider renaming X"] },
    "security": { "score": 6, "findings": ["Input not validated in handler Y"] }
  }
}

No markdown fences, no explanation outside the JSON.

DIFF:
${diff}`;
}

/**
 * Parse the QA response from the API.
 * @param {string} text - Raw API response text
 * @param {string[]} dimensions - Expected dimensions
 * @returns {{ overallScore: number, dimensions: Record<string, { score: number, findings: string[] }> }}
 */
export function parseQaResponse(text, dimensions) {
  // Strip markdown fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to extract JSON from the text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        // Return default scores on parse failure
        return buildDefaultReport(dimensions);
      }
    } else {
      return buildDefaultReport(dimensions);
    }
  }

  // Normalize overallScore
  let overallScore = typeof parsed.overallScore === 'number' ? parsed.overallScore : null;
  if (overallScore !== null) {
    overallScore = Math.max(0, Math.min(10, Math.round(overallScore * 10) / 10));
  }

  // Normalize dimension scores
  const dimResults = {};
  for (const dim of dimensions) {
    const dimData = parsed.dimensions?.[dim];
    if (dimData && typeof dimData.score === 'number') {
      const score = Math.max(0, Math.min(10, Math.round(dimData.score * 10) / 10));
      let findings = Array.isArray(dimData.findings) ? dimData.findings : [];
      // Cap findings at 10
      findings = findings.slice(0, 10).map((f) => String(f));
      dimResults[dim] = { score, findings };
    } else {
      dimResults[dim] = { score: null, findings: [] };
    }
  }

  // If overallScore is missing, compute from dimension scores
  if (overallScore === null) {
    const validScores = Object.values(dimResults)
      .map((d) => d.score)
      .filter((s) => s !== null);
    overallScore =
      validScores.length > 0
        ? Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 10) / 10
        : null;
  }

  return { overallScore, dimensions: dimResults };
}

/**
 * Call Anthropic API to evaluate the diff.
 * @param {string} diff - The git diff
 * @param {string[]} dimensions - Dimensions to evaluate
 * @param {string} [model] - Model to use
 * @returns {Promise<{ overallScore: number, dimensions: Record<string, { score: number, findings: string[] }> }|null>}
 */
export async function evaluateQa(diff, dimensions, model = DEFAULT_MODEL) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !diff) return null;

  const prompt = buildQaPrompt(diff, dimensions);

  try {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) return null;

    const data = await resp.json();
    const text = data?.content?.[0]?.text || '';
    if (!text) return null;

    return parseQaResponse(text, dimensions);
  } catch {
    return null;
  }
}

/**
 * Format QA report as a markdown PR comment.
 * @param {{ overallScore: number, dimensions: Record<string, { score: number, findings: string[] }> }} report
 * @param {{ sessionId?: string, branch?: string, filesChanged?: number, linesAdded?: number, linesRemoved?: number }} meta
 * @returns {string}
 */
export function formatQaComment(report, meta = {}) {
  const sessionLabel = meta.sessionId ? meta.sessionId.slice(0, 8) : 'unknown';
  const overall = report.overallScore !== null ? `${report.overallScore}/10 ${tierEmoji(report.overallScore)}` : 'N/A';

  const lines = [
    '### :mag: Codepresso QA Report',
    '',
    `**Session:** \`${sessionLabel}\` | **Branch:** \`${meta.branch || 'unknown'}\` | **Overall:** ${overall}`,
  ];

  if (meta.filesChanged != null) {
    lines.push(`**Changes:** ${meta.filesChanged} files, +${meta.linesAdded || 0}/-${meta.linesRemoved || 0} lines`);
  }

  lines.push('');

  // Dimension table
  lines.push('| Dimension | Score | Findings |');
  lines.push('|-----------|-------|----------|');

  for (const [dim, data] of Object.entries(report.dimensions)) {
    const scoreStr = data.score !== null ? `${data.score}/10 ${tierEmoji(data.score)}` : 'N/A';
    const findingsStr = data.findings.length > 0
      ? data.findings.map((f) => f.replace(/\|/g, '\\|')).join('; ')
      : 'No issues found';
    lines.push(`| ${capitalize(dim)} | ${scoreStr} | ${findingsStr} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('<sub>QA report by Codepresso</sub>');

  return lines.join('\n');
}

/**
 * Build a default report when parsing fails.
 * @param {string[]} dimensions
 * @returns {{ overallScore: number|null, dimensions: Record<string, { score: number|null, findings: string[] }> }}
 */
function buildDefaultReport(dimensions) {
  const dimResults = {};
  for (const dim of dimensions) {
    dimResults[dim] = { score: null, findings: [] };
  }
  return { overallScore: null, dimensions: dimResults };
}

function tierEmoji(score) {
  if (score >= 8) return '\u2B50';
  if (score >= 5) return '\u2705';
  if (score >= 3) return '\u26A0\uFE0F';
  return '\u274C';
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
