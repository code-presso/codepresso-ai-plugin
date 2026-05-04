/**
 * Status transition engine for Codepresso plugin.
 * Handles task status updates and epic cascade completion.
 *
 * CRITICAL: Task DB uses "status" type, Epic DB uses "select" type for 상태.
 * These are different Notion API shapes!
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PROPERTY_TYPES } from './sprint-context.mjs';
import { getStateDir } from './config.mjs';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/**
 * Make an authenticated Notion API request.
 * @returns {Promise<object|null>} Response data or null on error
 */
async function notionFetch(path, options = {}, apiKey) {
  try {
    const response = await fetch(`${NOTION_API}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

/**
 * Mark a task as "진행 중" (In Progress) in Notion.
 * Uses "status" type (Task DB), NOT "select" type.
 *
 * @param {{ apiKey: string }} notionConfig
 * @param {string} taskId - Notion task page ID
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function markTaskInProgress(notionConfig, taskId) {
  if (!notionConfig?.apiKey || !taskId) {
    return { success: false, error: 'Missing apiKey or taskId' };
  }

  const result = await notionFetch(
    `/pages/${taskId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          [PROPERTY_TYPES.task.status.property]: {
            status: { name: '진행 중' },  // "status" type for Task DB
          },
        },
      }),
    },
    notionConfig.apiKey,
  );

  return result ? { success: true } : { success: false, error: 'Notion API call failed' };
}

/**
 * Mark a task as "완료" (Done) in Notion.
 * Optionally cascades to check and complete the parent epic.
 *
 * @param {{ apiKey: string, databases?: object }} notionConfig
 * @param {string} taskId - Notion task page ID
 * @param {{ cascadeEpic?: boolean }} [options]
 * @returns {Promise<{ success: boolean, epicCompleted?: boolean, error?: string }>}
 */
export async function markTaskComplete(notionConfig, taskId, options = { cascadeEpic: true }) {
  if (!notionConfig?.apiKey || !taskId) {
    return { success: false, error: 'Missing apiKey or taskId' };
  }

  // Update task status using "status" type
  const result = await notionFetch(
    `/pages/${taskId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          [PROPERTY_TYPES.task.status.property]: {
            status: { name: '완료' },  // "status" type for Task DB
          },
        },
      }),
    },
    notionConfig.apiKey,
  );

  if (!result) {
    return { success: false, error: 'Failed to update task status' };
  }

  // Cascade to epic if enabled
  let epicCompleted = false;
  if (options.cascadeEpic) {
    try {
      // Find task's epic via forward relation
      const taskPage = await notionFetch(`/pages/${taskId}`, { method: 'GET' }, notionConfig.apiKey);
      const epicRelation = taskPage?.properties?.[PROPERTY_TYPES.task.epic.property]?.relation;
      if (epicRelation?.length > 0) {
        const epicId = epicRelation[0].id;
        const cascadeResult = await checkAndCompleteEpic(notionConfig, epicId);
        epicCompleted = cascadeResult.epicUpdated;
      }
    } catch {
      // Epic cascade failed — task update already succeeded
    }
  }

  return { success: true, epicCompleted };
}

/**
 * Check if all tasks in an epic are completed.
 * If yes, update epic status to "배포 완료" using "select" type (NOT "status").
 *
 * @param {{ apiKey: string, databases?: object }} notionConfig
 * @param {string} epicId - Notion epic page ID
 * @returns {Promise<{ allDone: boolean, epicUpdated: boolean }>}
 */
export async function checkAndCompleteEpic(notionConfig, epicId) {
  if (!notionConfig?.apiKey || !epicId) {
    return { allDone: false, epicUpdated: false };
  }

  // Get epic page to read forward relation (관계형 그룹 → task IDs)
  const epicPage = await notionFetch(`/pages/${epicId}`, { method: 'GET' }, notionConfig.apiKey);
  if (!epicPage) return { allDone: false, epicUpdated: false };

  const taskIds = (epicPage.properties?.[PROPERTY_TYPES.epic.tasks.property]?.relation || []).map(r => r.id);
  if (taskIds.length === 0) return { allDone: false, epicUpdated: false };

  // Fetch each task's status
  // If we have the task DB ID, use a relation filter query (more efficient)
  if (notionConfig.databases?.task) {
    const taskData = await notionFetch(
      `/databases/${notionConfig.databases.task}/query`,
      {
        method: 'POST',
        body: JSON.stringify({
          filter: {
            property: PROPERTY_TYPES.task.epic.property,
            relation: { contains: epicId },
          },
          page_size: 100,
        }),
      },
      notionConfig.apiKey,
    );

    const allTasks = taskData?.results || [];
    if (allTasks.length === 0) return { allDone: false, epicUpdated: false };

    // Check all task statuses using "status" type (Task DB)
    const allDone = allTasks.every(t => {
      const status = t.properties?.[PROPERTY_TYPES.task.status.property]?.status?.name;
      return status === '완료';
    });

    if (!allDone) return { allDone: false, epicUpdated: false };
  } else {
    // Fallback: fetch individual task pages
    for (const taskId of taskIds) {
      const taskPage = await notionFetch(`/pages/${taskId}`, { method: 'GET' }, notionConfig.apiKey);
      const status = taskPage?.properties?.[PROPERTY_TYPES.task.status.property]?.status?.name;
      if (status !== '완료') return { allDone: false, epicUpdated: false };
    }
  }

  // All tasks done — update epic using "select" type (Epic DB, NOT "status"!)
  const updateResult = await notionFetch(
    `/pages/${epicId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          [PROPERTY_TYPES.epic.status.property]: {
            select: { name: '배포 완료' },  // "select" type for Epic DB
          },
        },
      }),
    },
    notionConfig.apiKey,
  );

  return { allDone: true, epicUpdated: !!updateResult };
}

/**
 * Resolve which task is associated with a PR by reading the branch-keyed selected task file.
 *
 * @param {string} branch - Git branch name
 * @returns {{ taskId: string, taskUniqueId: string, epicId?: string, epicUniqueId?: string }|null}
 */
export function resolveTaskForPr(branch) {
  if (!branch) return null;

  const selectedTaskFile = join(getStateDir(), 'codepresso-selected-task.json');
  try {
    if (!existsSync(selectedTaskFile)) return null;
    const data = JSON.parse(readFileSync(selectedTaskFile, 'utf-8'));

    // Branch-keyed format
    const task = data[branch];
    if (task?.id) {
      return {
        taskId: task.id,
        taskUniqueId: task.uniqueId || null,
        epicId: task.epicId || null,
        epicUniqueId: task.epicUniqueId || null,
      };
    }

    // Legacy singleton format
    if (data.id) {
      return {
        taskId: data.id,
        taskUniqueId: data.uniqueId || null,
        epicId: data.epicId || null,
        epicUniqueId: data.epicUniqueId || null,
      };
    }

    return null;
  } catch {
    return null;
  }
}
