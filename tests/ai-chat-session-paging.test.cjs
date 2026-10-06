const { test } = require('node:test');
const { assert, fixture, session, id, flag } = require('./ai-chat-session-fixture.cjs');
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

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
  assert.deepEqual(f.redisCalls, []);
});

test('opted-in ON returns only bounded summaries and an opaque snapshot cursor', async () => {
  const f = fixture();
  const response = await f.get('compat=htpr-6924&limit=3&userId=999');
  const body = await response.json();
  assert.equal(body.sessions.length, 3);
  assert.deepEqual(body.sessions.map((row) => row.id), [id(8), id(7), id(6)]);
  assert.deepEqual(Object.keys(body.sessions[0]), ['id', 'createdAt', 'updatedAt', 'userId', 'taskId', 'projectId', 'agentId', 'teamId', 'title', 'hasMessages']);
  assert.equal(body.sessions[0].hasMessages, true);
  const cursor = JSON.parse(Buffer.from(body.nextCursor, 'base64url'));
  assert.equal(cursor.offset, 3);
  assert.match(cursor.snapshot, /^[0-9a-f-]{36}$/);
  assert.deepEqual(f.calls[0].select, { id: true });
  assert.deepEqual(f.calls[0].orderBy, [{ updatedAt: 'desc' }, { id: 'desc' }]);
  assert.equal(f.calls[1].take, 3);
  assert.equal(f.calls[1].where.userId, 6);
  assert.deepEqual(f.redisCalls[0].slice(-2), ['EX', 900]);
});

test('multi-page snapshot traversal returns every visible session exactly once, equal timestamps in ID order', async () => {
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
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2].where.userId, 6);
});

test('concurrent updates cannot skip unseen sessions or duplicate already returned sessions', async () => {
  const f = fixture();
  const expected = [...f.rows].sort((a, b) => +b.updatedAt - +a.updatedAt || b.id.localeCompare(a.id)).map((row) => row.id);
  const first = await (await f.get('compat=htpr-6924&limit=2')).json();
  const seen = first.sessions.map((row) => row.id);
  // Move an unseen session above the old keyset and a seen one below it.
  f.rows[0].updatedAt = new Date('2027-01-01T00:00:00.000Z');
  f.rows[7].updatedAt = new Date('2025-01-01T00:00:00.000Z');
  f.rows.push(session(50));
  let cursor = first.nextCursor;
  while (cursor) {
    const body = await (await f.get('compat=htpr-6924&limit=2&cursor=' + cursor)).json();
    seen.push(...body.sessions.map((row) => row.id));
    cursor = body.nextCursor;
  }
  assert.deepEqual(seen, expected);
  assert.equal(new Set(seen).size, expected.length);
  const fresh = await (await f.get('compat=htpr-6924&limit=2')).json();
  assert.equal(fresh.sessions[0].id, id(1));
  assert.equal(fresh.sessions[0].updatedAt, '2027-01-01T00:00:00.000Z');
  assert.equal(fresh.sessions[1].id, id(50));
});

test('updates between the ordering scan and summary fetch preserve the initial ordering', async () => {
  const f = fixture({ beforeQuery: (args, rows) => {
    if (args.select?._count) rows[0].updatedAt = new Date('2027-01-01T00:00:00.000Z');
  } });
  const first = await (await f.get('compat=htpr-6924&limit=2')).json();
  assert.deepEqual(first.sessions.map((row) => row.id), [id(8), id(7)]);
  const seen = first.sessions.map((row) => row.id);
  let cursor = first.nextCursor;
  while (cursor) {
    const body = await (await f.get('compat=htpr-6924&limit=2&cursor=' + cursor)).json();
    seen.push(...body.sessions.map((row) => row.id));
    cursor = body.nextCursor;
  }
  assert.deepEqual(seen, [8, 7, 6, 5, 4, 3, 2, 1].map(id));
});

for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=-1', 'cursor=', 'cursor=%%%', 'cursor=' + 'a'.repeat(513), ...[
  { updatedAt: 'not-a-date', id: id(1) }, { snapshot: 'invalid', offset: 1 },
  { snapshot: id(1), offset: 0 }, { snapshot: id(1), offset: 1.5 },
  { snapshot: id(1), offset: 9007199254740992 }, { snapshot: id(1), offset: 1, extra: true },
].map((value) => 'cursor=' + encode(value)), 'taskId=0', 'projectId=9007199254740992']) {
  test(`negotiated validation rejects ${query.slice(0, 60)} before queries/writes/cache`, async () => {
    const f = fixture();
    assert.equal((await f.get('compat=htpr-6924&' + query)).status, 400);
    assert.equal(f.calls.length + f.writes.length + f.redisCalls.length, 0);
  });
}

