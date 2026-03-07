#!/usr/bin/env node

/**
 * Codepresso daily Google Chat greeting — detached process.
 * Reads a temp payload file with Notion tasks, formats a message,
 * and sends it to a Google Chat space via the `gws` CLI (as the authenticated user).
 *
 * Spawned by session-start.mjs on the first session of each day.
 * Usage: node daily-chat-greeting.mjs <payload-file-path>
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createLogger } from './lib/logger.mjs';

const log = createLogger('daily-chat-greeting');
const GREETING_STATE_FILE = join(homedir(), '.codepresso', 'daily-greeting.json');

/**
 * Check if a task status represents a completed state.
 */
function isCompleted(status) {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  return s === '완료' || s === 'done' || s === 'completed';
}

/**
 * Check if a task status represents "in progress".
 */
function isInProgress(status) {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  return s === '진행 중' || s === 'in progress' || s === 'in_progress';
}

/**
 * Generate a daily motivational phrase using the local `claude` CLI.
 * Falls back to a simple greeting if the CLI call fails.
 */
function generateDailyPhrase(taskCount) {
  try {
    const today = new Date();
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const dayStr = weekdays[today.getDay()];

    const prompt = `오늘은 ${dayStr}요일이고, 개발자가 ${taskCount}개의 작업을 진행 중이야. 이 상황에 맞는 짧고 따뜻한 응원 한마디를 해줘. 한국어로 1~2문장, 이모지 하나 포함. 인용구나 설명 없이 문장만 출력해.`;

    const env = { ...process.env };
    delete env.CLAUDECODE;
    const result = execFileSync('claude', ['-p', prompt, '--model', 'haiku'], {
      timeout: 15000,
      encoding: 'utf-8',
      env,
    });

    return result.trim() || '오늘도 화이팅!';
  } catch {
    return '오늘도 화이팅!';
  }
}

/**
 * Build a Notion page URL from a page ID.
 */
function notionUrl(pageId) {
  return `https://notion.so/${pageId.replace(/-/g, '')}`;
}

/**
 * Format a single task line with Notion link.
 */
function formatTaskLine(t) {
  if (t.uniqueId && t.id) {
    return `• <${notionUrl(t.id)}|[${t.uniqueId}]> ${t.title}`;
  }
  const id = t.uniqueId ? `[${t.uniqueId}] ` : '';
  return `• ${id}${t.title}`;
}

/**
 * Format the Google Chat message from tasks.
 */
function formatMessage(tasks, displayName) {
  const inProgress = tasks.filter(t => isInProgress(t.status));

  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const dayStr = weekdays[today.getDay()];

  const lines = [];

  if (displayName) {
    lines.push(`${displayName}님,`);
    lines.push('');
  }

  lines.push(`📋 *${dateStr} (${dayStr})* 진행 중인 작업`);
  lines.push('');

  if (inProgress.length > 0) {
    for (const t of inProgress) {
      lines.push(formatTaskLine(t));
    }
    lines.push('');
    lines.push(`총 ${inProgress.length}개 작업 진행 중`);
  } else {
    lines.push('진행 중인 작업이 없습니다.');
  }

  const phrase = generateDailyPhrase(inProgress.length);
  lines.push('');
  lines.push(`💬 _${phrase}_`);

  return lines.join('\n');
}

/**
 * Update the daily greeting state file with today's date.
 */
function updateLastDate() {
  try {
    mkdirSync(join(homedir(), '.codepresso'), { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(GREETING_STATE_FILE, JSON.stringify({ lastDate: today }, null, 2), 'utf-8');
  } catch (err) {
    log.error(`Failed to update daily-greeting state: ${err.message}`);
  }
}

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    log.error('No payload file path provided');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(readFileSync(payloadPath, 'utf-8'));
  } catch (err) {
    log.error(`Failed to read payload: ${err.message}`);
    process.exit(1);
  }

  // Clean up temp payload file
  try {
    unlinkSync(payloadPath);
  } catch {
    // ignore
  }

  const { tasks, spaceId, displayName } = payload;

  if (!tasks || tasks.length === 0) {
    log.info('No tasks to report — skipping greeting');
    updateLastDate();
    return;
  }

  if (!spaceId) {
    log.error('No spaceId configured — skipping greeting');
    updateLastDate();
    return;
  }

  // Filter out completed tasks
  const activeTasks = tasks.filter(t => !isCompleted(t.status));
  if (activeTasks.length === 0) {
    log.info('All tasks completed — skipping greeting');
    updateLastDate();
    return;
  }

  const message = formatMessage(activeTasks, displayName);

  try {
    const params = JSON.stringify({ parent: `spaces/${spaceId}` });
    const body = JSON.stringify({ text: message });

    // Use execFileSync to pass args directly without shell escaping issues
    execFileSync('gws', [
      'chat', 'spaces', 'messages', 'create',
      '--params', params,
      '--json', body,
    ], { timeout: 15000, stdio: 'ignore' });

    log.info(`Daily greeting sent to spaces/${spaceId}`);
  } catch (err) {
    log.error(`Failed to send Google Chat message: ${err.message}`);
  }

  updateLastDate();
}

main();
