#!/usr/bin/env node

/**
 * Codepresso Notion MCP Server — Bootstrap
 *
 * Auto-installs dependencies if missing, then launches the server.
 */

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, '..');

if (!existsSync(join(pluginRoot, 'node_modules', '@modelcontextprotocol'))) {
  try {
    execSync('npm install --no-audit --no-fund', { cwd: pluginRoot, stdio: 'pipe', timeout: 60000 });
  } catch (error) {
    process.stderr.write(`[codepresso-notion] npm install failed: ${error?.message || error}\n`);
    process.exit(1);
  }
}

// Dynamic imports — resolved after npm install has run
const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { buildSprintContext, fetchSprintWithEpics, PROPERTY_TYPES, readTaskStatus } from '../scripts/lib/sprint-context.mjs';

const CONFIG_PATH = join(homedir(), '.codepresso', 'config.json');

function log(msg) {
  process.stderr.write(`[codepresso-notion] ${msg}\n`);
}

// Process-level error handlers
// Only suppress transport-level errors; let real bugs crash + restart cleanly
const SUPPRESSED_ERRORS = new Set(['EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END']);

process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error?.message || error}`);
  if (!SUPPRESSED_ERRORS.has(error?.code)) {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${reason?.message || reason}`);
  // Don't crash on unhandled rejections — these are typically from fire-and-forget promises
});

/** Config cache — re-read from disk at most every 30s */
let _configCache = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL = 30000;

function loadNotionConfig() {
  const now = Date.now();
  if (_configCache && (now - _configCacheTime) < CONFIG_CACHE_TTL) {
    return _configCache;
  }
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    _configCache = config.notion || {};
    _configCacheTime = now;
    return _configCache;
  } catch {
    return {};
  }
}

function loadNotionKey() {
  return loadNotionConfig().apiKey || null;
}

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/** Transient HTTP status codes worth retrying */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
 * Make an authenticated request to the Notion API with retry + exponential backoff.
 */
async function notionFetch(path, method = 'GET', body = null) {
  const apiKey = loadNotionKey();
  if (!apiKey) {
    throw new Error('Notion API key not configured. Run codepresso:setup first.');
  }

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const options = {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`${NOTION_API}${path}`, options);

      if (!response.ok) {
        const errorBody = await response.text();
        lastError = new Error(`Notion API error (${response.status}): ${errorBody}`);

        if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
          clearTimeout(timeout);
          const retryAfter = response.headers.get('retry-after');
          const delay = retryAfter
            ? Math.min(parseInt(retryAfter, 10) * 1000, 10000)
            : BASE_DELAY_MS * Math.pow(2, attempt);
          log(`Retrying ${method} ${path} after ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}, status ${response.status})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        throw lastError;
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      // Retry on network/abort errors (not on non-retryable HTTP errors)
      const isNetworkError = error.name === 'AbortError' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT';
      if (isNetworkError && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        log(`Retrying ${method} ${path} after ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}, ${error.name || error.code})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

// --- Tool definitions ---

const TOOLS = [
  {
    name: 'notion_query_db',
    description: 'Query a Notion database with optional filters and sorts.',
    inputSchema: {
      type: 'object',
      properties: {
        database_id: {
          type: 'string',
          description: 'The Notion database ID to query',
        },
        filter: {
          type: 'object',
          description: 'Optional Notion filter object (see Notion API docs)',
        },
        sorts: {
          type: 'array',
          description: 'Optional array of sort objects',
          items: { type: 'object' },
        },
        page_size: {
          type: 'number',
          description: 'Number of results (max 100, default 50)',
        },
      },
      required: ['database_id'],
    },
  },
  {
    name: 'notion_create_page',
    description: 'Create a new page in a Notion database.',
    inputSchema: {
      type: 'object',
      properties: {
        database_id: {
          type: 'string',
          description: 'The parent database ID',
        },
        properties: {
          type: 'object',
          description: 'Page properties matching the database schema',
        },
        children: {
          type: 'array',
          description: 'Optional page content blocks',
          items: { type: 'object' },
        },
      },
      required: ['database_id', 'properties'],
    },
  },
  {
    name: 'notion_update_page',
    description: 'Update properties of an existing Notion page.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: {
          type: 'string',
          description: 'The page ID to update',
        },
        properties: {
          type: 'object',
          description: 'Properties to update',
        },
      },
      required: ['page_id', 'properties'],
    },
  },
  {
    name: 'notion_search',
    description: 'Search Notion pages by title.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
        filter: {
          type: 'object',
          description: 'Optional filter (e.g., { "property": "object", "value": "page" })',
        },
        page_size: {
          type: 'number',
          description: 'Number of results (max 100, default 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'notion_get_users',
    description:
      'List all users (members and bots) in the Notion workspace. Useful for identifying user IDs to configure task assignment.',
    inputSchema: {
      type: 'object',
      properties: {
        page_size: {
          type: 'number',
          description: 'Number of results (max 100, default 100)',
        },
      },
      required: [],
    },
  },
  {
    name: 'notion_sprint_context',
    description: 'Get the current sprint with its epics and tasks in a hierarchical view. Returns Sprint > Epic > Task tree with progress metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        include_completed: {
          type: 'boolean',
          description: 'Include completed tasks/epics (default: false)',
        },
        assignee_only: {
          type: 'boolean',
          description: 'Filter tasks to configured user only (default: true)',
        },
      },
    },
  },
  {
    name: 'notion_sprint_progress',
    description: 'Get sprint progress metrics: completion rate per epic, blockers, velocity estimate.',
    inputSchema: {
      type: 'object',
      properties: {
        sprint_id: {
          type: 'string',
          description: 'Sprint page ID (defaults to current sprint)',
        },
      },
    },
  },
  {
    name: 'notion_update_task_status',
    description: 'Update a task status in Notion and optionally check if its parent epic should be auto-completed when all tasks are done.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task page ID' },
        new_status: { type: 'string', description: 'New status value (e.g., "진행 중", "완료")' },
        check_epic_completion: {
          type: 'boolean',
          description: 'Check if all tasks in the epic are done and auto-update epic (default: true)',
        },
      },
      required: ['task_id', 'new_status'],
    },
  },
  {
    name: 'notion_sprint_retro',
    description: 'Generate sprint retrospective data: completed work summary, velocity metrics, task distribution by assignee and category.',
    inputSchema: {
      type: 'object',
      properties: {
        sprint_id: {
          type: 'string',
          description: 'Sprint page ID (defaults to current sprint)',
        },
      },
    },
  },
];

