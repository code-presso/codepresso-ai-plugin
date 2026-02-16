/**
 * Score prompts 0-10 using Anthropic Haiku.
 * Uses ANTHROPIC_API_KEY env var. Falls back gracefully if unavailable.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export async function scorePrompts(prompts, model = DEFAULT_MODEL) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || prompts.length === 0) {
    return prompts.map(() => null); // No scores available
  }

  const numbered = prompts.map((p, i) => `${i + 1}. ${p}`).join('\n');

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
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Rate each prompt below on a 0-10 scale for clarity and specificity as a software engineering instruction.

0 = meaningless/noise (e.g. "ok", "hmm")
3 = vague (e.g. "fix it", "make it better")
5 = decent but could be clearer
7 = good, specific instruction
10 = excellent, detailed with clear acceptance criteria

Prompts:
${numbered}

Reply with ONLY a JSON array of numbers, e.g. [7, 3, 8]. No explanation.`
        }],
      }),
    });

    if (!resp.ok) return prompts.map(() => null);

    const data = await resp.json();
    const text = data?.content?.[0]?.text || '';

    // Extract JSON array from response
    const match = text.match(/\[[\d\s,]+\]/);
    if (!match) return prompts.map(() => null);

    const scores = JSON.parse(match[0]);
    // Validate and clamp
    return prompts.map((_, i) => {
      const s = scores[i];
      if (typeof s === 'number' && s >= 0 && s <= 10) return Math.round(s);
      return null;
    });
  } catch {
    return prompts.map(() => null);
  }
}
