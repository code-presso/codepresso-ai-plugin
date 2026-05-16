#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  loadSeen, markSeen,
  readCandidates, appendCandidates, removeCandidatesByIds,
  loadSchemaCache, saveSchemaCache,
} from './lib/inbox-state.mjs';
import { loadConfig } from './lib/config.mjs';
import { redactSecrets } from './lib/redactor.mjs';

const cwd = process.cwd();

function readStdin() {
  try {
    return readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

function parseJsonStdin() {
  const raw = readStdin();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`inbox-cli: invalid JSON on stdin: ${err.message}\n`);
    process.exit(2);
  }
}

const cmd = process.argv[2];

switch (cmd) {
  case 'prep': {
    const config = loadConfig(cwd);
    process.stdout.write(JSON.stringify({
      seen: loadSeen(cwd),
      leftovers: readCandidates(cwd),
      config: config.inbox || {},
      notion: { taskDb: config.notion?.databases?.task || null, userId: config.notion?.userId || null },
    }, null, 2));
    break;
  }
  case 'redact': {
    const text = readStdin();
    const config = loadConfig(cwd);
    const extra = config.redaction?.extraPatterns || [];
    process.stdout.write(redactSecrets(text, extra));
    break;
  }
  case 'stage': {
    const { candidates = [], sourceIds = {} } = parseJsonStdin();
    appendCandidates(cwd, candidates);
    if (sourceIds.gmail?.length) markSeen(cwd, 'gmail', sourceIds.gmail);
    if (sourceIds.chat?.length) markSeen(cwd, 'chat', sourceIds.chat);
    process.stdout.write(JSON.stringify({ staged: candidates.length }));
    break;
  }
  case 'complete': {
    const { accepted = [], rejected = [] } = parseJsonStdin();
    removeCandidatesByIds(cwd, [...accepted, ...rejected]);
    process.stdout.write(JSON.stringify({ removed: accepted.length + rejected.length }));
    break;
  }
  case 'schema-cache': {
    const sub = process.argv[3];
    if (sub === 'get') {
      const cache = loadSchemaCache(cwd);
      process.stdout.write(JSON.stringify(cache, null, 2));
    } else if (sub === 'set') {
      saveSchemaCache(cwd, parseJsonStdin());
      process.stdout.write('{"ok":true}');
    } else {
      process.stderr.write('schema-cache requires get|set\n');
      process.exit(2);
    }
    break;
  }
  default:
    process.stderr.write(`Usage: inbox-cli <prep|redact|stage|complete|schema-cache>\n`);
    process.exit(2);
}
