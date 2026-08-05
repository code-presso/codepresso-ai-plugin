#!/usr/bin/env node

/**
 * Codepresso evening Google Chat summary.
 * Gathers today's commits (root repo + submodules), merged/opened/closed PRs,
 * still-in-progress Notion tasks, and today's meetings; asks the local
 * `claude` CLI to write a topic-grouped narrative (not a PR-by-PR list);
 * sends via `gws`.
 *
 * Invoked Mon-Fri at 18:00 by the skill/cron; also runnable manually.
 * Usage: node daily-chat-summary.mjs
 */

import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { localDateStr } from './lib/dates.mjs';
import { loadConfig } from './lib/config.mjs';
import { createLogger } from './lib/logger.mjs';
import { getGitRoot } from './lib/git-utils.mjs';
import { fetchNotionTasksStructured } from './lib/notion-tasks.mjs';
import { sendChatMessage } from './lib/gws.mjs';
import { getMyTimedEvents, formatCalendarSection } from './lib/calendar.mjs';

const log = createLogger('daily-chat-summary');

function isWeekday() {
  const dow = new Date().getDay();
  return dow >= 1 && dow <= 5;
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

/** Today's commits per repo: root repo plus any submodules. */
function todaysCommitsByRepo(gitRoot, email) {
  if (!email) return {};
  const repos = ['.'];
  const subs = runSafe('git', ['-C', gitRoot, 'submodule', '--quiet', 'foreach', 'echo $sm_path']);
  if (subs) repos.push(...subs.split('\n').filter(Boolean));
  const since = `${localDateStr()} 00:00:00`;
  const byRepo = {};
  for (const repo of repos) {
    const out = runSafe('git', [
      '-C', join(gitRoot, repo),
      'log', '--all',
      `--author=${email}`,
      `--since=${since}`,
      '--pretty=format:%h|%s',
    ]);
    if (!out) continue;
    const label = repo === '.' ? basename(gitRoot) : repo;
    byRepo[label] = out.split('\n').map(line => {
      const idx = line.indexOf('|');
      return { sha: line.slice(0, idx), subject: line.slice(idx + 1) };
    });
  }
  return byRepo;
}

function allCommits(commitsByRepo) {
  return Object.values(commitsByRepo).flat();
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

function todaysPrs() {
  const day = localDateStr();
  const merged = ghSearchPrs([
    '--author', '@me',
    '--merged-at', day,
  ]);
  const mergedUrls = new Set(merged.map(p => p.url));
  const closedOnly = ghSearchPrs([
    '--author', '@me',
    '--state', 'closed',
    '--closed', day,
  ]).filter(p => !mergedUrls.has(p.url));
  const opened = ghSearchPrs([
    '--author', '@me',
    '--state', 'open',
    '--created', day,
  ]).filter(p => !mergedUrls.has(p.url));
  return { merged, closedOnly, opened };
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

function prShortRepo(pr) {
  return pr.repository?.name || '';
}

function buildClaudePrompt({ displayName, commitsByRepo, merged, opened, closedOnly, inProgress }) {
  const lines = [];
  lines.push('너는 개발자의 하루 마감 요약을 작성하는 조수야.');
  lines.push('아래 오늘의 활동 데이터를 바탕으로 Google Chat 메시지 본문을 한국어로 작성해.');
  lines.push('');
  lines.push('형식 규칙:');
  lines.push('- 맨 앞: 오늘의 성과를 2~3문장으로 요약한 인트로 (이모지 1개 포함)');
  lines.push('- 그다음: 주제별 섹션. 각 섹션은 `*N. 주제 제목*` 한 줄 뒤에 설명 1~3줄');
  lines.push('- PR과 커밋을 리포별로 나열하지 말고, 같은 기능/작업 단위(주제)로 묶어서 서술해');
  lines.push('- 여러 리포에 걸친 같은 작업(동일 제목 반복 커밋/PR)은 하나의 주제로 합쳐');
  lines.push('- 관련 PR은 repo#번호 형태로 짧게 언급하고, 오픈 상태 PR은 `→ 리뷰 대기: ...` 줄로 표시해');
  lines.push('- 사소한 잡일성 작업은 마지막 `*N. 기타*` 섹션에 한 줄씩 모아');
  lines.push('- 진행 중 Notion 작업이 오늘 활동과 이어지면 해당 주제 설명에 자연스럽게 언급해');
  lines.push('- 문체는 존댓말(-했어요/-입니다체)로 통일해');
  lines.push('- Google Chat 포맷: 굵게는 *한쪽 별표*, 불릿은 `•`. 마크다운 헤더(#)나 **는 금지');
  lines.push('- 인용구, 코드블록, 서두/말미 설명 없이 메시지 본문만 출력해');
  lines.push('');
  if (displayName) lines.push(`개발자: ${displayName}`);
  lines.push(`날짜: ${localDateStr()}`);
  lines.push('');
  lines.push('오늘의 커밋 (리포별):');
  const repos = Object.keys(commitsByRepo);
  if (repos.length === 0) {
    lines.push('- 없음');
  } else {
    for (const repo of repos) {
      const commits = commitsByRepo[repo];
      lines.push(`[${repo}]`);
      for (const c of commits.slice(0, 12)) lines.push(`- ${c.subject}`);
      if (commits.length > 12) lines.push(`- 외 ${commits.length - 12}건`);
    }
  }
  lines.push('');
  lines.push(`머지된 PR ${merged.length}개:`);
  if (merged.length === 0) {
    lines.push('- 없음');
  } else {
    for (const p of merged) lines.push(`- ${prShortRepo(p)}#${p.number} ${p.title}`);
  }
  lines.push('');
  lines.push(`오늘 연 PR (오픈 상태, 리뷰 대기) ${opened.length}개:`);
  if (opened.length === 0) {
    lines.push('- 없음');
  } else {
    for (const p of opened) lines.push(`- ${prShortRepo(p)}#${p.number} ${p.title}`);
  }
  lines.push('');
  lines.push(`닫힌(미머지) PR ${closedOnly.length}개:`);
  if (closedOnly.length === 0) {
    lines.push('- 없음');
  } else {
    for (const p of closedOnly) lines.push(`- ${prShortRepo(p)}#${p.number} ${p.title}`);
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

function formatPrLine(pr) {
  const repo = prRepo(pr);
  const prefix = repo ? `${repo}#${pr.number}` : `#${pr.number}`;
  return `• [${prefix}] ${pr.title}\n  → ${pr.url}`;
}

/** List-style body used when the claude CLI is unavailable. */
function fallbackBody({ commitsByRepo, merged, opened, closedOnly, inProgress }) {
  const commits = allCommits(commitsByRepo);
  const lines = [];

  const parts = [];
  if (merged.length) parts.push(`PR ${merged.length}개 머지`);
  if (commits.length) parts.push(`커밋 ${commits.length}건`);
  if (opened.length) parts.push(`새 PR ${opened.length}개`);
  lines.push(parts.length ? `오늘 ${parts.join(', ')}을 마쳤어요. 🌙` : '오늘은 기록된 활동이 없어요. 🌙');
  lines.push('');

  if (merged.length > 0) {
    lines.push(`*머지된 PR (${merged.length})*`);
    for (const p of merged) lines.push(formatPrLine(p));
    lines.push('');
  }
  if (opened.length > 0) {
    lines.push(`*리뷰 대기 PR (${opened.length})*`);
    for (const p of opened) lines.push(formatPrLine(p));
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

function runClaudeSummary(prompt) {
  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const out = execFileSync('claude', ['-p', prompt, '--model', 'haiku'], {
      timeout: 180000,
      encoding: 'utf-8',
      env,
    });
    return out.trim() || null;
  } catch (err) {
    log.warn(`claude CLI failed: ${err.message}`);
    return null;
  }
}

function formatMessage({ displayName, body, todaySection, tomorrowSection }) {
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const dayStr = weekdays[today.getDay()];

  const lines = [];
  if (displayName) {
    lines.push(`${displayName}님, 오늘 하루 수고하셨어요.`);
    lines.push('');
  }
  lines.push(`📝 *${dateStr} (${dayStr})* 마감 요약 — 주제별`);
  lines.push('');
  lines.push(body);

  if (todaySection) {
    lines.push('');
    lines.push(todaySection);
  }
  if (tomorrowSection) {
    lines.push('');
    lines.push(tomorrowSection);
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

  const commitsByRepo = todaysCommitsByRepo(gitRoot, email);
  const { merged, closedOnly, opened } = todaysPrs();

  let inProgress = [];
  try {
    const notion = await fetchNotionTasksStructured();
    if (notion?.tasks) inProgress = inProgressTasks(notion.tasks);
  } catch (err) {
    log.warn(`Notion fetch failed: ${err.message}`);
  }

  const todayMeetings = getMyTimedEvents({ when: 'today', config });
  const tomorrowMeetings = getMyTimedEvents({ when: 'tomorrow', config });
  const todaySection = formatCalendarSection(todayMeetings, { title: `오늘 참석한 미팅 (${todayMeetings.length})` });
  const tomorrowSection = formatCalendarSection(tomorrowMeetings, { title: '내일 일정' });

  const commitCount = allCommits(commitsByRepo).length;
  const hasAnything = commitCount || merged.length || closedOnly.length || opened.length
    || inProgress.length || todayMeetings.length || tomorrowMeetings.length;
  if (!hasAnything) {
    log.info('No activity to summarize — skipping');
    return;
  }

  const prompt = buildClaudePrompt({ displayName, commitsByRepo, merged, opened, closedOnly, inProgress });
  const body = runClaudeSummary(prompt)
    || fallbackBody({ commitsByRepo, merged, opened, closedOnly, inProgress });

  const message = formatMessage({ displayName, body, todaySection, tomorrowSection });

  if (process.env.CODEPRESSO_DRY_RUN) {
    process.stdout.write(`----- DRY RUN (no gws call) -----\n${message}\n----- END -----\n`);
    return;
  }

  try {
    sendChatMessage(spaceId, message);
    log.info(`Daily summary sent to spaces/${spaceId}`);
  } catch (err) {
    log.error(`Failed to send Google Chat message: ${err.message}`);
  }
}

main();
