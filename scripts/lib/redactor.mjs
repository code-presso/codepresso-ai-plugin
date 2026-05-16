/**
 * Redact sensitive data from text before logging to PRs.
 * Applied at batch-append time so secrets never hit disk.
 */

const PATTERNS = [
  // --- Specific token patterns (must run BEFORE generic field matchers) ---
  // Anthropic API keys
  { regex: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g, replacement: '[REDACTED_API_KEY]' },
  // OpenAI API keys
  { regex: /\bsk-[a-zA-Z0-9]{20,}\b/g, replacement: '[REDACTED_API_KEY]' },
  // Notion tokens
  { regex: /\bntn_[a-zA-Z0-9]{20,}\b/g, replacement: '[REDACTED_NOTION_TOKEN]' },
  // AWS Access Key IDs
  { regex: /\b(AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16}\b/g, replacement: '[REDACTED_AWS_KEY]' },
  // AWS Secret Access Keys (40 char base64)
  { regex: /(?<=aws_secret_access_key\s*[=:]\s*)[A-Za-z0-9/+=]{40}\b/g, replacement: '[REDACTED_AWS_SECRET]' },
  // GitHub tokens
  { regex: /\b(ghp|gho|ghs|ghr|github_pat)_[a-zA-Z0-9_]{20,}\b/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  // Bearer tokens
  { regex: /\b(Bearer\s+)eyJ[a-zA-Z0-9_-]{20,}\b/gi, replacement: '$1[REDACTED_TOKEN]' },
  // Generic JWT tokens
  { regex: /\beyJ[a-zA-Z0-9_-]{20,}\.eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\b/g, replacement: '[REDACTED_JWT]' },
  // Connection strings with passwords
  { regex: /((?:postgres|mysql|mongodb|redis|amqp)(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, replacement: '$1[REDACTED]$2' },
  // --- Generic field matchers (run AFTER specific patterns) ---
  // Password fields in various formats (skip already-redacted values)
  { regex: /((?:password|passwd|pwd|secret|token|api_key|apikey)\s*[=:]\s*["']?)(?!\[REDACTED)[^\s"',;}{]+/gi, replacement: '$1[REDACTED]' },
  // Hex strings 40+ chars (likely secrets/hashes)
  { regex: /\b[0-9a-f]{40,}\b/gi, replacement: '[REDACTED_SECRET]' },
];

/**
 * Redact sensitive patterns from text.
 * @param {string} text - The text to redact
 * @param {string[]} [extraPatterns] - Additional regex patterns (strings) to redact
 * @returns {string} Text with sensitive data replaced
 */
export function redactSecrets(text, extraPatterns = []) {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // Apply built-in patterns
  for (const { regex, replacement } of PATTERNS) {
    // Reset regex lastIndex for global regexes
    regex.lastIndex = 0;
    result = result.replace(regex, replacement);
  }

  // Apply extra user-defined patterns
  for (const pattern of extraPatterns) {
    try {
      const re = new RegExp(pattern, 'g');
      result = result.replace(re, '[REDACTED]');
    } catch {
      // Invalid regex, skip
    }
  }

  return result;
}
