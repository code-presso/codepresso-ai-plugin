/**
 * Sprint context fetcher for Codepresso plugin.
 * Fetches Sprint > Epic > Task hierarchy using forward-only Notion relations.
 * Used by session-start hook (lightweight) and MCP tools (full detail).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/**
 * Property type constants for all three databases.
 * Sprint and Epic use 'select' type for status.
 * Task uses 'status' type for status (DIFFERENT!).
 */
export const PROPERTY_TYPES = {
  sprint: {
    status: { property: '상태', type: 'select', values: ['완료', '현재', '다음 스프린트'] },
    name: { property: '이름', type: 'title' },
    date: { property: '기간', type: 'date' },
    epics: { property: '개발팀 에픽', type: 'relation' },
  },
  epic: {
    status: { property: '상태', type: 'select', values: ['배포 완료'] },
    title: { property: '제목', type: 'title' },
    uniqueId: { property: 'ID 1', type: 'unique_id', prefix: 'GP' },
    tasks: { property: '관계형 그룹', type: 'relation' },
    sprint: { property: '스프린트', type: 'relation' },
  },
  task: {
    status: { property: '상태', type: 'status', values: ['완료', 'Holding(홀딩)', '할 일', '진행 중'] },
    title: { property: '작업명', type: 'title' },
    uniqueId: { property: 'ID', type: 'unique_id', prefix: 'TSK' },
    assignee: { property: '담당자', type: 'people' },
    epic: { property: '개발팀 에픽', type: 'relation' },
    blockedBy: { property: 'blocked by', type: 'relation' },
    dateRange: { property: '기간', type: 'date' },
    category: { property: '업무분류', type: 'multi_select' },
  },
};

/**
 * Load sprint-related Notion config from global config file.
 */
