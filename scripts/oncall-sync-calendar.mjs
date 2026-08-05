#!/usr/bin/env node
// Deterministic DDB → Google Calendar reconciliation for the on-call schedule.
//
// Why this exists: the allocator Lambda's service account is external to the
// codepresso.kr Workspace, and the org's external-sharing policy caps it to
// read-only on the shared calendar — so the Lambda can write DDB + chat but
// not calendar events. This script runs as the calendar owner via the local
// `gws` CLI (Windows Task Scheduler: 1st of month 18:10 KST, after the
// 18:00 KST Lambda run) and reconciles the calendar to match DynamoDB.
// Idempotent: skips weeks whose event already matches.
//
// Usage: node scripts/oncall-sync-calendar.mjs [YYYY-MM ...]
//        (no args = current month + next month)

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { localDateStr } from "./lib/dates.mjs";

const TABLE = "oncall-assignments-history";
const REGION = "ap-northeast-2";
const CALENDAR_ID =
  "c_b96d007ccd3a348ceab92e4d7cab4be4ae91197da9f383a7a7bb0e4bd74f12f1@group.calendar.google.com";

function run(cmd, args) {
  // shell:false so args with spaces/parens/Korean pass through unmangled
  return execFileSync(cmd, args, { encoding: "utf8" });
}

// gws is an npm .cmd shim, which Node >=20 refuses to spawn directly (EINVAL).
// Resolve the underlying JS entry and run it with the current node binary.
function gwsCommand() {
  if (process.platform !== "win32") return { cmd: "gws", preArgs: [] };
  const require = createRequire(import.meta.url);
  const entry = require.resolve("@googleworkspace/cli/run-gws.js", {
    paths: [path.join(process.env.APPDATA ?? "", "npm", "node_modules")],
  });
  return { cmd: process.execPath, preArgs: [entry] };
}
const GWS = gwsCommand();

function gwsJson(args) {
  const out = run(GWS.cmd, [...GWS.preArgs, ...args]);
  const start = out.indexOf("{");
  if (start === -1) throw new Error(`gws returned no JSON: ${out.slice(0, 200)}`);
  return JSON.parse(out.slice(start));
}

function targetMonths() {
  const args = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}$/.test(a));
  if (args.length) return args;
  const now = new Date();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const next = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
  return [cur, next];
}

function fetchAssignments(monthPrefix) {
  const out = run("aws", [
    "dynamodb", "scan",
    "--table-name", TABLE,
    "--region", REGION,
    "--filter-expression", "begins_with(AssignmentDate, :p)",
    "--expression-attribute-values", JSON.stringify({ ":p": { S: monthPrefix } }),
    "--output", "json",
  ]);
  const items = JSON.parse(out).Items ?? [];
  const weeks = new Map(); // "YYYY-MM-DD" (Monday) -> { primary, secondary, content }
  for (const item of items) {
    const key = item.AssignmentDate.S; // e.g. 2026-07-20T00:00:00-primary
    const date = key.slice(0, 10);
    const role = key.slice(key.lastIndexOf("-") + 1);
    if (!weeks.has(date)) weeks.set(date, {});
    weeks.get(date)[role] = item.Engineer.S;
  }
  return weeks;
}

function expectedEvent(monday, { primary, secondary, content }) {
  const start = new Date(`${monday}T00:00:00`);
  const end = new Date(start); end.setDate(end.getDate() + 7);
  const endStr = localDateStr(end);
  const weekEnd = new Date(start); weekEnd.setDate(weekEnd.getDate() + 6);
  const fmt = (d) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  let summary = `온콜: ${primary} (주) / ${secondary} (부)`;
  let description = `주 담당자: ${primary}\n부 담당자: ${secondary}\n`;
  if (content) {
    summary += ` / ${content} (컨텐츠)`;
    description += `컨텐츠 담당자: ${content}\n`;
  }
  description += `\n기간: ${fmt(start)} ~ ${fmt(weekEnd)}`;
  return {
    summary,
    description,
    start: { date: monday },
    end: { date: endStr },
    colorId: "11",
    transparency: "transparent",
  };
}

function listMonthEvents(monthPrefix) {
  const [y, m] = monthPrefix.split("-").map(Number);
  const timeMin = `${monthPrefix}-01T00:00:00+09:00`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const timeMax = `${next}-01T00:00:00+09:00`;
  const data = gwsJson([
    "calendar", "events", "list",
    "--params", JSON.stringify({ calendarId: CALENDAR_ID, timeMin, timeMax, q: "온콜", singleEvents: true }),
    "--format", "json",
  ]);
  return data.items ?? [];
}

let created = 0, patched = 0, skipped = 0;

for (const month of targetMonths()) {
  const weeks = fetchAssignments(month);
  if (!weeks.size) { console.log(`${month}: no DDB assignments, skipping`); continue; }
  const events = listMonthEvents(month);

  for (const [monday, roles] of [...weeks.entries()].sort()) {
    if (!roles.primary || !roles.secondary) { console.log(`${monday}: incomplete roles, skipping`); continue; }
    const expected = expectedEvent(monday, roles);
    const existing = events.find((e) => e.start?.date?.slice(0, 10) === monday);
    if (!existing) {
      gwsJson(["calendar", "events", "insert",
        "--params", JSON.stringify({ calendarId: CALENDAR_ID }),
        "--json", JSON.stringify(expected), "--format", "json"]);
      console.log(`${monday}: CREATED — ${expected.summary}`);
      created++;
    } else if (existing.summary !== expected.summary || (existing.description ?? "") !== expected.description) {
      gwsJson(["calendar", "events", "patch",
        "--params", JSON.stringify({ calendarId: CALENDAR_ID, eventId: existing.id }),
        "--json", JSON.stringify({ summary: expected.summary, description: expected.description }),
        "--format", "json"]);
      console.log(`${monday}: PATCHED — ${expected.summary}`);
      patched++;
    } else {
      skipped++;
    }
  }
}

console.log(`Done. created=${created} patched=${patched} skipped(already in sync)=${skipped}`);
