import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchChatUnread } from '../../scripts/lib/gws.mjs';

describe('gws.fetchChatUnread', () => {
  it('shells out one gws invocation per space and merges results', () => {
    const calls = [];
    const runner = (cmd) => {
      calls.push(cmd);
      if (cmd.includes('spaces/A')) {
        return JSON.stringify({ messages: [{ name: 'spaces/A/messages/1', text: 'hi A',
          sender: { displayName: 'Mira' }, createTime: '2026-05-16T08:00:00Z' }] });
      }
      return JSON.stringify({ messages: [{ name: 'spaces/B/messages/2', text: 'hi B',
        sender: { displayName: 'Park' }, createTime: '2026-05-16T08:05:00Z' }] });
    };
    const out = fetchChatUnread({
      spaceIds: ['A', 'B'],
      sinceIso: '2026-05-15T00:00:00Z',
      maxPerSpace: 20,
      runner,
    });
    assert.equal(out.length, 2);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes('spaces/A'));
    assert.ok(out[0].id.startsWith('spaces/A/messages/'));
    assert.equal(out[0].source, 'chat');
    assert.equal(out[1].from, 'Park');
  });

  it('returns [] when spaceIds is empty', () => {
    const out = fetchChatUnread({ spaceIds: [], sinceIso: 'x', maxPerSpace: 20, runner: () => '' });
    assert.deepEqual(out, []);
  });

  it('skips a space whose runner throws', () => {
    const runner = (cmd) => {
      if (cmd.includes('spaces/BAD')) throw new Error('gws: 403');
      return JSON.stringify({ messages: [{ name: 'spaces/OK/messages/1', text: 't',
        sender: { displayName: 'X' }, createTime: '2026-05-16T08:00:00Z' }] });
    };
    const out = fetchChatUnread({ spaceIds: ['BAD', 'OK'], sinceIso: '2026-05-15T00:00:00Z', maxPerSpace: 20, runner });
    assert.equal(out.length, 1);
    assert.ok(out[0].id.includes('spaces/OK'));
  });

  it('throws if every runner call fails', () => {
    assert.throws(
      () => fetchChatUnread({
        spaceIds: ['A'], sinceIso: '2026-05-15T00:00:00Z', maxPerSpace: 20,
        runner: () => { throw new Error('ENOENT'); },
      }),
      /all 1 space\(s\) failed/,
    );
  });

  it('handles parsed.messages being undefined', () => {
    const runner = () => JSON.stringify({ nextPageToken: 'abc' });
    const out = fetchChatUnread({ spaceIds: ['A'], sinceIso: '2026-05-15T00:00:00Z', maxPerSpace: 20, runner });
    assert.deepEqual(out, []);
  });

  it('handles message with no text field', () => {
    const runner = () => JSON.stringify({ messages: [{
      name: 'spaces/A/messages/1', sender: { displayName: 'X' }, createTime: '2026-05-16T08:00:00Z',
    }]});
    const out = fetchChatUnread({ spaceIds: ['A'], sinceIso: '2026-05-15T00:00:00Z', maxPerSpace: 20, runner });
    assert.equal(out.length, 1);
    assert.equal(out[0].snippet, '');
  });

  it('handles message with no sender field', () => {
    const runner = () => JSON.stringify({ messages: [{
      name: 'spaces/A/messages/1', text: 'hi', createTime: '2026-05-16T08:00:00Z',
    }]});
    const out = fetchChatUnread({ spaceIds: ['A'], sinceIso: '2026-05-15T00:00:00Z', maxPerSpace: 20, runner });
    assert.equal(out[0].from, 'unknown');
  });

  it('rejects invalid sinceIso', () => {
    const out = fetchChatUnread({ spaceIds: ['A'], sinceIso: 'bogus', maxPerSpace: 20, runner: () => 'should not be called' });
    assert.deepEqual(out, []);
  });

  it('skips invalid spaceId (shell-injection defense)', () => {
    const calls = [];
    const runner = (cmd) => { calls.push(cmd); return JSON.stringify({ messages: [] }); };
    const out = fetchChatUnread({
      spaceIds: ['valid_space', 'evil"; rm -rf /; echo "'],
      sinceIso: '2026-05-15T00:00:00Z', maxPerSpace: 20, runner,
    });
    assert.equal(calls.length, 1); // only the valid one made it through
    assert.ok(calls[0].includes('valid_space'));
  });

  // These tests assert on the *shape* of the --params JSON rather than on raw
  // substrings of the command line. The previous version asserted
  // `--page-size 7`, which is not a flag gws accepts — so the mock happily
  // confirmed a command that always failed against the real CLI.
  it('sends every query parameter inside a single --params JSON blob', () => {
    const calls = [];
    const runner = (cmd) => { calls.push(cmd); return JSON.stringify({ messages: [] }); };
    fetchChatUnread({ spaceIds: ['A'], sinceIso: '2026-05-15T00:00:00Z', maxPerSpace: 7, runner });

    const params = JSON.parse(calls[0].match(/--params '(.+?)' --format/)[1]);
    assert.deepEqual(params, {
      parent: 'spaces/A',
      filter: 'createTime > "2026-05-15T00:00:00Z"',
      pageSize: 7,
    });
  });

  it('uses no bare flags that the gws CLI would reject', () => {
    const calls = [];
    const runner = (cmd) => { calls.push(cmd); return JSON.stringify({ messages: [] }); };
    fetchChatUnread({ spaceIds: ['A'], sinceIso: '2026-05-15T00:00:00Z', maxPerSpace: 7, runner });

    for (const flag of ['--parent', '--filter', '--page-size']) {
      assert.ok(!calls[0].includes(flag), `command must not pass ${flag} as a bare flag`);
    }
  });

  it('throws when every space fails, so total breakage is not read as "no messages"', () => {
    assert.throws(
      () => fetchChatUnread({
        spaceIds: ['A', 'B'],
        sinceIso: '2026-05-15T00:00:00Z',
        maxPerSpace: 20,
        runner: () => { throw new Error("unexpected argument '--parent' found"); },
      }),
      /all 2 space\(s\) failed/,
    );
  });

  it('still returns partial results when only some spaces fail', () => {
    const runner = (cmd) => {
      if (cmd.includes('spaces/BAD')) throw new Error('gws: 403');
      return JSON.stringify({ messages: [{ name: 'spaces/OK/messages/1', text: 't',
        sender: { displayName: 'X' }, createTime: '2026-05-16T08:00:00Z' }] });
    };
    const out = fetchChatUnread({ spaceIds: ['BAD', 'OK'], sinceIso: '2026-05-15T00:00:00Z', maxPerSpace: 20, runner });
    assert.equal(out.length, 1);
  });

  it('returns [] (not a throw) when spaces are reachable but quiet', () => {
    const out = fetchChatUnread({
      spaceIds: ['A', 'B'],
      sinceIso: '2026-05-15T00:00:00Z',
      maxPerSpace: 20,
      runner: () => JSON.stringify({ messages: [] }),
    });
    assert.deepEqual(out, []);
  });
});
