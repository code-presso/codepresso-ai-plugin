import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const PRUNE_DAYS = 30;

function stateDir(cwd) {
  return join(cwd, '.codepresso', 'state');
}

function seenPath(cwd) {
  return join(stateDir(cwd), 'codepresso-inbox-seen.json');
}

function readJsonSafe(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${randomUUID()}`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best-effort */ }
    throw err;
  }
}

export function loadSeen(cwd) {
  return readJsonSafe(seenPath(cwd), { gmail: [], chat: [], lastScannedAt: null });
}

export function saveSeen(cwd, seen) {
  const cutoff = Date.now() - PRUNE_DAYS * 86400 * 1000;
  const prune = (entries) => (entries || []).filter((e) => {
    const at = e?.at ? Date.parse(e.at) : 0;
    return at >= cutoff;
  });
  writeJsonAtomic(seenPath(cwd), {
    gmail: prune(seen.gmail),
    chat: prune(seen.chat),
    lastScannedAt: seen.lastScannedAt || null,
  });
}

export function markSeen(cwd, source, ids) {
  if (!ids?.length) return;
  const seen = loadSeen(cwd);
  if (!Array.isArray(seen[source])) {
    throw new Error(`markSeen: unknown source "${source}". Expected "gmail" or "chat".`);
  }
  const existing = new Set(seen[source].map((e) => e.id));
  const at = new Date().toISOString();
  for (const id of ids) {
    if (!existing.has(id)) {
      seen[source].push({ id, at });
      existing.add(id);
    }
  }
  seen.lastScannedAt = at;
  saveSeen(cwd, seen);
}

function candidatesPath(cwd) {
  return join(stateDir(cwd), 'codepresso-inbox-candidates.jsonl');
}

export function appendCandidates(cwd, candidates) {
  if (!candidates?.length) return;
  mkdirSync(stateDir(cwd), { recursive: true });
  const lines = candidates.map((c) => JSON.stringify(c)).join('\n') + '\n';
  appendFileSync(candidatesPath(cwd), lines, 'utf-8');
}

export function readCandidates(cwd) {
  const path = candidatesPath(cwd);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function removeCandidatesByIds(cwd, ids) {
  if (!ids?.length) return;
  const toRemove = new Set(ids);
  const kept = readCandidates(cwd).filter((c) => !toRemove.has(c.id));
  const path = candidatesPath(cwd);
  mkdirSync(stateDir(cwd), { recursive: true });
  if (kept.length === 0) {
    writeFileSync(path, '', 'utf-8');
    return;
  }
  const body = kept.map((c) => JSON.stringify(c)).join('\n') + '\n';
  const tmp = `${path}.tmp.${randomUUID()}`;
  try {
    writeFileSync(tmp, body, 'utf-8');
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best-effort */ }
    throw err;
  }
}
