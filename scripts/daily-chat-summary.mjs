#!/usr/bin/env node

/**
 * Codepresso evening Google Chat summary.
 * Gathers today's commits, merged/closed PRs, and still-in-progress Notion
 * tasks; asks the local `claude` CLI to summarize; sends via `gws`.
 *
 * Invoked Mon-Fri at 18:00 by the skill/cron; also runnable manually.
 * Usage: node daily-chat-summary.mjs
 */

import { execFileSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';
import { createLogger } from './lib/logger.mjs';
import { getGitRoot } from './lib/git-utils.mjs';
import { fetchNotionTasksStructured } from './lib/notion-tasks.mjs';

const log = createLogger('daily-chat-summary');

function isWeekday() {
  const dow = new Date().getDay();
  return dow >= 1 && dow <= 5;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function todayLocalDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function runSafe(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      timeout: 10000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      ...opts,
    }).trim();
  } catch {
    return '';
  }
}

function gitAuthorEmail(cwd) {
  return runSafe('git', ['config', 'user.email'], { cwd }) || null;
}

function todaysCommits(cwd, email) {
  if (!email) return [];
  const since = `${todayLocalDateStr()} 00:00:00`;
  const out = runSafe('git', [
    'log', '--all',
    `--author=${email}`,
    `--since=${since}`,
    '--pretty=format:%h|%s',
  ], { cwd });
  if (!out) return [];
  return out.split('\n').map(line => {
    const idx = line.indexOf('|');
    return {
      sha: line.slice(0, idx),
      subject: line.slice(idx + 1),
    };
  });
}

function ghSearchPrs(args) {
  const out = runSafe('gh', [
    'search', 'prs',
    ...args,
    '--limit', '30',
    '--json', 'number,title,url,repository,state',
  ]);
  if (!out) return [];
  try {
    return JSON.parse(out);
  } catch {
    return [];
  }
}

function todaysClosedPrs() {
  const day = todayIso();
  const merged = ghSearchPrs([
    '--author', '@me',
    '--merged-at', day,
  ]);
  const closed = ghSearchPrs([
    '--author', '@me',
    '--state', 'closed',
    '--closed', day,
  ]);
  const seen = new Set(merged.map(p => p.url));
  const closedOnly = closed.filter(p => !seen.has(p.url));
  return { merged, closedOnly };
}

function inProgressTasks(tasks) {
  return tasks.filter(t => {
    const s = (t.status || '').toLowerCase().trim();
    return s === '진행 중' || s === 'in progress' || s === 'in_progress';
  });
}

function prRepo(pr) {
  return pr.repository?.nameWithOwner || pr.repository?.name || '';
}

function buildClaudePrompt({ displayName, commits, merged, closedOnly, inProgress }) {
  const lines = [];
  lines.push('너는 개발자의 하루 요약을 작성하는 조수야.');
  lines.push('아래 오늘의 활동 데이터를 바탕으로 한국어로 2~4문장 요약을 해줘.');
  lines.push('이모지 하나만 포함하고, 인용구나 추가 설명 없이 문장만 출력해.');
  lines.push('성과 위주로, 남은 진행 중 작업도 한 줄로 언급해.');
  lines.push('');
  if (displayName) lines.push(`개발자: ${displayName}`);
  lines.push(`날짜: ${todayLocalDateStr()}`);
  lines.push('');
  lines.push(`커밋 ${commits.length}개:`);
  if (commits.length === 0) {
    lines.push('- 없음');
  } else {
    for (const c of commits.slice(0, 15)) lines.push(`- ${c.subject}`);
    if (commits.length > 15) lines.push(`- 외 ${commits.length - 15}건`);
  }
  lines.push('');
  lines.push(`머지된 PR ${merged.length}개:`);
  if (merged.length === 0) {
    lines.push('- 없음');
  } else {
    for (const p of merged) lines.push(`- ${prRepo(p)}#${p.number} ${p.title}`);
  }
  lines.push('');
  lines.push(`닫힌(미머지) PR ${closedOnly.length}개:`);
  if (closedOnly.length === 0) {
    lines.push('- 없음');
  } else {
    for (const p of closedOnly) lines.push(`- ${prRepo(p)}#${p.number} ${p.title}`);
  }
  lines.push('');
  lines.push(`진행 중 Notion 작업 ${inProgress.length}개:`);
  if (inProgress.length === 0) {
    lines.push('- 없음');
  } else {
    for (const t of inProgress) {
      const id = t.uniqueId ? `[${t.uniqueId}] ` : '';
      lines.push(`- ${id}${t.title}`);
    }
  }
  return lines.join('\n');
}

