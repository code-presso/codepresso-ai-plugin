#!/usr/bin/env node

/**
 * Codepresso Notion MCP Server
 *
 * Standalone MCP server exposing Notion API tools:
 * - notion_query_db    — Query a database with optional filters
 * - notion_create_page — Create a page in a database
 * - notion_update_page — Update page properties
 * - notion_search      — Search pages by title
 *
 * Reads API key from ~/.codepresso/config.json
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_PATH = join(homedir(), '.codepresso', 'config.json');

function loadNotionKey() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return config.notion?.apiKey || null;
  } catch {
    return null;
  }
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
];

// --- Tool handlers ---

async function handleQueryDb(args) {
  const body = {};
  if (args.filter) body.filter = args.filter;
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
