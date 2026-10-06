const { test } = require('node:test');
const { assert, fixture, session, id, flag } = require('./ai-chat-session-fixture.cjs');

for (const [name, options, query] of [
  ['OFF ignores opt-in and malformed paging', { on: false }, 'compat=htpr-6924&cursor=broken&limit=bad&sessionId=invalid'],
  ['ON without opt-in', { on: true }, 'limit=bad'],
  ['ON with wrong opt-in', { on: true }, 'compat=wrong'],
  ['flag lookup failure', { flagError: true }, 'compat=htpr-6924&cursor=broken'],
]) test(`${name} returns exact legacy JSON and query`, async () => {
  const f = fixture(options);
  const expected = JSON.stringify({ success: true, sessions: [...f.rows].sort((a, b) => +b.updatedAt - +a.updatedAt) });
  const response = await f.get(query);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), expected);
  assert.deepEqual(f.calls[0].orderBy, { updatedAt: 'desc' });
  assert.equal(f.calls[0].take, undefined);
  assert.equal(f.calls[0].select, undefined);
  assert.deepEqual(f.flags, [[flag, 6]]);
});

test('opted-in ON returns only summaries, limit+1 and correct opaque last-row cursor', async () => {
  const f = fixture();
  const response = await f.get('compat=htpr-6924&limit=3&userId=999');
  const body = await response.json();
  assert.equal(body.sessions.length, 3);
  assert.deepEqual(body.sessions.map((row) => row.id), [id(8), id(7), id(6)]);
  assert.deepEqual(Object.keys(body.sessions[0]), ['id', 'createdAt', 'updatedAt', 'userId', 'taskId', 'projectId', 'agentId', 'teamId', 'title', 'hasMessages']);
  assert.equal(body.sessions[0].hasMessages, true);
  assert.deepEqual(JSON.parse(Buffer.from(body.nextCursor, 'base64url')), { updatedAt: f.rows[5].updatedAt.toISOString(), id: id(6) });
  assert.equal(f.calls[0].take, 4);
  assert.equal(f.calls[0].where.userId, 6);
});

test('multi-page keyset traversal returns every visible session exactly once, equal timestamps in ID order', async () => {
  const f = fixture({ rows: [...Array.from({ length: 17 }, (_, n) => session(n + 1)), session(40, { userId: 7 }), session(41, { agentId: id(70), runtimeType: 'EXTERNAL' })] });
  const expected = f.rows.filter((row) => row.userId === 6 && row.runtimeType !== 'EXTERNAL').sort((a, b) => +b.updatedAt - +a.updatedAt || b.id.localeCompare(a.id)).map((row) => row.id);
  const seen = [];
  let cursor = null;
  do {
    const body = await (await f.get(`compat=htpr-6924&limit=3${cursor ? '&cursor=' + cursor : ''}`)).json();
    seen.push(...body.sessions.map((row) => row.id));
    cursor = body.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, expected);
  assert.equal(new Set(seen).size, expected.length);
  assert.equal(f.writes.length, 0);
});

test('cursor row deletion does not lose continuation rows or query another owner', async () => {
  const f = fixture();
  const first = await (await f.get('compat=htpr-6924&limit=2')).json();
  f.rows.splice(f.rows.findIndex((row) => row.id === first.sessions[1].id), 1);
  const next = await (await f.get('compat=htpr-6924&limit=2&cursor=' + first.nextCursor)).json();
  assert.deepEqual(next.sessions.map((row) => row.id), [id(6), id(5)]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].where.userId, 6);
});

for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=-1', 'cursor=', 'cursor=%%%', 'cursor=' + 'a'.repeat(513), 'cursor=' + Buffer.from(JSON.stringify({ updatedAt: 'not-a-date', id: id(1) })).toString('base64url'), 'taskId=0', 'projectId=9007199254740992']) {
  test(`negotiated validation rejects ${query.slice(0, 60)} before queries/writes`, async () => {
    const f = fixture();
    assert.equal((await f.get('compat=htpr-6924&' + query)).status, 400);
    assert.equal(f.calls.length + f.writes.length, 0);
  });
}

test('scope filters find older task/board sessions and empty scopes/continuations never create', async () => {
  const f = fixture({ rows: [session(1, { taskId: 91, projectId: 4 }), session(9)] });
  const body = await (await f.get('compat=htpr-6924&taskId=91&projectId=4')).json();
  assert.deepEqual(body.sessions.map((row) => row.id), [id(1)]);
  assert.equal((await (await f.get('compat=htpr-6924&taskId=92')).json()).sessions.length, 0);
  const cursor = Buffer.from(JSON.stringify({ updatedAt: '2025-01-01T00:00:00.000Z', id: id(1) })).toString('base64url');
  assert.equal((await (await f.get('compat=htpr-6924&cursor=' + cursor)).json()).sessions.length, 0);
  assert.equal(f.writes.length, 0);
});

for (const on of [false, true]) test(`initial empty history creates a blank session, flag ${on}`, async () => {
  const f = fixture({ on, rows: [] });
  const body = await (await f.get('compat=htpr-6924')).json();
  assert.equal(f.writes.length, 1);
  assert.equal(body.sessions.length, 1);
  assert.equal(on ? body.sessions[0].hasMessages : body.sessions[0].messages.length, on ? false : 0);
});

test('auth and internal error retain exact original response bodies', async () => {
  const denied = fixture({ unauthorized: true });
  const response = await denied.get('compat=htpr-6924');
  assert.equal(response.status, 401);
  assert.equal(await response.text(), '{"error":"Unauthorized"}');
  assert.equal(denied.calls.length + denied.flags.length, 0);
  const failed = await fixture({ dbError: true }).get('compat=htpr-6924');
  assert.equal(failed.status, 500);
  assert.equal(await failed.text(), '{"success":false,"error":"Internal server error"}');
});
