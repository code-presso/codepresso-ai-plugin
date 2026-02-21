/**
 * Trivial prompt filter.
 * Skips short or acknowledgment-only prompts from batch logging and scoring.
 */

const DEFAULT_TRIVIAL_PATTERNS = [
  'ok', 'okay', '확인', '네', '응', 'ㅇㅇ',
  'yes', 'no', 'sure', 'thanks', 'thx', 'ty',
  'push', 'pull', 'done', 'next', 'go', 'run',
  'lgtm', '좋아', 'ㄱㄱ', 'y', 'n', 'continue', 'proceed',
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
  return patterns.some((p) => lower === p.toLowerCase());
}
