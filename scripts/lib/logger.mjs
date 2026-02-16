import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LOG_DIR = join(homedir(), '.codepresso', 'logs');
const CONFIG_PATH = join(homedir(), '.codepresso', 'config.json');

/**
 * Read debug flag from config, never throw
 * @returns {boolean}
 */
function isDebugEnabled() {
  try {
    if (!existsSync(CONFIG_PATH)) return false;
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return config.debug === true;
  } catch {
    return false;
  }
}

/**
 * Get log file path for today
 * @returns {string}
 */
function getLogPath() {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return join(LOG_DIR, `codepresso-${date}.log`);
}

/**
 * Write log entry, never throw
 * @param {string} level
 * @param {string} source
 * @param {string} message
 */
function writeLog(level, source, message) {
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] [${source}] ${message}\n`;
    appendFileSync(getLogPath(), line, 'utf-8');
  } catch {
    // Silent fail - never block execution
  }
}

/**
 * Create a logger instance for a specific source
 * @param {string} source - Source identifier (e.g., 'session-start')
 * @returns {Object} Logger with debug/info/warn/error methods
 */
export function createLogger(source) {
  const enabled = isDebugEnabled();

  const noop = () => {};

  if (!enabled) {
    return {
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
    };
  }

  return {
    debug: (msg) => writeLog('DEBUG', source, msg),
    info: (msg) => writeLog('INFO', source, msg),
    warn: (msg) => writeLog('WARN', source, msg),
    error: (msg) => writeLog('ERROR', source, msg),
  };
}