function loadSprintConfig() {
  try {
    const configPath = join(homedir(), '.codepresso', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return {
      apiKey: config.notion?.apiKey || null,
      databases: config.notion?.databases || {},
      userId: config.notion?.userId || null,
      assigneeProperty: config.notion?.assigneeProperty || '담당자',
      sprintWorkflow: config.notion?.sprintWorkflow || { enabled: false },
    };
  } catch {
    return { apiKey: null, databases: {}, userId: null, assigneeProperty: '담당자', sprintWorkflow: { enabled: false } };
  }
}

/**
 * Make an authenticated Notion API request.
 */
async function notionFetch(path, options = {}, apiKey, signal) {
  const response = await fetch(`${NOTION_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal,
  });
  if (!response.ok) return null;
  return response.json();
}

// --- Property Readers (DO NOT use extractStatus from notion-tasks.mjs) ---

/** Read sprint status (select type) */
function readSprintStatus(page) {
  return page.properties[PROPERTY_TYPES.sprint.status.property]?.select?.name ?? null;
}

/** Read epic status (select type) */
function readEpicStatus(page) {
  return page.properties[PROPERTY_TYPES.epic.status.property]?.select?.name ?? null;
}

/** Read task status (status type — DIFFERENT from sprint/epic!) */
export function readTaskStatus(page) {
  return page.properties[PROPERTY_TYPES.task.status.property]?.status?.name ?? null;
}

/** Extract relation IDs from a page property (forward relations only) */
function readRelationIds(page, propertyName) {
  const prop = page.properties[propertyName];
  if (!prop || prop.type !== 'relation') return [];
  return prop.relation.map(r => r.id);
}

/** Extract plain text from a title property */
function readTitle(page, propertyName) {
  const prop = page.properties[propertyName];
  if (!prop || prop.type !== 'title' || !Array.isArray(prop.title)) return '(untitled)';
  return prop.title.map(t => t.plain_text).join('') || '(untitled)';
}

/** Extract unique ID (e.g., "GP-1014" or "TSK-8447") */
function readUniqueId(page, propertyName) {
  const prop = page.properties[propertyName];
  if (!prop || prop.type !== 'unique_id' || !prop.unique_id) return null;
  const { prefix, number } = prop.unique_id;
  if (prefix && number != null) return `${prefix}-${number}`;
  if (number != null) return String(number);
  return null;
}

/** Read date range */
function readDateRange(page, propertyName) {
  const prop = page.properties[propertyName];
  if (!prop || prop.type !== 'date' || !prop.date) return null;
  return { start: prop.date.start, end: prop.date.end };
}

/**
 * Lightweight sprint fetch for session-start hook.
 * Runs IN PARALLEL with existing task fetch.
 *
 * Strategy (forward relations only):
 *   1. Query Sprint DB for current sprint (상태 === "현재")
 *   2. Extract epic page IDs from 개발팀 에픽 forward relation
 *   3. Batch-fetch epic pages to get titles, unique IDs, and task relation IDs
 *
 * @param {object} [notionConfig] - Optional pre-loaded config. If null, loads from disk.
 * @param {number} [timeoutMs=4000] - AbortController timeout
 * @returns {Promise<{sprint: object, epics: Array}|null>}
 */
export async function fetchSprintWithEpics(notionConfig = null, timeoutMs = 4000) {
  const config = notionConfig || loadSprintConfig();
  if (!config.apiKey || !config.databases?.sprint) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Step 1: Query Sprint DB for current sprint
    const sprintData = await notionFetch(
      `/databases/${config.databases.sprint}/query`,
      {
        method: 'POST',
        body: JSON.stringify({
          filter: { property: '상태', select: { equals: '현재' } },
          page_size: 1,
        }),
      },
      config.apiKey,
      controller.signal,
    );

    if (!sprintData?.results?.length) {
      clearTimeout(timeout);
      return null;
    }

    const sprintPage = sprintData.results[0];
    const sprint = {
      id: sprintPage.id,
      name: readTitle(sprintPage, PROPERTY_TYPES.sprint.name.property),
      status: readSprintStatus(sprintPage),
      dateRange: readDateRange(sprintPage, PROPERTY_TYPES.sprint.date.property),
    };

    // Step 2: Extract epic IDs from forward relation
    const epicIds = readRelationIds(sprintPage, PROPERTY_TYPES.sprint.epics.property);

    if (epicIds.length === 0) {
      clearTimeout(timeout);
      return { sprint, epics: [] };
    }

    // Step 3: Batch-fetch epic pages in parallel (within the same AbortController)
    const epicPages = await Promise.all(
      epicIds.map(id =>
        notionFetch(`/pages/${id}`, { method: 'GET' }, config.apiKey, controller.signal)
      )
    );

    const epics = epicPages
      .filter(Boolean)
      .map(page => ({
        id: page.id,
        title: readTitle(page, PROPERTY_TYPES.epic.title.property),
        uniqueId: readUniqueId(page, PROPERTY_TYPES.epic.uniqueId.property),
        status: readEpicStatus(page),
        taskIds: readRelationIds(page, PROPERTY_TYPES.epic.tasks.property),
      }));

    clearTimeout(timeout);
    return { sprint, epics };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * Build full sprint context with task details.
 * Designed for MCP tools (no timeout pressure).
 *
 * @param {object} [notionConfig] - Optional pre-loaded config
 * @returns {Promise<{sprint: object, epics: Array, summary: object}|null>}
 */
export async function buildSprintContext(notionConfig = null) {
  const config = notionConfig || loadSprintConfig();
  if (!config.apiKey || !config.databases?.sprint || !config.databases?.task) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    // Get sprint + epics
    const data = await fetchSprintWithEpics(config, 30000); // generous timeout for MCP
    if (!data) {
      clearTimeout(timeout);
      return null;
    }

    let totalTasks = 0;
    let completedTasks = 0;
    let blockedTasks = 0;

    // For each epic, fetch full task details from Task DB.
    // Always query by epic relation — don't rely on epic.taskIds which comes from
    // the reverse relation (관계형 그룹) and may be empty/truncated in page API.
    for (const epic of data.epics) {
      // Query Task DB filtered by epic relation
      const taskData = await notionFetch(
        `/databases/${config.databases.task}/query`,
        {
          method: 'POST',
          body: JSON.stringify({
            filter: {
              property: PROPERTY_TYPES.task.epic.property,
              relation: { contains: epic.id },
            },
            page_size: 100,
          }),
        },
        config.apiKey,
        controller.signal,
      );

      const taskPages = taskData?.results || [];
      epic.tasks = taskPages.map(page => {
        const status = readTaskStatus(page);
        const blockedByIds = readRelationIds(page, PROPERTY_TYPES.task.blockedBy.property);
        const dateRange = readDateRange(page, PROPERTY_TYPES.task.dateRange.property);
        const assignees = page.properties[PROPERTY_TYPES.task.assignee.property]?.people || [];
        const category = page.properties[PROPERTY_TYPES.task.category.property]?.multi_select || [];

        return {
          id: page.id,
          title: readTitle(page, PROPERTY_TYPES.task.title.property),
          uniqueId: readUniqueId(page, PROPERTY_TYPES.task.uniqueId.property),
          status,
          assignees: assignees.map(a => ({ id: a.id, name: a.name || null })),
          blockedBy: blockedByIds,
          dateRange,
          categories: category.map(c => c.name),
          epicId: epic.id,
          epicUniqueId: epic.uniqueId,
        };
      });

      // Filter by userId if configured
      if (config.userId) {
        epic.tasks = epic.tasks.filter(t =>
          t.assignees.some(a => a.id === config.userId)
        );
      }

      const done = epic.tasks.filter(t => t.status === '완료').length;
      epic.completionPct = epic.tasks.length > 0 ? Math.round((done / epic.tasks.length) * 100) : 0;

      totalTasks += epic.tasks.length;
      completedTasks += done;
      blockedTasks += epic.tasks.filter(t => t.blockedBy.length > 0 && t.status !== '완료').length;
    }

    // Fetch orphan tasks (no epic relation) scoped to this sprint's date range
    const orphanFilter = {
      property: PROPERTY_TYPES.task.epic.property,
      relation: { is_empty: true },
    };

    let orphanQueryFilter = orphanFilter;
    if (data.sprint.dateRange?.start) {
      orphanQueryFilter = {
        and: [
          orphanFilter,
          {
            timestamp: 'last_edited_time',
            last_edited_time: { on_or_after: data.sprint.dateRange.start },
          },
        ],
      };
    }

    try {
      const orphanData = await notionFetch(
        `/databases/${config.databases.task}/query`,
        {
          method: 'POST',
          body: JSON.stringify({
            filter: orphanQueryFilter,
            page_size: 100,
          }),
        },
        config.apiKey,
      );

      const orphanPages = orphanData?.results || [];
      if (orphanPages.length > 0) {
        let orphanTasks = orphanPages.map(page => {
          const status = readTaskStatus(page);
          const blockedByIds = readRelationIds(page, PROPERTY_TYPES.task.blockedBy.property);
          const dateRange = readDateRange(page, PROPERTY_TYPES.task.dateRange.property);
          const assignees = page.properties[PROPERTY_TYPES.task.assignee.property]?.people || [];
          const category = page.properties[PROPERTY_TYPES.task.category.property]?.multi_select || [];

          return {
            id: page.id,
            title: readTitle(page, PROPERTY_TYPES.task.title.property),
            uniqueId: readUniqueId(page, PROPERTY_TYPES.task.uniqueId.property),
            status,
            assignees: assignees.map(a => ({ id: a.id, name: a.name || null })),
            blockedBy: blockedByIds,
            dateRange,
            categories: category.map(c => c.name),
            epicId: null,
            epicUniqueId: null,
          };
        });

        if (config.userId) {
          orphanTasks = orphanTasks.filter(t =>
            t.assignees.some(a => a.id === config.userId)
          );
        }

        if (orphanTasks.length > 0) {
          const done = orphanTasks.filter(t => t.status === '완료').length;
          data.epics.push({
            id: null,
            title: '(에픽 없음)',
            uniqueId: null,
            status: null,
            taskIds: orphanTasks.map(t => t.id),
            tasks: orphanTasks,
            completionPct: orphanTasks.length > 0 ? Math.round((done / orphanTasks.length) * 100) : 0,
          });

          totalTasks += orphanTasks.length;
          completedTasks += done;
          blockedTasks += orphanTasks.filter(t => t.blockedBy.length > 0 && t.status !== '완료').length;
        }
      }
    } catch {
      // Orphan task fetch failed — proceed with epic-linked tasks only
    }

    return {
      sprint: data.sprint,
      epics: data.epics,
      summary: {
        totalTasks,
        completedTasks,
        blockedTasks,
        overallPct: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      },
    };
  } catch (error) {
    clearTimeout(timeout);
    process.stderr.write(`[codepresso] buildSprintContext error: ${error?.message || error}\n`);
    return null;
  }
}
