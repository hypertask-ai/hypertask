const { test } = require('node:test');
const { assert, fixture, session } = require('./ai-chat-session-fixture.cjs');

test('synthetic delegate evidence bounds summary rows and projects no transcript bodies', async () => {
  const rows = Array.from({ length: 70 }, (_, n) => session(n + 1, { updatedAt: new Date('2026-01-01T00:00:00.000Z') }));
  const legacy = fixture({ rows, on: false });
  const paged = fixture({ rows });
  const legacyText = await (await legacy.get()).text();
  const summaryText = await (await paged.get('compat=htpr-6924')).text();
  assert.equal(JSON.parse(summaryText).sessions.length, 30);
  assert.equal(paged.calls.length, 1);
  assert.equal(paged.calls[0].take, 31);
  assert.equal(paged.calls[0].include, undefined);
  assert.deepEqual(paged.calls[0].select._count, { select: { messages: true } });
  assert.equal(paged.calls[0].select.messages, undefined);
  assert.equal(paged.calls[0].select.attachments, undefined);
  assert.equal(paged.calls[0].skip, undefined);
  assert.ok(Buffer.byteLength(summaryText) < Buffer.byteLength(legacyText));
  console.log(JSON.stringify({ synthetic: true, sessions: rows.length, queryCount: paged.calls.length, fetchedRowBound: paged.calls[0].take, returnedRows: JSON.parse(summaryText).sessions.length, legacyBytes: Buffer.byteLength(legacyText), summaryBytes: Buffer.byteLength(summaryText) }));
});


test('emptyOnly is validated, filters before paging, and never creates an empty session on lookup', async () => {
  const { session, id } = require('./ai-chat-session-fixture.cjs');
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
