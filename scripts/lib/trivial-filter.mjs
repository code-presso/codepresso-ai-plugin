/**
 * Trivial prompt filter.
 * Skips short or acknowledgment-only prompts from batch logging and scoring.
 */

const DEFAULT_TRIVIAL_PATTERNS = [
  'ok', 'okay', '확인', '네', '응', 'ㅇㅇ',
  'yes', 'no', 'sure', 'thanks', 'thx', 'ty',
  'push', 'pull', 'done', 'next', 'go', 'run',
  'lgtm', '좋아', 'ㄱㄱ', 'y', 'n', 'continue', 'proceed',
  'also', 'right', 'got it', 'alright', 'sounds good', 'go ahead',
  '그래', '맞아', '알겠어', '해줘', 'ㅇㅋ',
];

const DEFAULT_NOISE_PATTERNS = [
  /^(claude|hook|plugin|mcp|server)\s+(executed|registered|started|stopped|loaded|connected|failed)/i,
  /^(starting|stopping|running|loading)\s+(hook|plugin|server|mcp)/i,
  /^\[?(info|debug|warn|error)\]?\s*:/i,
];

const DEFAULT_MIN_LENGTH = 20;

/**
 * Check if a prompt is trivial (too short or a known acknowledgment).
 * @param {string} prompt - The user prompt
 * @param {{ enabled?: boolean, minPromptLength?: number, trivialPatterns?: string[] }} config - trivialFilter config section
 * @returns {boolean}
 */
export function isTrivial(prompt, config = {}) {
  if (config.enabled === false) return false;
  if (typeof prompt !== 'string') return false;

  const trimmed = prompt.trim();
  if (trimmed.length === 0) return true;

  const minLen = config.minPromptLength ?? DEFAULT_MIN_LENGTH;
  if (trimmed.length < minLen) return true;

  const patterns = config.trivialPatterns ?? DEFAULT_TRIVIAL_PATTERNS;
  const lower = trimmed.toLowerCase();
  if (patterns.some((p) => lower === p.toLowerCase())) return true;

  // Noise patterns: messages that look like system output, not user instructions
  const noisePatterns = config.noisePatterns ?? DEFAULT_NOISE_PATTERNS;
  if (noisePatterns.some((p) => p.test(trimmed))) return true;

  return false;
}
