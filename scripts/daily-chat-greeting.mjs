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
 * Fetch the user's open PRs and PRs awaiting their review via `gh`.
 * Returns `{ authored: [...], reviewRequested: [...] }`. Errors swallowed to [].
 */
function fetchGithubPrs(gitRoot) {
  const opts = { timeout: 8000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] };
  if (gitRoot) opts.cwd = gitRoot;

  const runJson = (args) => {
    try {
      const out = execFileSync('gh', args, opts);
      return JSON.parse(out.trim() || '[]');
    } catch {
      return [];
    }
  };

  const fields = 'number,title,url,repository,isDraft';
  const authored = runJson([
    'search', 'prs',
    '--state', 'open',
    '--author', '@me',
    '--limit', '20',
    '--json', fields,
  ]);
  const reviewRequested = runJson([
    'search', 'prs',
    '--state', 'open',
    '--review-requested', '@me',
    '--limit', '20',
    '--json', fields,
  ]);
  return { authored, reviewRequested };
}

function formatPrLine(pr) {
  const repo = pr.repository?.nameWithOwner || pr.repository?.name || '';
  const draft = pr.isDraft ? ' _(draft)_' : '';
  const prefix = repo ? `${repo}#${pr.number}` : `#${pr.number}`;
  return `• [${prefix}] ${pr.title}${draft}\n  → ${pr.url}`;
}

/**
 * Pick a random fallback phrase based on day-of-year for variety.
 */
function fallbackPhrase() {
  const phrases = [
    '오늘도 화이팅! 💪',
    '한 걸음씩 꾸준히, 오늘도 멋진 하루 되세요! 🚀',
    '좋은 코드는 좋은 하루에서 시작돼요! ☀️',
    '오늘의 커밋이 내일의 성과가 됩니다! 🎯',
    '집중해서 하나씩 해결해봐요! 🔥',
    '작은 진전도 큰 변화의 시작이에요! 🌱',
    '오늘도 즐겁게 코딩해요! 😊',
  ];
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  return phrases[dayOfYear % phrases.length];
}

/**
 * Generate a daily motivational phrase using the local `claude` CLI.
 * Falls back to a day-rotating phrase if the CLI call fails.
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
      timeout: 30000,
      encoding: 'utf-8',
      env,
    });

    return result.trim() || fallbackPhrase();
  } catch {
    return fallbackPhrase();
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
 * Google Chat auto-linkifies plain URLs in text messages.
 */
function formatTaskLine(t) {
  const id = t.uniqueId ? `[${t.uniqueId}] ` : '';
  const link = t.id ? `\n  → ${notionUrl(t.id)}` : '';
  return `• ${id}${t.title}${link}`;
}

/**
 * Format the Google Chat message from tasks and GitHub PRs.
 */
function formatMessage(tasks, prs, displayName) {
  const inProgress = tasks.filter(t => isInProgress(t.status));
  const authored = prs?.authored || [];
  const reviewRequested = prs?.reviewRequested || [];

  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const dayStr = weekdays[today.getDay()];

  const lines = [];

  if (displayName) {
    lines.push(`${displayName}님,`);
    lines.push('');
  }

  lines.push(`📋 *${dateStr} (${dayStr})* 오늘의 작업 현황`);
  lines.push('');

  lines.push('*진행 중인 작업 (Notion):*');
  if (inProgress.length > 0) {
    for (const t of inProgress) lines.push(formatTaskLine(t));
  } else {
    lines.push('_없음_');
  }
  lines.push('');

  lines.push('*내가 작성한 열린 PR:*');
  if (authored.length > 0) {
    for (const pr of authored) lines.push(formatPrLine(pr));
  } else {
    lines.push('_없음_');
  }
  lines.push('');

  lines.push('*리뷰 요청 받은 PR:*');
  if (reviewRequested.length > 0) {
    for (const pr of reviewRequested) lines.push(formatPrLine(pr));
  } else {
    lines.push('_없음_');
  }
  lines.push('');

  const summary = `총 작업 ${inProgress.length}개 · 내 PR ${authored.length}개 · 리뷰 대기 ${reviewRequested.length}개`;
  lines.push(summary);

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

  const { tasks, spaceId, displayName, gitRoot } = payload;

  if (!spaceId) {
    log.error('No spaceId configured — skipping greeting');
    updateLastDate();
    return;
  }

  const activeTasks = (tasks || []).filter(t => !isCompleted(t.status));
  const prs = fetchGithubPrs(gitRoot);

  const hasContent = activeTasks.length > 0
    || (prs.authored && prs.authored.length > 0)
    || (prs.reviewRequested && prs.reviewRequested.length > 0);

  if (!hasContent) {
    log.info('No tasks or PRs to report — skipping greeting');
    updateLastDate();
    return;
  }

  const message = formatMessage(activeTasks, prs, displayName);

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
