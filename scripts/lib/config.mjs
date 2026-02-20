import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const GLOBAL_CONFIG_PATH = join(homedir(), '.codepresso', 'config.json');
const PROJECT_CONFIG_NAME = '.codepresso.json';

const DEFAULT_CONFIG = {
  github: { token: null },
  notion: {
    apiKey: null,
    defaultDatabaseId: null,
    userId: null,               // Notion user ID (for filtering tasks by assignee)
    displayName: null,          // Display name (for auto-assigning created tasks)
    assigneeProperty: 'Assignee', // Name of the assignee property in the Notion DB
    syncWindowDays: 14,          // Default query window for Notion sync (0 = no limit)
  },
  prLogging: {
    enabled: true,
    trackGitOps: true,
    batchIntervalSeconds: 60,
    maxBatchSize: 10,
    truncatePromptLength: 500,
  },
  scoring: {
    enabled: true,
    backend: 'anthropic',           // 'anthropic' | 'bedrock'
    model: 'claude-haiku-4-5-20251001',
    awsRegion: 'us-east-1',        // Only used when backend is 'bedrock'
  },
  deploy: {
    enabled: false,
    method: null,
    awsRegion: null,
    ecsCluster: null,
    ecsService: null,
    pipelineName: null,
  },
  redaction: {
    enabled: true,
    extraPatterns: [],
  },
  rateLimit: {
    maxCommentsPerHour: 10,
    maxCommentsPerSession: 50,
  },
  analytics: {
    enabled: true,
    retentionDays: 90,
  },
  prLabels: {
    enabled: true,
    labels: ['ai-assisted'],
  },
  excludePatterns: ['^/oh-my-claudecode:', '^(cancelomc|stopomc)$'],
  debug: false,
};

/**
 * Read and parse a JSON file, returning null on any error.
 */
function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Shallow-merge per-section: project values override global values within
 * each top-level key, but do not replace the entire section.
 */
