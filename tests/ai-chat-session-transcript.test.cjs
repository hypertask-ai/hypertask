const { test } = require('node:test');
const { assert, fixture, session, id } = require('./ai-chat-session-fixture.cjs');

test('detail preserves full scalar/attachment/agent-author transcript with ordered messages', async () => {
  const row = session(1);
  row.messages.unshift({ ...row.messages[0], id: 'later', createdAt: new Date('2026-03-01T00:00:00.000Z') });
  const f = fixture({ rows: [row] });
  const response = await f.get('compat=htpr-6924&sessionId=' + id(1));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), JSON.stringify({ success: true, session: { ...row, messages: [...row.messages].reverse() } }));
  assert.deepEqual(f.calls[0].include.messages, { orderBy: { createdAt: 'asc' }, include: { attachments: true, authorAgent: { select: { displayName: true } } } });
  assert.equal(f.writes.length, 0);
});
for (const [name, rows] of [
  ['missing', []], ['other owner', [session(1, { userId: 8 })]],
  ['external agent', [session(1, { agentId: id(2), runtimeType: 'EXTERNAL' })]],
]) test(`detail hides ${name} sessions without creating`, async () => {
  const f = fixture({ rows });
  const response = await f.get('compat=htpr-6924&sessionId=' + id(1));
  assert.equal(response.status, 404);
  assert.equal(await response.text(), '{"success":false,"error":"Session not found"}');
  assert.equal(f.writes.length, 0);
});
for (const query of ['sessionId=invalid', 'sessionId=', ...['limit=1', 'cursor=x', 'taskId=1', 'projectId=2'].map((suffix) => `sessionId=${id(1)}&${suffix}`)]) {
  test(`detail rejects ambiguous/invalid ${query}`, async () => {
    const f = fixture();
    assert.equal((await f.get('compat=htpr-6924&' + query)).status, 400);
    assert.equal(f.calls.length + f.writes.length, 0);
  });
}
test('detail parameter is ignored on OFF and ON without opt-in', async () => {
  for (const on of [false, true]) {
    const f = fixture({ on });
    const body = await (await f.get((on ? '' : 'compat=htpr-6924&') + 'sessionId=' + id(1))).json();
    assert.equal(body.sessions.length, 8);
    assert.equal(body.session, undefined);
    assert.ok(body.sessions[0].messages[0].attachments);
  }
});