test('scope filters find older task sessions and empty scopes never create', async () => {
  const f = fixture({ rows: [session(1, { taskId: 91, projectId: 4 }), session(9)] });
  const body = await (await f.get('compat=htpr-6924&taskId=91&projectId=4')).json();
  assert.deepEqual(body.sessions.map((row) => row.id), [id(1)]);
  assert.equal((await (await f.get('compat=htpr-6924&taskId=92')).json()).sessions.length, 0);
  assert.equal(f.writes.length, 0);
});

test('board scope excludes ticket conversations on initial pages and continuation', async () => {
  const f = fixture({ rows: [session(9, { projectId: 4, taskId: 91 }), session(2, { projectId: 4 }), session(1, { projectId: 4 }), session(8, { projectId: 5 })] });
  const first = await (await f.get('compat=htpr-6924&projectId=4&limit=1')).json();
  assert.deepEqual(first.sessions.map((row) => row.id), [id(2)]);
  const next = await (await f.get('compat=htpr-6924&projectId=4&limit=1&cursor=' + first.nextCursor)).json();
  assert.deepEqual(next.sessions.map((row) => row.id), [id(1)]);
  assert.equal(next.nextCursor, null);
  assert.ok(f.calls.every((args) => args.where.taskId === null && args.where.projectId === 4));
  const task = await (await f.get('compat=htpr-6924&taskId=91')).json();
  assert.deepEqual(task.sessions.map((row) => row.id), [id(9)]);
  const mismatched = await (await f.get('compat=htpr-6924&taskId=91&projectId=5')).json();
  assert.deepEqual(mismatched.sessions, []);
});

test('continuations recheck ownership, external visibility and board scope after concurrent changes', async () => {
  const f = fixture({ rows: Array.from({ length: 5 }, (_, n) => session(n + 1, { projectId: 4 })) });
  const first = await (await f.get('compat=htpr-6924&projectId=4&limit=1')).json();
  f.rows[3].taskId = 91;
  f.rows[2].userId = 7;
  f.rows[1].agentId = id(70);
  f.rows[1].runtimeType = 'EXTERNAL';
  const next = await (await f.get('compat=htpr-6924&projectId=4&limit=4&cursor=' + first.nextCursor)).json();
  assert.deepEqual(next.sessions.map((row) => row.id), [id(1)]);
  assert.equal(next.nextCursor, null);
  assert.equal(f.writes.length, 0);
});

test('cursor expiration and owner/scope replay fail explicitly without queries or creation', async () => {
  const f = fixture();
  const first = await (await f.get('compat=htpr-6924&limit=2')).json();
  const query = 'compat=htpr-6924&limit=2&cursor=' + first.nextCursor;
  const other = fixture({ cache: f.cache, userId: 7 });
  assert.equal((await other.get(query)).status, 410);
  assert.equal(other.calls.length + other.writes.length, 0);
  const priorCalls = f.calls.length;
  assert.equal((await f.get(query + '&taskId=91')).status, 410);
  assert.equal((await f.get(query + '&projectId=4')).status, 410);
  assert.equal((await f.get(query + '&emptyOnly=true')).status, 410);
  f.cache.clear();
  const expired = await f.get(query);
  assert.equal(expired.status, 410);
  assert.deepEqual(await expired.json(), { success: false, error: 'Session cursor expired; restart pagination' });
  assert.equal(f.calls.length, priorCalls);
  assert.equal(f.writes.length, 0);
});

test('out-of-range cursor offsets are rejected rather than restarting or creating', async () => {
  const f = fixture();
  const first = await (await f.get('compat=htpr-6924&limit=2')).json();
  const cursor = JSON.parse(Buffer.from(first.nextCursor, 'base64url'));
  cursor.offset = f.rows.length;
  assert.equal((await f.get('compat=htpr-6924&cursor=' + encode(cursor))).status, 400);
  assert.equal(f.calls.length, 2);
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
  assert.equal(denied.calls.length + denied.flags.length + denied.redisCalls.length, 0);
  for (const options of [{ dbError: true }, { redisError: true }]) {
    const failed = await fixture(options).get('compat=htpr-6924&limit=2');
    assert.equal(failed.status, 500);
    assert.equal(await failed.text(), '{"success":false,"error":"Internal server error"}');
  }
});
