/**
 * Score prompts 0-10 using Anthropic Haiku.
 * Supports two backends: direct Anthropic API or AWS Bedrock.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/** Map Anthropic model ID to Bedrock model ID */
function toBedrockModelId(model) {
  // If already a Bedrock ARN or full inference profile ID, return as-is
  if (model.startsWith('arn:') || model.includes('.anthropic.')) return model;
  // Convert e.g. "claude-haiku-4-5-20251001" → "us.anthropic.claude-haiku-4-5-20251001-v1:0"
  // Uses cross-region inference profile format required for on-demand throughput
  return `us.anthropic.${model}-v1:0`;
}

function buildPrompt(prompts) {
  const numbered = prompts.map((p, i) => `${i + 1}. ${p}`).join('\n');
  return `Rate each prompt below on a 0-10 scale for clarity and specificity as a software engineering instruction.

0 = meaningless/noise (e.g. "ok", "hmm")
3 = vague (e.g. "fix it", "make it better")
5 = decent but could be clearer
7 = good, specific instruction
10 = excellent, detailed with clear acceptance criteria

Prompts:
${numbered}

Reply with ONLY a JSON array of numbers, e.g. [7, 3, 8]. No explanation.`;
}

function parseScores(text, count) {
  const match = text.match(/\[[\d\s,]+\]/);
  if (!match) return Array(count).fill(null);

  const scores = JSON.parse(match[0]);
  return Array.from({ length: count }, (_, i) => {
    const s = scores[i];
    if (typeof s === 'number' && s >= 0 && s <= 10) return Math.round(s);
    return null;
  });
}

async function scoreViaAnthropic(prompts, model) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return prompts.map(() => null);

  const resp = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: buildPrompt(prompts) }],
    }),
  });

  if (!resp.ok) return prompts.map(() => null);

  const data = await resp.json();
  const text = data?.content?.[0]?.text || '';
  return parseScores(text, prompts.length);
}

async function scoreViaBedrock(prompts, model, awsRegion) {
  const client = new BedrockRuntimeClient({ region: awsRegion || 'us-east-1' });
  const bedrockModel = toBedrockModelId(model || DEFAULT_MODEL);

  const command = new InvokeModelCommand({
    modelId: bedrockModel,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1024,
      messages: [{ role: 'user', content: buildPrompt(prompts) }],
    }),
  });

  const response = await client.send(command);
  const data = JSON.parse(new TextDecoder().decode(response.body));
  const text = data?.content?.[0]?.text || '';
  return parseScores(text, prompts.length);
}

/**
 * Score prompts using configured backend.
 * @param {string[]} prompts
 * @param {string} [model]
 * @param {object} [options]
 * @param {string} [options.backend] - 'anthropic' | 'bedrock'
 * @param {string} [options.awsRegion] - AWS region for Bedrock
 */
export async function scorePrompts(prompts, model = DEFAULT_MODEL, options = {}) {
  if (prompts.length === 0) return [];

  const backend = options.backend || 'anthropic';

  try {
    if (backend === 'bedrock') {
      return await scoreViaBedrock(prompts, model, options.awsRegion);
    }
    return await scoreViaAnthropic(prompts, model);
  } catch {
    return prompts.map(() => null);
  }
}