function mergeSections(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      typeof base[key] === 'object' &&
      base[key] !== null &&
      !Array.isArray(base[key]) &&
      typeof override[key] === 'object' &&
      override[key] !== null &&
      !Array.isArray(override[key])
    ) {
      result[key] = { ...base[key], ...override[key] };
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

/**
 * Load merged config: defaults <- global <- per-project.
 * @param {string} [cwd] - Project directory (defaults to process.cwd())
 * @param {object} [options] - Options object
 * @param {string} [options.globalConfigPath] - Path to global config (defaults to ~/.codepresso/config.json)
 * @returns {object} Merged configuration
 */
export function loadConfig(cwd = process.cwd(), { globalConfigPath } = {}) {
  const global = readJson(globalConfigPath ?? GLOBAL_CONFIG_PATH) || {};
  const project = readJson(join(cwd, PROJECT_CONFIG_NAME)) || {};

  let merged = mergeSections(DEFAULT_CONFIG, global);
  merged = mergeSections(merged, project);

  // Attach validation warnings (non-enumerable so they don't serialize)
  const warnings = validateConfig(merged);
  Object.defineProperty(merged, '_warnings', {
    value: warnings,
    enumerable: false,
    writable: false,
  });

  return merged;
}

/**
 * Check if initial setup has been completed by verifying the global config file exists.
 * @param {string} [globalConfigPath] - Path to global config (defaults to ~/.codepresso/config.json)
 * @returns {boolean}
 */
export function isSetupComplete(globalConfigPath) {
  return existsSync(globalConfigPath ?? GLOBAL_CONFIG_PATH);
}

/**
 * Check if a prompt matches any exclude pattern.
 * @param {string} prompt
 * @param {string[]} patterns
 * @returns {boolean}
 */
export function isExcluded(prompt, patterns) {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((p) => {
    try {
      return new RegExp(p).test(prompt);
    } catch {
      return false;
    }
  });
}

/**
 * Validate a merged config and return warnings for issues.
 * @param {object} config - The merged config object
 * @returns {string[]} Array of warning messages (empty if valid)
 */
export function validateConfig(config) {
  const warnings = [];

  const KNOWN_KEYS = ['github', 'notion', 'prLogging', 'scoring', 'deploy', 'redaction', 'rateLimit', 'analytics', 'prLabels', 'excludePatterns', 'debug'];
  for (const key of Object.keys(config)) {
    if (!KNOWN_KEYS.includes(key)) {
      warnings.push(`Unknown config key: "${key}"`);
    }
  }

  // Type checks
  if (config.prLogging) {
    const pl = config.prLogging;
    if (typeof pl.enabled !== 'undefined' && typeof pl.enabled !== 'boolean') {
      warnings.push(`prLogging.enabled should be boolean, got ${typeof pl.enabled}`);
    }
    if (typeof pl.batchIntervalSeconds === 'number' && pl.batchIntervalSeconds <= 0) {
      warnings.push(`prLogging.batchIntervalSeconds must be > 0, got ${pl.batchIntervalSeconds}`);
    }
    if (typeof pl.maxBatchSize === 'number' && pl.maxBatchSize <= 0) {
      warnings.push(`prLogging.maxBatchSize must be > 0, got ${pl.maxBatchSize}`);
    }
    if (typeof pl.truncatePromptLength === 'number' && pl.truncatePromptLength <= 0) {
      warnings.push(`prLogging.truncatePromptLength must be > 0, got ${pl.truncatePromptLength}`);
    }
  }

  if (config.scoring) {
    if (typeof config.scoring.enabled !== 'undefined' && typeof config.scoring.enabled !== 'boolean') {
      warnings.push(`scoring.enabled should be boolean, got ${typeof config.scoring.enabled}`);
    }
    const validBackends = ['anthropic', 'bedrock'];
    if (config.scoring.backend && !validBackends.includes(config.scoring.backend)) {
      warnings.push(`scoring.backend "${config.scoring.backend}" is not valid. Use: ${validBackends.join(', ')}`);
    }
  }

  if (config.deploy) {
    const validMethods = [null, 'ecs', 'codepipeline', 'workflow', 'custom'];
    if (config.deploy.method && !validMethods.includes(config.deploy.method)) {
      warnings.push(`deploy.method "${config.deploy.method}" is not valid. Use: ${validMethods.filter(Boolean).join(', ')}`);
    }
  }

  if (config.redaction) {
    if (typeof config.redaction.enabled !== 'undefined' && typeof config.redaction.enabled !== 'boolean') {
      warnings.push(`redaction.enabled should be boolean, got ${typeof config.redaction.enabled}`);
    }
    if (config.redaction.extraPatterns && !Array.isArray(config.redaction.extraPatterns)) {
      warnings.push(`redaction.extraPatterns should be an array, got ${typeof config.redaction.extraPatterns}`);
    }
  }

  if (config.rateLimit) {
    if (typeof config.rateLimit.maxCommentsPerHour === 'number' && config.rateLimit.maxCommentsPerHour <= 0) {
      warnings.push(`rateLimit.maxCommentsPerHour must be > 0, got ${config.rateLimit.maxCommentsPerHour}`);
    }
    if (typeof config.rateLimit.maxCommentsPerSession === 'number' && config.rateLimit.maxCommentsPerSession <= 0) {
      warnings.push(`rateLimit.maxCommentsPerSession must be > 0, got ${config.rateLimit.maxCommentsPerSession}`);
    }
  }

  if (config.analytics) {
    if (typeof config.analytics.enabled !== 'undefined' && typeof config.analytics.enabled !== 'boolean') {
      warnings.push(`analytics.enabled should be boolean, got ${typeof config.analytics.enabled}`);
    }
    if (typeof config.analytics.retentionDays === 'number' && config.analytics.retentionDays <= 0) {
      warnings.push(`analytics.retentionDays must be > 0, got ${config.analytics.retentionDays}`);
    }
  }

  if (config.prLabels) {
    if (typeof config.prLabels.enabled !== 'undefined' && typeof config.prLabels.enabled !== 'boolean') {
      warnings.push(`prLabels.enabled should be boolean, got ${typeof config.prLabels.enabled}`);
    }
    if (config.prLabels.labels && !Array.isArray(config.prLabels.labels)) {
      warnings.push(`prLabels.labels should be an array, got ${typeof config.prLabels.labels}`);
    }
  }

  if (config.excludePatterns && !Array.isArray(config.excludePatterns)) {
    warnings.push(`excludePatterns should be an array, got ${typeof config.excludePatterns}`);
  }

  if (typeof config.debug !== 'undefined' && typeof config.debug !== 'boolean') {
    warnings.push(`debug should be boolean, got ${typeof config.debug}`);
  }

  return warnings;
}