// --- Tool handlers ---

async function handleQueryDb(args) {
  const body = {};

  // Build date window filter (default: last 14 days)
  const notionConfig = loadNotionConfig();
  const syncWindowDays = notionConfig.syncWindowDays ?? 14;

  let dateFilter = null;
  if (syncWindowDays > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - syncWindowDays);
    dateFilter = {
      timestamp: 'last_edited_time',
      last_edited_time: { on_or_after: cutoff.toISOString().split('T')[0] },
    };
  }

  // Combine user filter with date window filter
  if (args.filter && dateFilter) {
    body.filter = { and: [args.filter, dateFilter] };
  } else if (args.filter) {
    body.filter = args.filter;
  } else if (dateFilter) {
    body.filter = dateFilter;
  }

  if (args.sorts) body.sorts = args.sorts;
  body.page_size = args.page_size || 50;

  const result = await notionFetch(
    `/databases/${args.database_id}/query`,
    'POST',
    body
  );

  // Simplify results for readability
  const pages = (result.results || []).map((page) => ({
    id: page.id,
    url: page.url,
    created_time: page.created_time,
    last_edited_time: page.last_edited_time,
    properties: page.properties,
  }));

  return { pages, has_more: result.has_more, next_cursor: result.next_cursor };
}

async function handleCreatePage(args) {
  const body = {
    parent: { database_id: args.database_id },
    properties: args.properties,
  };
  if (args.children) body.children = args.children;

  const result = await notionFetch('/pages', 'POST', body);
  return { id: result.id, url: result.url, created_time: result.created_time };
}

async function handleUpdatePage(args) {
  const result = await notionFetch(
    `/pages/${args.page_id}`,
    'PATCH',
    { properties: args.properties }
  );
  return { id: result.id, url: result.url, last_edited_time: result.last_edited_time };
}

async function handleSearch(args) {
  const body = { query: args.query };
  if (args.filter) body.filter = args.filter;
  body.page_size = args.page_size || 10;

  const result = await notionFetch('/search', 'POST', body);

  const pages = (result.results || []).map((page) => ({
    id: page.id,
    object: page.object,
    url: page.url,
    title:
      page.properties?.title?.title?.[0]?.plain_text ||
      page.properties?.Name?.title?.[0]?.plain_text ||
      '(untitled)',
  }));

  return { pages, has_more: result.has_more };
}

