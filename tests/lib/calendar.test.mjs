import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterMyTimedEvents,
  formatEventTime,
  formatCalendarSection,
  getMyTimedEvents,
} from '../../scripts/lib/calendar.mjs';

const PRIMARY = 'kyeongwook.ma@codepresso.kr';

const SAMPLE = [
  { calendar: '부재 일정', start: '2026-06-16', end: '2026-06-17', summary: '🌴 [최정희] 휴가' },
  { calendar: 'on call 대응', start: '2026-06-15', end: '2026-06-22', summary: '온콜' },
  { calendar: '부재 일정', start: '2026-06-16T04:00:00Z', end: '2026-06-16T08:00:00Z', summary: '🌴 [양지현] 휴가' },
  { calendar: PRIMARY, start: '2026-06-16T10:00:00+09:00', end: '2026-06-16T11:00:00+09:00', summary: '주간미팅' },
  { calendar: '커뮤니티 공간 예약', start: '2026-06-16T11:00:00+09:00', end: '2026-06-16T12:00:00+09:00', summary: '제품본부' },
  { calendar: PRIMARY, start: '2026-06-16T09:00:00+09:00', end: '2026-06-16T10:00:00+09:00', summary: 'AXMOS 주간 미팅' },
];

describe('filterMyTimedEvents', () => {
  it('keeps only timed events on the primary calendar, sorted by start', () => {
    const out = filterMyTimedEvents(SAMPLE, PRIMARY);
    assert.equal(out.length, 2);
    assert.equal(out[0].summary, 'AXMOS 주간 미팅'); // 09:00 sorts before 10:00
    assert.equal(out[1].summary, '주간미팅');
  });

  it('drops all-day (date-only) events even on the primary calendar', () => {
    const allDayPrimary = [{ calendar: PRIMARY, start: '2026-06-16', end: '2026-06-17', summary: '종일' }];
    assert.deepEqual(filterMyTimedEvents(allDayPrimary, PRIMARY), []);
  });

  it('returns [] for non-array input or missing primary', () => {
    assert.deepEqual(filterMyTimedEvents(null, PRIMARY), []);
    assert.deepEqual(filterMyTimedEvents(SAMPLE, null), []);
  });
});

describe('formatEventTime', () => {
  it('renders +09:00 datetimes in KST HH:MM–HH:MM', () => {
    assert.equal(
      formatEventTime('2026-06-16T09:00:00+09:00', '2026-06-16T10:00:00+09:00'),
      '09:00–10:00',
    );
  });

  it('converts a Z (UTC) datetime to KST', () => {
    // 04:00Z == 13:00 KST
    assert.equal(
      formatEventTime('2026-06-16T04:00:00Z', '2026-06-16T05:30:00Z'),
      '13:00–14:30',
    );
  });

  it('returns start-only when end is missing', () => {
    assert.equal(formatEventTime('2026-06-16T09:00:00+09:00', null), '09:00');
  });
});

const EVENTS = [
  { start: '2026-06-16T09:00:00+09:00', end: '2026-06-16T10:00:00+09:00', summary: 'AXMOS 주간 미팅' },
  { start: '2026-06-16T10:00:00+09:00', end: '2026-06-16T11:00:00+09:00', summary: '주간미팅' },
];

describe('formatCalendarSection', () => {
  it('builds a titled block with one line per event', () => {
    const out = formatCalendarSection(EVENTS, { title: '오늘 일정' });
    assert.ok(out.includes('📅 *오늘 일정*'));
    assert.ok(out.includes('• 09:00–10:00 AXMOS 주간 미팅'));
    assert.ok(out.includes('• 10:00–11:00 주간미팅'));
  });

  it('caps at maxEvents and adds an overflow line', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      start: `2026-06-16T0${i}:00:00+09:00`, end: `2026-06-16T0${i}:30:00+09:00`, summary: `e${i}`,
    }));
    const out = formatCalendarSection(many, { title: 'T', maxEvents: 3 });
    assert.equal((out.match(/•/g) || []).length, 3);
    assert.ok(out.includes('외 2건'));
  });

  it('returns emptyText line when empty and emptyText provided', () => {
    const out = formatCalendarSection([], { title: '오늘 일정', emptyText: '_없음_' });
    assert.ok(out.includes('📅 *오늘 일정*'));
    assert.ok(out.includes('_없음_'));
  });

  it('returns "" when empty and no emptyText', () => {
    assert.equal(formatCalendarSection([], { title: '내일 일정' }), '');
  });
});

const PRIMARY2 = 'me@codepresso.kr';

function makeRunner({ failAgenda = false } = {}) {
  return (cmd) => {
    if (cmd.includes('calendarList list')) {
      return JSON.stringify({ items: [
        { id: 'roomcal', summary: '커뮤니티 공간 예약' },
        { id: PRIMARY2, summary: PRIMARY2, primary: true },
      ] });
    }
    if (cmd.includes('+agenda')) {
      if (failAgenda) throw new Error('gws: not authed');
      return JSON.stringify({ count: 2, events: [
        { calendar: PRIMARY2, start: '2026-06-16T10:00:00+09:00', end: '2026-06-16T11:00:00+09:00', summary: 'mine' },
        { calendar: '커뮤니티 공간 예약', start: '2026-06-16T12:00:00+09:00', end: '2026-06-16T13:00:00+09:00', summary: 'room' },
      ] });
    }
    return '{}';
  };
}

describe('getMyTimedEvents', () => {
  it('auto-detects primary and returns only my timed events', () => {
    const cfg = { googleChat: { calendar: { enabled: true } } };
    const out = getMyTimedEvents({ when: 'today', config: cfg, runner: makeRunner() });
    assert.equal(out.length, 1);
    assert.equal(out[0].summary, 'mine');
  });

  it('honors an explicit calendarId override (skips calendarList)', () => {
    const cfg = { googleChat: { calendar: { enabled: true, calendarId: PRIMARY2 } } };
    let listCalled = false;
    const runner = (cmd) => {
      if (cmd.includes('calendarList')) { listCalled = true; }
      return makeRunner()(cmd);
    };
    const out = getMyTimedEvents({ when: 'tomorrow', config: cfg, runner });
    assert.equal(out.length, 1);
    assert.equal(listCalled, false);
  });

  it('returns [] when calendar disabled', () => {
    const cfg = { googleChat: { calendar: { enabled: false } } };
    assert.deepEqual(getMyTimedEvents({ when: 'today', config: cfg, runner: makeRunner() }), []);
  });

  it('returns [] when agenda fetch throws', () => {
    const cfg = { googleChat: { calendar: { enabled: true } } };
    assert.deepEqual(getMyTimedEvents({ when: 'today', config: cfg, runner: makeRunner({ failAgenda: true }) }), []);
  });
});
