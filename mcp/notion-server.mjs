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
  execSync('npm install --no-audit --no-fund', { cwd: pluginRoot, stdio: 'ignore' });
}

// Dynamic imports — resolved after npm install has run
const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const CONFIG_PATH = join(homedir(), '.codepresso', 'config.json');

function loadNotionConfig() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return config.notion || {};
  } catch {
    return {};
  }
}

function loadNotionKey() {
  return loadNotionConfig().apiKey || null;
}

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/**
 * Make an authenticated request to the Notion API.
 */
async function notionFetch(path, method = 'GET', body = null) {
  const apiKey = loadNotionKey();
  if (!apiKey) {
    throw new Error('Notion API key not configured. Run codepresso:setup first.');
  }

  const options = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${NOTION_API}${path}`, options);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Notion API error (${response.status}): ${errorBody}`);
  }

  return response.json();
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

// --- Server setup ---

const server = new Server(
  { name: 'codepresso-notion', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

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

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