async function handleGetUsers(args) {
  const pageSize = args.page_size || 100;
  const result = await notionFetch(`/users?page_size=${pageSize}`);

  const users = (result.results || []).map((user) => ({
    id: user.id,
    type: user.type,
    name: user.name || '(unnamed)',
    avatar_url: user.avatar_url || null,
    email: user.person?.email || null,
  }));

  return { users, has_more: result.has_more, next_cursor: result.next_cursor };
}

async function handleSprintContext(args) {
  const notionConfig = loadNotionConfig();
  if (!notionConfig.databases?.sprint) {
    throw new Error('Sprint database not configured. Add notion.databases.sprint to ~/.codepresso/config.json');
  }

  const config = {
    apiKey: notionConfig.apiKey,
    databases: notionConfig.databases,
    userId: args.assignee_only !== false ? notionConfig.userId : null,
    assigneeProperty: notionConfig.assigneeProperty || '담당자',
    sprintWorkflow: notionConfig.sprintWorkflow || {},
  };

  const context = await buildSprintContext(config);
  if (!context) {
    throw new Error('Could not fetch sprint context. Check that sprint database ID is correct.');
  }

  // Filter completed tasks from the list but preserve original summary counts
  // (summary should always reflect full sprint progress including completed work)
  if (!args.include_completed) {
    for (const epic of context.epics) {
      epic.tasks = (epic.tasks || []).filter(t => t.status !== '완료');
    }
  }

  return context;
}

