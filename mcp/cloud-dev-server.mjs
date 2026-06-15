#!/usr/bin/env node

/**
 * Codepresso Cloud Dev Environment MCP Server
 *
 * Provides tools to manage team EC2 dev instances.
 * Matches instances by git email → EC2 "Email" tag.
 */

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../scripts/lib/config.mjs';
import { getSessionFile, readCache, isSessionValid, isMfaCredentialError } from '../scripts/lib/aws-session.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, '..');

if (!existsSync(join(pluginRoot, 'node_modules', '@aws-sdk', 'client-ec2'))) {
  execSync('npm install --no-audit --no-fund', { cwd: pluginRoot, stdio: 'ignore' });
}

// Dynamic imports — resolved after npm install
const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');

const {
  EC2Client,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  waitUntilInstanceRunning,
  waitUntilInstanceStopped,
} = await import('@aws-sdk/client-ec2');

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const CONFIG_PATH = join(homedir(), '.codepresso', 'config.json');

function loadCloudDevConfig() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return config.cloudDev || {};
  } catch {
    return {};
  }
}

function getEc2Client() {
  const config = loadCloudDevConfig();
  const region = config.region || 'ap-northeast-2';
  return new EC2Client({ region });
}

/**
 * Get git user email from local git config.
 */
function getGitEmail() {
  try {
    return execSync('git config user.email', { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

/**
 * Find EC2 instances matching the purpose tag, optionally filtered by email.
 */
async function findInstances(email = null) {
  const config = loadCloudDevConfig();
  const tagKey = config.tagKey || 'Email';
  const purposeTag = config.purposeTag || 'cloud-dev-env';

  const filters = [
    { Name: 'tag:Purpose', Values: [purposeTag] },
  ];
  if (email) {
    filters.push({ Name: `tag:${tagKey}`, Values: [email] });
  }

  const client = getEc2Client();
  const command = new DescribeInstancesCommand({ Filters: filters });
  const response = await client.send(command);

  const instances = [];
  for (const reservation of response.Reservations || []) {
    for (const instance of reservation.Instances || []) {
      const tags = {};
      for (const tag of instance.Tags || []) {
        tags[tag.Key] = tag.Value;
      }
      instances.push({
        instanceId: instance.InstanceId,
        state: instance.State?.Name,
        name: tags.Name || '(unnamed)',
        email: tags[tagKey] || null,
        publicIp: instance.PublicIpAddress || null,
        privateIp: instance.PrivateIpAddress || null,
        instanceType: instance.InstanceType,
        launchTime: instance.LaunchTime?.toISOString() || null,
      });
    }
  }

  return instances;
}

// --- Tool definitions ---

const TOOLS = [
  {
    name: 'cloud_dev_status',
    description: 'Show current user\'s cloud dev instance state (running/stopped), IP, and details. Auto-detects user via git email.',
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Override email (optional, auto-detected from git config)',
        },
      },
    },
  },
  {
    name: 'cloud_dev_start',
    description: 'Start the current user\'s cloud dev instance. Waits until running and returns the public IP.',
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Override email (optional, auto-detected from git config)',
        },
      },
    },
  },
  {
    name: 'cloud_dev_stop',
    description: 'Stop the current user\'s cloud dev instance. Waits until fully stopped.',
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Override email (optional, auto-detected from git config)',
        },
      },
    },
  },
  {
    name: 'cloud_dev_list',
    description: 'List ALL team cloud dev instances with state, name, email, and IP. For team visibility.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// --- Tool handlers ---

async function resolveEmail(args) {
  const email = args?.email || getGitEmail();
  if (!email) {
    throw new Error(
      'Could not detect your email. Set git user.email or pass the email parameter.\n' +
      'Run: git config --global user.email "you@example.com"'
    );
  }
  return email;
}

async function resolveUserInstance(args) {
  const email = await resolveEmail(args);
  const instances = await findInstances(email);

  if (instances.length === 0) {
    throw new Error(
      `No cloud dev instance found for email "${email}".\n` +
      'Ensure your instance has tags: Purpose=cloud-dev-env, Email=<your-git-email>'
    );
  }

  return { email, instance: instances[0] };
}

async function handleStatus(args) {
  const { email, instance } = await resolveUserInstance(args);

  const uptime = instance.state === 'running' && instance.launchTime
    ? formatUptime(new Date(instance.launchTime))
    : null;

  return {
    email,
    instanceId: instance.instanceId,
    name: instance.name,
    state: instance.state,
    publicIp: instance.publicIp,
    privateIp: instance.privateIp,
    instanceType: instance.instanceType,
    uptime,
  };
}

async function handleStart(args) {
  const { email, instance } = await resolveUserInstance(args);

  if (instance.state === 'running') {
    return {
      message: 'Instance is already running.',
      instanceId: instance.instanceId,
      name: instance.name,
      publicIp: instance.publicIp,
      state: 'running',
    };
  }

  if (instance.state !== 'stopped') {
    throw new Error(
      `Instance is in "${instance.state}" state. Can only start from "stopped" state.`
    );
  }

  const client = getEc2Client();
  await client.send(new StartInstancesCommand({
    InstanceIds: [instance.instanceId],
  }));

  // Wait for running state (max 120s)
  await waitUntilInstanceRunning(
    { client, maxWaitTime: 120 },
    { InstanceIds: [instance.instanceId] }
  );

  // Re-fetch to get updated IP
  const updated = await findInstances(email);
  const live = updated[0] || instance;

  return {
    message: 'Instance started successfully.',
    instanceId: live.instanceId,
    name: live.name,
    state: 'running',
    publicIp: live.publicIp,
    privateIp: live.privateIp,
  };
}

async function handleStop(args) {
  const { email, instance } = await resolveUserInstance(args);

  if (instance.state === 'stopped') {
    return {
      message: 'Instance is already stopped.',
      instanceId: instance.instanceId,
      name: instance.name,
      state: 'stopped',
    };
  }

  if (instance.state !== 'running') {
    throw new Error(
      `Instance is in "${instance.state}" state. Can only stop from "running" state.`
    );
  }

  const client = getEc2Client();
  await client.send(new StopInstancesCommand({
    InstanceIds: [instance.instanceId],
  }));

  // Wait for stopped state (max 120s)
  await waitUntilInstanceStopped(
    { client, maxWaitTime: 120 },
    { InstanceIds: [instance.instanceId] }
  );

  return {
    message: 'Instance stopped successfully.',
    instanceId: instance.instanceId,
    name: instance.name,
    state: 'stopped',
  };
}

async function handleList() {
  const instances = await findInstances();

  if (instances.length === 0) {
    return { message: 'No cloud dev instances found.', instances: [] };
  }

  return {
    count: instances.length,
    instances: instances.map(i => ({
      name: i.name,
      email: i.email,
      state: i.state,
      publicIp: i.publicIp,
      instanceType: i.instanceType,
      instanceId: i.instanceId,
    })),
  };
}

/**
 * Format uptime as human-readable string.
 */
function formatUptime(launchTime) {
  const ms = Date.now() - launchTime.getTime();
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// --- Server setup ---

const server = new Server(
  { name: 'codepresso-cloud-dev', version: '0.1.0' },
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
      case 'cloud_dev_status':
        result = await handleStatus(args);
        break;
      case 'cloud_dev_start':
        result = await handleStart(args);
        break;
      case 'cloud_dev_stop':
        result = await handleStop(args);
        break;
      case 'cloud_dev_list':
        result = await handleList();
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
    const cfg = loadConfig();
    const cacheValid = isSessionValid(readCache(getSessionFile(cfg)));
    if (cfg.aws?.enabled && !cacheValid && isMfaCredentialError(error)) {
      return {
        content: [{ type: 'text', text: 'MFA_REQUIRED: AWS MFA session missing/expired. Run /codepresso:aws-login to refresh, then retry this tool.' }],
        isError: true,
      };
    }
    const message = error.name === 'CredentialsProviderError'
      ? 'AWS credentials not configured. Run /codepresso:aws-login (if MFA is enabled) or set up AWS CLI credentials.'
      : error.message;
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
