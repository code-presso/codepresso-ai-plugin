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
    const out = fetchChatUnread({ spaceIds: ['BAD', 'OK'], sinceIso: 'x', maxPerSpace: 20, runner });
    assert.equal(out.length, 1);
    assert.ok(out[0].id.includes('spaces/OK'));
  });

  it('returns [] if every runner call fails', () => {
    const out = fetchChatUnread({
      spaceIds: ['A'], sinceIso: 'x', maxPerSpace: 20,
      runner: () => { throw new Error('ENOENT'); },
    });
    assert.deepEqual(out, []);
  });
});
