/**
 * Lightweight Notion task fetcher for use in hooks.
 * Makes a single HTTP call to query tasks from a configured Notion database.
 * Designed to be fast and fail-safe for use within the 5s SessionStart timeout.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const FETCH_TIMEOUT_MS = 4000;

/**
 * Load Notion config from the global config file.
 * @returns {{ apiKey: string|null, defaultDatabaseId: string|null, userId: string|null, displayName: string|null, assigneeProperty: string }}
 */
function loadNotionConfig() {
  try {
    const configPath = join(homedir(), '.codepresso', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return {
      apiKey: config.notion?.apiKey || null,
      defaultDatabaseId: config.notion?.defaultDatabaseId || null,
      userId: config.notion?.userId || null,
      displayName: config.notion?.displayName || null,
      assigneeProperty: config.notion?.assigneeProperty || 'Assignee',
    };
  } catch {
    return { apiKey: null, defaultDatabaseId: null, userId: null, displayName: null, assigneeProperty: 'Assignee' };
  }
}

/**
 * Extract a plain text title from a Notion page's properties.
 */
function extractTitle(properties) {
  for (const value of Object.values(properties)) {
    if (value.type === 'title' && Array.isArray(value.title)) {
      return value.title.map((t) => t.plain_text).join('') || '(untitled)';
    }
  }
  return '(untitled)';
}

/**
 * Extract the status value from a Notion page's properties.
 */
function extractStatus(properties) {
  for (const [, value] of Object.entries(properties)) {
    if (value.type === 'status' && value.status) {
      return value.status.name || null;
    }
    if (value.type === 'select' && value.select) {
      // Some boards use a "select" property named Status
      const key = Object.keys(properties).find(
        (k) => properties[k] === value
      );
      if (key && /status/i.test(key)) {
        return value.select.name || null;
      }
    }
  }
  return null;
}

/**
 * Check if a task status represents a completed state.
 * @param {string|null} status
 * @returns {boolean}
 */
export function isCompletedStatus(status) {
  if (!status) return false;
  const normalized = status.toLowerCase().trim();
  return normalized === '완료' || normalized === 'done' || normalized === 'completed';
}

/**
 * Fetch tasks from the configured Notion database with structured data.
 * Returns both a formatted string and structured task objects, or null if not configured.
 *
 * @param {number} [timeoutMs=FETCH_TIMEOUT_MS]
 * @returns {Promise<{formatted: string, tasks: Array<{id: string, title: string, status: string|null}>}|null>}
 */
export async function fetchNotionTasksStructured(timeoutMs = FETCH_TIMEOUT_MS) {
  const notion = loadNotionConfig();

  if (!notion.apiKey || !notion.defaultDatabaseId) {
    return null;
  }

  const body = {
    page_size: 20,
  };

  if (notion.userId) {
    body.filter = {
      property: notion.assigneeProperty,
      people: { contains: notion.userId },
    };
  }

  body.sorts = [
    { timestamp: 'last_edited_time', direction: 'descending' },
  ];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `${NOTION_API}/databases/${notion.defaultDatabaseId}/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${notion.apiKey}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const pages = data.results || [];

      if (pages.length === 0) {
        const msg = notion.userId
          ? 'No tasks assigned to you in Notion.'
          : 'No tasks found in Notion database.';
        return { formatted: msg, tasks: [] };
      }

      const tasks = pages.map((page) => {
        const title = extractTitle(page.properties);
        const status = extractStatus(page.properties);
        return { id: page.id, title, status };
      });

      const lines = tasks.map((t) => {
        const statusStr = t.status ? ` (${t.status})` : '';
        return `- ${t.title}${statusStr}`;
      });

      const header = notion.userId
        ? `Your Notion Tasks (${pages.length}):`
        : `Notion Tasks (${pages.length}):`;

      return {
        formatted: `${header}\n${lines.join('\n')}`,
        tasks,
      };
    } catch {
      clearTimeout(timeout);
      throw new Error('Fetch failed');
    }
  } catch {
    return null;
  }
}

/**
 * Fetch tasks from the configured Notion database.
 * Returns a formatted task list string, or null if Notion is not configured or the call fails.
 *
 * @param {number} [timeoutMs=FETCH_TIMEOUT_MS]
 * @returns {Promise<string|null>} Formatted task list or null
 */
export async function fetchNotionTasks(timeoutMs = FETCH_TIMEOUT_MS) {
  const result = await fetchNotionTasksStructured(timeoutMs);
  return result ? result.formatted : null;
}
