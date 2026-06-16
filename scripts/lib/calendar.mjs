import { execSync } from 'node:child_process';
import { createLogger } from './logger.mjs';

const logger = createLogger('calendar');

/**
 * Keep only timed events (start has a time component) on the primary calendar,
 * sorted ascending by start. Pure.
 * @param {Array<{calendar:string,start:string,end:string,summary:string}>} events
 * @param {string|null} primarySummary  The primary calendar's summary (== account email).
 * @returns {Array} filtered + sorted events
 */
export function filterMyTimedEvents(events, primarySummary) {
  if (!Array.isArray(events) || !primarySummary) return [];
  return events
    .filter((e) => e && e.calendar === primarySummary && String(e.start || '').includes('T'))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

const KST_FMT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Seoul',
});

function hhmm(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return KST_FMT.format(d); // en-GB 24h => "HH:MM"
}

/**
 * Render an event time range in KST as "HH:MM–HH:MM" (en-dash).
 * Start-only when end is falsy/invalid. Pure.
 */
export function formatEventTime(startIso, endIso) {
  const start = hhmm(startIso);
  const end = endIso ? hhmm(endIso) : '';
  if (start && end) return `${start}–${end}`;
  return start;
}

/**
 * Build a Google-Chat-friendly calendar section. Pure.
 * @param {Array} events  already filtered + sorted
 * @param {{title:string, emptyText?:string, maxEvents?:number}} opts
 * @returns {string} the section text, or '' when empty and no emptyText
 */
export function formatCalendarSection(events, { title, emptyText, maxEvents = 8 } = {}) {
  const list = Array.isArray(events) ? events : [];
  if (list.length === 0) {
    if (!emptyText) return '';
    return [`📅 *${title}*`, emptyText].join('\n');
  }
  const lines = [`📅 *${title}*`];
  const shown = list.slice(0, maxEvents);
  for (const e of shown) {
    lines.push(`• ${formatEventTime(e.start, e.end)} ${e.summary || '(제목 없음)'}`);
  }
  if (list.length > maxEvents) lines.push(`_외 ${list.length - maxEvents}건_`);
  return lines.join('\n');
}

function defaultRunner(cmd) {
  return execSync(cmd, { shell: 'bash', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

/**
 * Resolve the primary calendar's summary (== account email) via gws calendarList.
 * Returns null on any failure.
 */
export function fetchPrimaryCalendarSummary(runner = defaultRunner) {
  try {
    const raw = runner('gws calendar calendarList list --format json');
    const parsed = JSON.parse(raw || '{}');
    const items = parsed.items || parsed || [];
    const primary = (Array.isArray(items) ? items : []).find((i) => i && i.primary === true);
    return primary ? primary.summary || primary.id || null : null;
  } catch (err) {
    logger.warn(`fetchPrimaryCalendarSummary failed: ${err.message}`);
    return null;
  }
}

/**
 * Fetch agenda events for today|tomorrow. `calendarId` (optional) filters server-side.
 * Returns [] on any failure.
 * @param {{ when:'today'|'tomorrow', calendarId?:string|null, runner?:Function }} opts
 */
export function fetchAgenda({ when, calendarId = null, runner = defaultRunner }) {
  const flag = when === 'tomorrow' ? '--tomorrow' : '--today';
  let cmd = `gws calendar +agenda ${flag} --format json`;
  if (calendarId) cmd += ` --calendar '${String(calendarId).replace(/'/g, '')}'`;
  try {
    const raw = runner(cmd);
    const parsed = JSON.parse(raw || '{}');
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch (err) {
    logger.warn(`fetchAgenda(${when}) failed: ${err.message}`);
    return [];
  }
}

/**
 * High-level: resolve primary (config override → auto-detect), fetch agenda, filter
 * to my timed events. Returns [] on disabled/any failure. Never throws.
 * @param {{ when:'today'|'tomorrow', config:object, runner?:Function }} opts
 */
export function getMyTimedEvents({ when, config, runner = defaultRunner }) {
  const cal = config?.googleChat?.calendar;
  if (!cal || cal.enabled === false) return [];
  try {
    const override = cal.calendarId || null;
    const primarySummary = override || fetchPrimaryCalendarSummary(runner);
    if (!primarySummary) return [];
    const events = fetchAgenda({ when, calendarId: override, runner });
    const filtered = filterMyTimedEvents(events, primarySummary);
    const max = typeof cal.maxEvents === 'number' ? cal.maxEvents : 8;
    return filtered.slice(0, max);
  } catch (err) {
    logger.warn(`getMyTimedEvents failed: ${err.message}`);
    return [];
  }
}
