#!/usr/bin/env node

/**
 * Codepresso SessionStart hook.
 * Detects current branch and associated PR, caches state for the session.
 */

import { readStdin } from './lib/stdin.mjs';
import { loadConfig, isSetupComplete } from './lib/config.mjs';
import { createLogger } from './lib/logger.mjs';
import { getCurrentBranch, findPrForBranch, isMainBranch, getHeadCommit, getGitRoot, listSubmodules } from './lib/git-utils.mjs';
import { fetchNotionTasksStructured } from './lib/notion-tasks.mjs';
import { fetchSprintWithEpics } from './lib/sprint-context.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STATE_DIR = join(process.cwd(), '.omc', 'state');
const SESSION_FILE = join(STATE_DIR, 'codepresso-session.json');
const log = createLogger('session-start');

function ensureStateDir() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

async function main() {
  // Consume stdin (required by hook protocol)
  await readStdin(1000);

  // Enforce setup if global config doesn't exist (first run after install)
  if (!isSetupComplete()) {
    process.stdout.write(JSON.stringify({
      continue: true,
      additionalContext: [
        '[Codepresso] Setup required — this plugin has not been configured yet.',
        'Please run the setup wizard now by invoking the `/codepresso:setup` skill.',
        'The plugin will not log prompts or track activity until setup is complete.',
      ].join('\n'),
    }));
    return;
  }

  try {
    const config = loadConfig();
    let gitRoot = getGitRoot();
    let branch = getCurrentBranch(gitRoot);
    const onMainBranch = !branch || isMainBranch(branch);
    const sessionId = randomUUID();
    let pr = null;

    if (!onMainBranch) {
      pr = findPrForBranch(branch, gitRoot);
    }

    // If no PR at top level, scan submodules for active branches with PRs
    let activeSubmodule = null;
    if (!pr) {
      const submodules = listSubmodules(gitRoot);
      for (const sub of submodules) {
        const subBranch = getCurrentBranch(sub.absPath);
        if (subBranch && !isMainBranch(subBranch)) {
          const subPr = findPrForBranch(subBranch, sub.absPath);
          if (subPr) {
            activeSubmodule = sub.path;
            gitRoot = sub.absPath;
            branch = subBranch;
            pr = subPr;
            break;
          }
        }
      }
    }

    log.info(`Branch: ${branch || '(none)'}, PR: ${pr?.number || 'none'}`);

    // Build context parts
    const contextParts = [];

    // PR context only if prLogging is enabled
    if (config.prLogging?.enabled) {
      if (pr) {
        contextParts.push(`[Codepresso] PR #${pr.number} detected on branch \`${branch}\`. Prompts will be logged.`);
      } else if (!onMainBranch) {
        contextParts.push(`[Codepresso] Branch \`${branch}\` — no open PR found. Prompt logging disabled.`);
      }
    }

    // Fetch Notion tasks + sprint context in parallel (non-blocking, timeout-protected)
    let notionContext = null;
    let notionTasks = null;
    let sprintContext = null;

    const sprintEnabled = config.notion?.sprintWorkflow?.enabled
      && config.notion?.databases?.sprint;

    try {
      const fetches = [fetchNotionTasksStructured()];
      if (sprintEnabled) {
        fetches.push(fetchSprintWithEpics(null, 4000));
      }

      const results = await Promise.allSettled(fetches);

      // Task fetch result
      const taskResult = results[0];
      if (taskResult.status === 'fulfilled' && taskResult.value) {
        notionContext = taskResult.value.formatted;
        notionTasks = taskResult.value.tasks;
        contextParts.push(taskResult.value.formatted);
      }

      // Sprint fetch result (only if enabled)
      if (sprintEnabled && results[1]?.status === 'fulfilled' && results[1].value) {
        sprintContext = results[1].value;

        // Cross-reference in-memory: enrich epics with task details from flat list
        if (notionTasks && sprintContext.epics) {
          const taskMap = new Map();
          for (const task of notionTasks) {
            taskMap.set(task.id, task);
          }
          for (const epic of sprintContext.epics) {
            epic.tasks = (epic.taskIds || [])
              .map(id => taskMap.get(id))
              .filter(Boolean);
          }
        }

        // Add sprint info to context
        const sprint = sprintContext.sprint;
        if (sprint) {
          const dateStr = sprint.dateRange
            ? ` (${sprint.dateRange.start} - ${sprint.dateRange.end})`
            : '';
          const epicCount = sprintContext.epics?.length || 0;
          contextParts.push(`[Codepresso] Sprint: "${sprint.name}"${dateStr} | ${epicCount} epics`);
        }
      }
    } catch {
      // Notion/Sprint fetch failed — skip silently
    }

    const sessionState = {
      gitRoot,
      activeSubmodule,
      branch,
      prNumber: pr?.number || null,
      prUrl: pr?.url || null,
      sessionId,
      startedAt: new Date().toISOString(),
      labelsApplied: {},
      headCommit: getHeadCommit(gitRoot),
      notionContext,
      notionTasks,
      notionContextShown: false,
      sprintContext,
      sprintDatabases: config.notion?.databases || null,
      prTitleFormat: config.notion?.sprintWorkflow?.prTitleFormat || 'task',
    };

    ensureStateDir();
    writeFileSync(SESSION_FILE, JSON.stringify(sessionState, null, 2), 'utf-8');

    if (contextParts.length === 0) {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    process.stdout.write(JSON.stringify({
      continue: true,
      additionalContext: contextParts.join('\n\n'),
    }));
  } catch (err) {
    // Silent failure — don't break the session
    log.error(`SessionStart error: ${err.message}`);
    process.stdout.write(JSON.stringify({ continue: true }));
  }
}

main();