async function handleSprintProgress(args) {
  const notionConfig = loadNotionConfig();
  if (!notionConfig.databases?.sprint) {
    throw new Error('Sprint database not configured.');
  }

  const config = {
    apiKey: notionConfig.apiKey,
    databases: notionConfig.databases,
    userId: null, // Progress shows all tasks, not just user's
    sprintWorkflow: notionConfig.sprintWorkflow || {},
  };

  const context = await buildSprintContext(config);
  if (!context) {
    throw new Error('Could not fetch sprint data.');
  }

  const sprint = context.sprint;
  const now = new Date();
  const startDate = sprint.dateRange?.start ? new Date(sprint.dateRange.start) : null;
  const endDate = sprint.dateRange?.end ? new Date(sprint.dateRange.end) : null;
  const daysElapsed = startDate ? Math.max(1, Math.ceil((now - startDate) / (1000 * 60 * 60 * 24))) : null;
  const daysRemaining = endDate ? Math.max(0, Math.ceil((endDate - now) / (1000 * 60 * 60 * 24))) : null;
  const velocity = daysElapsed ? (context.summary.completedTasks / daysElapsed).toFixed(1) : null;

  const epicProgress = context.epics.map(epic => {
    const total = (epic.tasks || []).length;
    const done = (epic.tasks || []).filter(t => t.status === '완료').length;
    const blocked = (epic.tasks || []).filter(t => (t.blockedBy || []).length > 0 && t.status !== '완료').length;
    return {
      epicId: epic.uniqueId,
      title: epic.title,
      status: epic.status,
      totalTasks: total,
      completedTasks: done,
      blockedTasks: blocked,
      completionPct: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  });

  return {
    sprint: { name: sprint.name, dateRange: sprint.dateRange, status: sprint.status },
    overall: context.summary,
    daysElapsed,
    daysRemaining,
    velocity: velocity ? `${velocity} tasks/day` : null,
    epicProgress,
  };
}

async function handleUpdateTaskStatus(args) {
  const apiKey = loadNotionKey();
  if (!apiKey) throw new Error('Notion API key not configured.');

  // Update task status using "status" type (Task DB uses status, not select)
  await notionFetch(
    `/pages/${args.task_id}`,
    'PATCH',
    { properties: { [PROPERTY_TYPES.task.status.property]: { status: { name: args.new_status } } } }
  );

  let epicCompleted = false;
  let epicId = null;
  let epicTitle = null;

  // Check epic completion if requested
  if (args.check_epic_completion !== false && args.new_status === '완료') {
    try {
      // Get task page to find its epic
      const taskPage = await notionFetch(`/pages/${args.task_id}`);
      const epicRelation = taskPage?.properties?.[PROPERTY_TYPES.task.epic.property]?.relation;
      if (epicRelation?.length > 0) {
        epicId = epicRelation[0].id;

        // Get epic page to find all its tasks
        const epicPage = await notionFetch(`/pages/${epicId}`);
        epicTitle = epicPage?.properties?.[PROPERTY_TYPES.epic.title.property]?.title?.[0]?.plain_text || '(untitled)';

        // Check all tasks' status
        const notionConfig = loadNotionConfig();
        if (notionConfig.databases?.task) {
          const taskData = await notionFetch(
            `/databases/${notionConfig.databases.task}/query`,
            'POST',
            {
              filter: { property: PROPERTY_TYPES.task.epic.property, relation: { contains: epicId } },
              page_size: 100,
            }
          );

          const allTasks = taskData?.results || [];
          const allDone = allTasks.length > 0 && allTasks.every(t => {
            const status = t.properties?.[PROPERTY_TYPES.task.status.property]?.status?.name;
            return status === '완료';
          });

          if (allDone) {
            // Update epic using "select" type (Epic DB uses select, not status!)
            await notionFetch(
              `/pages/${epicId}`,
              'PATCH',
              { properties: { [PROPERTY_TYPES.epic.status.property]: { select: { name: '배포 완료' } } } }
            );
            epicCompleted = true;
          }
        }
      }
    } catch {
      // Epic cascade failed — task update already succeeded, don't throw
    }
  }

  return { taskUpdated: true, newStatus: args.new_status, epicCompleted, epicId, epicTitle };
}

async function handleSprintRetro(args) {
  const notionConfig = loadNotionConfig();
  if (!notionConfig.databases?.sprint) {
    throw new Error('Sprint database not configured.');
  }

  const config = {
    apiKey: notionConfig.apiKey,
    databases: notionConfig.databases,
    userId: null,
    sprintWorkflow: notionConfig.sprintWorkflow || {},
  };

  const context = await buildSprintContext(config);
  if (!context) {
    throw new Error('Could not fetch sprint data.');
  }

  // Contributor distribution
  const contributors = {};
  const categories = {};
  let totalLeadTimeDays = 0;
  let tasksWithLeadTime = 0;

  for (const epic of context.epics) {
    for (const task of (epic.tasks || [])) {
      // Count by assignee
      for (const a of (task.assignees || [])) {
        const name = a.name || a.id;
        contributors[name] = (contributors[name] || 0) + (task.status === '완료' ? 1 : 0);
      }
      // Count by category (validate property exists)
      for (const cat of (task.categories || [])) {
        categories[cat] = (categories[cat] || 0) + 1;
      }
      // Lead time (validate property exists)
      if (task.dateRange?.start && task.dateRange?.end) {
        const start = new Date(task.dateRange.start);
        const end = new Date(task.dateRange.end);
        const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        if (days > 0) {
          totalLeadTimeDays += days;
          tasksWithLeadTime++;
        }
      }
    }
  }

  const epicOutcomes = context.epics.map(epic => ({
    epicId: epic.uniqueId,
    title: epic.title,
    status: epic.status,
    completionPct: epic.completionPct,
    taskCount: (epic.tasks || []).length,
    completedCount: (epic.tasks || []).filter(t => t.status === '완료').length,
  }));

  return {
    sprint: context.sprint,
    completion: context.summary,
    epicOutcomes,
    contributors,
    categoryDistribution: categories,
    avgLeadTimeDays: tasksWithLeadTime > 0 ? (totalLeadTimeDays / tasksWithLeadTime).toFixed(1) : null,
  };
}

// --- Server setup ---

const server = new Server(
  { name: 'codepresso-notion', version: '0.1.12' },
  { capabilities: { tools: {} } }
);

// Log server errors to stderr instead of crashing
server.onerror = (error) => {
  log(`Server error: ${error?.message || error}`);
};

// Also listen for error events in case SDK uses EventEmitter pattern
if (typeof server.on === 'function') {
  server.on('error', (error) => {
    log(`Server event error: ${error?.message || error}`);
  });
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    switch (name) {
      case 'notion_query_db':
        result = await handleQueryDb(args);
        break;
      case 'notion_create_page':
        result = await handleCreatePage(args);
        break;
      case 'notion_update_page':
        result = await handleUpdatePage(args);
        break;
      case 'notion_search':
        result = await handleSearch(args);
        break;
      case 'notion_get_users':
        result = await handleGetUsers(args);
        break;
      case 'notion_sprint_context':
        result = await handleSprintContext(args);
        break;
      case 'notion_sprint_progress':
        result = await handleSprintProgress(args);
        break;
      case 'notion_update_task_status':
        result = await handleUpdateTaskStatus(args);
        break;
      case 'notion_sprint_retro':
        result = await handleSprintRetro(args);
        break;
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Graceful shutdown
async function shutdown() {
  try {
    await server.close();
  } catch {
    // ignore close errors
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
const transport = new StdioServerTransport();
try {
  await server.connect(transport);
} catch (error) {
  log(`Failed to connect transport: ${error?.message || error}`);
  process.exit(1);
}