function fallbackSummary({ commits, merged, closedOnly, inProgress }) {
  const parts = [];
  if (merged.length) parts.push(`PR ${merged.length}개 머지`);
  if (commits.length) parts.push(`커밋 ${commits.length}건`);
  if (closedOnly.length) parts.push(`닫힌 PR ${closedOnly.length}개`);
  const head = parts.length ? `오늘 ${parts.join(', ')}을 마쳤어요.` : '오늘은 기록된 활동이 없어요.';
  const tail = inProgress.length
    ? `진행 중 작업 ${inProgress.length}건은 내일 이어서 진행해요. 🌙`
    : '푹 쉬고 내일 봐요. 🌙';
  return `${head} ${tail}`;
}

function runClaudeSummary(prompt) {
  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const out = execFileSync('claude', ['-p', prompt, '--model', 'haiku'], {
      timeout: 60000,
      encoding: 'utf-8',
      env,
    });
    return out.trim() || null;
  } catch (err) {
    log.warn(`claude CLI failed: ${err.message}`);
    return null;
  }
}

function formatPrLine(pr) {
  const repo = prRepo(pr);
  const prefix = repo ? `${repo}#${pr.number}` : `#${pr.number}`;
  return `• [${prefix}] ${pr.title}\n  → ${pr.url}`;
}

function formatMessage({ displayName, summary, commits, merged, closedOnly, inProgress }) {
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const dayStr = weekdays[today.getDay()];

  const lines = [];
  if (displayName) {
    lines.push(`${displayName}님, 오늘 하루 수고하셨어요.`);
    lines.push('');
  }
  lines.push(`📝 *${dateStr} (${dayStr})* 마감 요약`);
  lines.push('');
  lines.push(summary);
  lines.push('');

  if (merged.length > 0) {
    lines.push(`*머지된 PR (${merged.length})*`);
    for (const p of merged) lines.push(formatPrLine(p));
    lines.push('');
  }

  if (closedOnly.length > 0) {
    lines.push(`*닫힌 PR (${closedOnly.length})*`);
    for (const p of closedOnly) lines.push(formatPrLine(p));
    lines.push('');
  }

  if (commits.length > 0) {
    lines.push(`*오늘의 커밋 (${commits.length})*`);
    for (const c of commits.slice(0, 10)) lines.push(`• \`${c.sha}\` ${c.subject}`);
    if (commits.length > 10) lines.push(`_외 ${commits.length - 10}건_`);
    lines.push('');
  }

  if (inProgress.length > 0) {
    lines.push(`*내일 이어서 할 작업 (${inProgress.length})*`);
    for (const t of inProgress) {
      const id = t.uniqueId ? `[${t.uniqueId}] ` : '';
      lines.push(`• ${id}${t.title}`);
    }
  }

  return lines.join('\n').trim();
}

async function main() {
  if (!isWeekday()) {
    log.info('Weekend — skipping evening summary');
    return;
  }

  const config = loadConfig();

  if (!config.googleChat?.enabled) {
    log.info('Google Chat disabled — skipping');
    return;
  }
  const spaceId = config.googleChat?.spaceId;
  if (!spaceId) {
    log.error('No spaceId configured — skipping');
    return;
  }

  const gitRoot = getGitRoot() || process.cwd();
  const email = gitAuthorEmail(gitRoot);
  const displayName = config.notion?.displayName || null;

  const commits = todaysCommits(gitRoot, email);
  const { merged, closedOnly } = todaysClosedPrs();

  let inProgress = [];
  try {
    const notion = await fetchNotionTasksStructured();
    if (notion?.tasks) inProgress = inProgressTasks(notion.tasks);
  } catch (err) {
    log.warn(`Notion fetch failed: ${err.message}`);
  }

  const hasAnything = commits.length || merged.length || closedOnly.length || inProgress.length;
  if (!hasAnything) {
    log.info('No activity to summarize — skipping');
    return;
  }

  const prompt = buildClaudePrompt({ displayName, commits, merged, closedOnly, inProgress });
  const summary = runClaudeSummary(prompt)
    || fallbackSummary({ commits, merged, closedOnly, inProgress });

  const message = formatMessage({ displayName, summary, commits, merged, closedOnly, inProgress });

  if (process.env.CODEPRESSO_DRY_RUN) {
    process.stdout.write(`----- DRY RUN (no gws call) -----\n${message}\n----- END -----\n`);
    return;
  }

  try {
    const params = JSON.stringify({ parent: `spaces/${spaceId}` });
    const body = JSON.stringify({ text: message });
    execFileSync('gws', [
      'chat', 'spaces', 'messages', 'create',
      '--params', params,
      '--json', body,
    ], { timeout: 15000, stdio: 'ignore' });
    log.info(`Daily summary sent to spaces/${spaceId}`);
  } catch (err) {
    log.error(`Failed to send Google Chat message: ${err.message}`);
  }
}

main();
