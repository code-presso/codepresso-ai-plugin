import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig } from './config.mjs';

const ANALYTICS_DIR = join(homedir(), '.codepresso', 'analytics');
const SESSIONS_FILE = join(ANALYTICS_DIR, 'sessions.jsonl');

/**
 * Ensure analytics directory exists.
 */
function ensureDir() {
  try {
    mkdirSync(ANALYTICS_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

/**
 * Append a record to the analytics JSONL file.
 * @param {object} record
 */
function appendRecord(record) {
  const config = loadConfig();
  if (config.analytics?.enabled === false) return;

  ensureDir();
  const line = JSON.stringify({ ...record, timestamp: record.timestamp || new Date().toISOString() });
  appendFileSync(SESSIONS_FILE, line + '\n', 'utf-8');
}

/**
 * Record a batch flush with prompt scores.
 * @param {{ sessionId: string, branch: string, prNumber?: number, scores: (number|null)[], promptCount: number }} data
 */
export function recordFlush(data) {
  const validScores = (data.scores || []).filter(s => s !== null);
  const avg = validScores.length > 0
    ? validScores.reduce((a, b) => a + b, 0) / validScores.length
    : null;

  appendRecord({
    recordType: 'flush',
    sessionId: data.sessionId,
    branch: data.branch,
    prNumber: data.prNumber || null,
    promptCount: data.promptCount || data.scores?.length || 0,
    scores: data.scores || [],
    avgScore: avg !== null ? Math.round(avg * 10) / 10 : null,
    minScore: validScores.length > 0 ? Math.min(...validScores) : null,
    maxScore: validScores.length > 0 ? Math.max(...validScores) : null,
    scoreTiers: computeScoreTiers(data.scores || []),
  });
}

/**
 * Record a git commit.
 * @param {{ sessionId: string, branch: string, prNumber?: number, commitHash: string, commitMessage: string }} data
 */
export function recordGitCommit(data) {
  appendRecord({
    recordType: 'git_commit',
    sessionId: data.sessionId,
    branch: data.branch,
    prNumber: data.prNumber || null,
    commitHash: data.commitHash,
    commitMessage: data.commitMessage,
  });
}

/**
 * Record a git push.
 * @param {{ sessionId: string, branch: string, prNumber?: number }} data
 */
export function recordGitPush(data) {
  appendRecord({
    recordType: 'git_push',
    sessionId: data.sessionId,
    branch: data.branch,
    prNumber: data.prNumber || null,
  });
}

/**
 * Record session end with duration.
 * @param {{ sessionId: string, branch?: string, prNumber?: number, startedAt: string, endedAt?: string }} data
 */
export function recordSessionEnd(data) {
  const endedAt = data.endedAt || new Date().toISOString();
  const startMs = new Date(data.startedAt).getTime();
  const endMs = new Date(endedAt).getTime();
  const durationMinutes = Math.round((endMs - startMs) / 60000);

  appendRecord({
    recordType: 'session_end',
    sessionId: data.sessionId,
    branch: data.branch || null,
    prNumber: data.prNumber || null,
    startedAt: data.startedAt,
    endedAt,
    durationMinutes: durationMinutes > 0 ? durationMinutes : 0,
  });
}

/**
 * Record a QA report for analytics.
 * @param {{ sessionId: string, branch?: string, prNumber?: number, overallScore: number|null, dimensionScores: Record<string, number|null>, filesChanged: number, linesAdded: number, linesRemoved: number }} data
 */
export function recordQaReport(data) {
  appendRecord({
    recordType: 'qa_report',
    sessionId: data.sessionId,
    branch: data.branch || null,
    prNumber: data.prNumber || null,
    overallScore: data.overallScore ?? null,
    dimensionScores: data.dimensionScores || {},
    filesChanged: data.filesChanged || 0,
    linesAdded: data.linesAdded || 0,
    linesRemoved: data.linesRemoved || 0,
  });
}

/**
 * Categorize scores into tiers.
 * @param {(number|null)[]} scores
 * @returns {{ excellent: number, good: number, warning: number, poor: number }}
 */
export function computeScoreTiers(scores) {
  const tiers = { excellent: 0, good: 0, warning: 0, poor: 0 };
  for (const s of scores) {
    if (s === null || s === undefined) continue;
    if (s >= 8) tiers.excellent++;
    else if (s >= 5) tiers.good++;
    else if (s >= 3) tiers.warning++;
    else tiers.poor++;
  }
  return tiers;
}

/**
 * Read analytics records with optional filters.
 * @param {{ since?: string, until?: string, recordType?: string, retentionDays?: number }} filters
 * @returns {object[]}
 */
export function readRecords(filters = {}) {
  let records;
  try {
    const content = readFileSync(SESSIONS_FILE, 'utf-8').trim();
    if (!content) return [];
    records = content.split('\n').map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }

  // Apply retention filter
  const retentionDays = filters.retentionDays ?? 90;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  records = records.filter(r => r.timestamp >= cutoff);

  // Apply date range filters
  if (filters.since) {
    records = records.filter(r => r.timestamp >= filters.since);
  }
  if (filters.until) {
    records = records.filter(r => r.timestamp <= filters.until);
  }

  // Apply recordType filter
  if (filters.recordType) {
    records = records.filter(r => r.recordType === filters.recordType);
  }

  return records;
}

/**
 * Group records by sessionId and merge flush/git/end records into session objects.
 * @param {object[]} records
 * @returns {object[]} Array of session objects sorted by first timestamp
 */
export function aggregateSessions(records) {
  const sessions = new Map();

  for (const r of records) {
    if (!r.sessionId) continue;
    if (!sessions.has(r.sessionId)) {
      sessions.set(r.sessionId, {
        sessionId: r.sessionId,
        branch: r.branch || null,
        prNumber: r.prNumber || null,
        firstSeen: r.timestamp,
        lastSeen: r.timestamp,
        promptCount: 0,
        allScores: [],
        commits: 0,
        pushes: 0,
        durationMinutes: null,
        startedAt: null,
        endedAt: null,
        qaScore: null,
        qaDimensions: null,
      });
    }

    const s = sessions.get(r.sessionId);
    if (r.timestamp < s.firstSeen) s.firstSeen = r.timestamp;
    if (r.timestamp > s.lastSeen) s.lastSeen = r.timestamp;
    if (r.branch && !s.branch) s.branch = r.branch;
    if (r.prNumber && !s.prNumber) s.prNumber = r.prNumber;

    switch (r.recordType) {
      case 'flush':
        s.promptCount += r.promptCount || 0;
        if (r.scores) s.allScores.push(...r.scores.filter(x => x !== null));
        break;
      case 'git_commit':
        s.commits++;
        break;
      case 'git_push':
        s.pushes++;
        break;
      case 'session_end':
        s.durationMinutes = r.durationMinutes;
        s.startedAt = r.startedAt;
        s.endedAt = r.endedAt;
        break;
      case 'qa_report':
        s.qaScore = r.overallScore;
        s.qaDimensions = r.dimensionScores;
        break;
    }
  }

  // Compute avg score per session
  const result = [];
  for (const s of sessions.values()) {
    s.avgScore = s.allScores.length > 0
      ? Math.round((s.allScores.reduce((a, b) => a + b, 0) / s.allScores.length) * 10) / 10
      : null;
    delete s.allScores;
    result.push(s);
  }

  return result.sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
}

/**
 * Compute this-period vs last-period trend comparison.
 * @param {object[]} sessions - Output from aggregateSessions
 * @param {number} [periodDays=7] - Period length in days
 * @returns {{ current: object, previous: object, deltas: object }}
 */
export function computeTrends(sessions, periodDays = 7) {
  const now = Date.now();
  const periodMs = periodDays * 24 * 60 * 60 * 1000;
  const currentStart = new Date(now - periodMs).toISOString();
  const previousStart = new Date(now - 2 * periodMs).toISOString();

  const current = sessions.filter(s => s.firstSeen >= currentStart);
  const previous = sessions.filter(s => s.firstSeen >= previousStart && s.firstSeen < currentStart);

  function summarize(list) {
    const totalPrompts = list.reduce((sum, s) => sum + s.promptCount, 0);
    const totalCommits = list.reduce((sum, s) => sum + s.commits, 0);
    const totalPushes = list.reduce((sum, s) => sum + s.pushes, 0);
    const allScoreAvgs = list.filter(s => s.avgScore !== null).map(s => s.avgScore);
    const avgScore = allScoreAvgs.length > 0
      ? Math.round((allScoreAvgs.reduce((a, b) => a + b, 0) / allScoreAvgs.length) * 10) / 10
      : null;
    const totalDuration = list.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

    return {
      sessions: list.length,
      prompts: totalPrompts,
      commits: totalCommits,
      pushes: totalPushes,
      avgScore,
      totalDurationMinutes: totalDuration,
    };
  }

  const cur = summarize(current);
  const prev = summarize(previous);

  function delta(a, b) {
    if (b === 0 || b === null) return a > 0 ? '+100%' : '—';
    if (a === null) return '—';
    const pct = Math.round(((a - b) / b) * 100);
    return pct >= 0 ? `+${pct}%` : `${pct}%`;
  }

  return {
    current: cur,
    previous: prev,
    deltas: {
      sessions: delta(cur.sessions, prev.sessions),
      prompts: delta(cur.prompts, prev.prompts),
      commits: delta(cur.commits, prev.commits),
      avgScore: delta(cur.avgScore, prev.avgScore),
    },
  };
}
