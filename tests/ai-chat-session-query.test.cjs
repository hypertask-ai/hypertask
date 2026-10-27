const { test } = require('node:test');
const { assert, fixture, session, id } = require('./ai-chat-session-fixture.cjs');

test('synthetic delegate evidence bounds summary rows and projects no transcript bodies', async () => {
  const rows = Array.from({ length: 70 }, (_, n) => session(n + 1, { updatedAt: new Date('2026-01-01T00:00:00.000Z') }));
  const legacy = fixture({ rows, on: false });
  const paged = fixture({ rows });
  const legacyText = await (await legacy.get()).text();
  const summaryText = await (await paged.get('compat=htpr-6924')).text();
  assert.equal(JSON.parse(summaryText).sessions.length, 30);
  assert.equal(paged.calls.length, 2);
  assert.deepEqual(paged.calls[0].select, { id: true });
  assert.equal(paged.calls[0].include, undefined);
  assert.equal(paged.calls[1].take, 30);
  assert.equal(paged.calls[1].include, undefined);
  assert.deepEqual(paged.calls[1].select._count, { select: { messages: true } });
  assert.equal(paged.calls[1].select.messages, undefined);
  assert.equal(paged.calls[1].select.attachments, undefined);
  assert.equal(paged.calls[1].skip, undefined);
  assert.ok(Buffer.byteLength(summaryText) < Buffer.byteLength(legacyText));
  const cursor = JSON.parse(summaryText).nextCursor;
  const next = await (await paged.get('compat=htpr-6924&cursor=' + cursor)).json();
  assert.equal(next.sessions.length, 30);
  assert.equal(paged.calls.length, 3, 'continuation reads only bounded summaries, not the full ordering again');
  assert.equal(paged.calls[2].take, 30);
  assert.equal(paged.calls[2].where.id.in.length, 30);
  console.log(JSON.stringify({ synthetic: true, sessions: rows.length, initialQueryCount: 2, orderingScan: 'IDs only', summaryRowBound: paged.calls[1].take, returnedRows: JSON.parse(summaryText).sessions.length, legacyBytes: Buffer.byteLength(legacyText), summaryBytes: Buffer.byteLength(summaryText) }));
});

test('emptyOnly is validated, filters before paging, and never creates an empty session on lookup', async () => {
  const f = fixture({ rows: [session(9), session(1, { messages: [] })] });
  const result = await f.get('compat=htpr-6924&emptyOnly=true&limit=1');
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).sessions.map((row) => row.id), [id(1)]);
  assert.deepEqual(f.calls[0].where.messages, { none: {} });
  const none = fixture({ rows: [session(9)] });
  assert.deepEqual((await (await none.get('compat=htpr-6924&emptyOnly=true')).json()).sessions, []);
  assert.equal(none.writes.length, 0);
  assert.equal((await f.get('compat=htpr-6924&emptyOnly=false')).status, 400);
  assert.equal((await f.get(`compat=htpr-6924&sessionId=${id(1)}&emptyOnly=true`)).status, 400);
});

test('empty board lookup excludes task-backed empty sessions, task lookup keeps the requested ticket only', async () => {
  const f = fixture({ rows: [session(9, { projectId: 4, taskId: 91, messages: [] }), session(2, { projectId: 4, messages: [] }), session(1, { projectId: 4 })] });
  const board = await (await f.get('compat=htpr-6924&projectId=4&emptyOnly=true')).json();
  assert.deepEqual(board.sessions.map((row) => row.id), [id(2)]);
  const task = await (await f.get('compat=htpr-6924&taskId=91&projectId=4&emptyOnly=true')).json();
  assert.deepEqual(task.sessions.map((row) => row.id), [id(9)]);
  assert.equal(f.writes.length, 0);
});

test('fully deleted continuation page advances its snapshot cursor and never creates a session', async () => {
  const f = fixture();
  const first = await (await f.get('compat=htpr-6924&limit=2')).json();
  f.rows.splice(4, 2);
  const missing = await (await f.get('compat=htpr-6924&limit=2&cursor=' + first.nextCursor)).json();
  assert.deepEqual(missing.sessions, []);
  assert.ok(missing.nextCursor);
  const next = await (await f.get('compat=htpr-6924&limit=2&cursor=' + missing.nextCursor)).json();
  assert.deepEqual(next.sessions.map((row) => row.id), [id(4), id(3)]);
  assert.equal(f.writes.length, 0);
});

test('read rate limit precedes snapshot cache, summary/detail queries and empty-history creation', async () => {
  for (const query of ['limit=2', 'sessionId=' + id(1), 'cursor=broken']) {
    const f = fixture({ limited: true, rows: [] });
    const response = await f.get('compat=htpr-6924&' + query);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '17');
    assert.deepEqual(await response.json(), { error: 'Rate limit exceeded. Please try again shortly.' });
    assert.deepEqual(f.limits, [[6, 'read']]);
    assert.equal(f.calls.length + f.writes.length + f.redisCalls.length, 0);
  }
});
