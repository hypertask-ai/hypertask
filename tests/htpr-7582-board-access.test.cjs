const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, ctx, NOW, ID } = require('./htpr-7582-fixtures.cjs');
const errorCode = (code, status) => error => error.code === code && (!status || error.status === status);

test('human and management credentials cannot request agent access', async () => {
  for (const auth of [ctx({ agentId: null }), ctx({ management: { keyId: 'key' } })]) {
    const f = fixture();
    await assert.rejects(f.service.createBoardAccessRequest(auth, { project_id: 15, reason: 'x' }, NOW), errorCode('agent_bearer_required', 403));
    assert.equal(f.state.notifications.length, 0);
    assert.equal(f.state.logs[0].outcome, 'denied');
  }
});
test('live calling write/admin agent can request without target membership', async () => {
  for (const role of ['write', 'admin']) {
    const f = fixture(); f.state.agent.permissions.role = role;
    const result = await f.create();
    assert.equal(result.created, true);
    assert.equal(result.request.canApprove, true);
    assert.equal(f.state.grants, 0);
    assert.equal(f.state.notifications.length, 1);
    assert.equal(f.state.notifications[0].taskId, null);
    assert.equal(f.state.notifications[0].agentId, null);
    assert.equal(f.state.notifications[0].userId, 6);
    assert.equal(f.state.broadcasts, 1);
    assert.equal(f.state.locks, 1);
    assert.equal(f.state.logs[0].operation, 'create');
    assert.equal(f.state.logs[0].requestId, result.request.id);
    assert.equal(f.state.requests[0].expiresAt - NOW, 7 * 86400000);
  }
});
test('read agent cannot create requests', async () => {
  const f = fixture(); f.state.agent.permissions.role = 'read';
  await assert.rejects(f.create(), errorCode('write_role_required'));
});
test('read agent can read its own durable receipt', async () => {
  const f = fixture(); const created = await f.create(); f.state.agent.permissions.role = 'read';
  const result = await f.service.getBoardAccessRequest(ctx(), created.request.id, NOW);
  assert.equal(result.request.id, created.request.id);
  assert.equal(f.state.logs.at(-1).operation, 'status');
  assert.equal(f.state.logs.at(-1).outcome, 'allowed');
});
test('scoped agent cannot request another team or leak metadata', async () => {
  const f = fixture(); f.state.agent.credentialTeamId = 'team-2'; f.state.agent.credentialTeamAccessBinding = 'binding-2';
  await assert.rejects(f.service.createBoardAccessRequest(ctx({ teamScope: { teamId: 'team-2', accessBinding: 'binding-2' } }), { project_id: 15, reason: 'x' }, NOW), error => errorCode('unavailable', 404)(error) && !error.message.includes('Software Factory'));
  assert.equal(f.state.notifications.length, 0);
});
test('same-team bound agent can request and unattached unbound agent can ask for first board', async () => {
  for (const bound of [false, true]) {
    const f = fixture();
    if (bound) { f.state.agent.credentialTeamId = 'team-1'; f.state.agent.credentialTeamAccessBinding = 'binding-1'; }
    const result = await f.service.createBoardAccessRequest(ctx(bound ? { teamScope: { teamId: 'team-1', accessBinding: 'binding-1' } } : {}), { project_id: 15, reason: 'x' }, NOW);
    assert.equal(result.request.canApprove, true);
  }
});
test('unscoped other-team request cannot claim approvability', async () => {
  const f = fixture(); f.state.agent.members = [{ project: { teamId: 'team-2' } }];
  const result = await f.create();
  assert.equal(result.created, true);
  assert.equal(result.request.canApprove, false);
  assert.match(result.request.nextStep, /another team/);
});
test('same-team memberships keep approval available', async () => {
  const f = fixture(); f.state.agent.members = [{ project: { teamId: 'team-1' } }];
  assert.equal((await f.create()).request.canApprove, true);
});
test('revoked, deleted, superseded, rebound or restarted agent credential is refused', async () => {
  for (const change of [f => { f.state.agent = null; }, f => { f.state.agent.revokedAt = NOW; }, f => { f.state.agent.mcpTokenJti = 'rotated'; }, f => { f.state.agent.runtimeGeneration++; }, f => { f.state.agent.credentialTeamId = 'new-team'; }]) {
    const f = fixture(); change(f);
    await assert.rejects(f.create(), errorCode('invalid_agent_credential', 401));
    assert.equal(f.state.requests.length, 0);
  }
});
test('current agent credential is still allowed', async () => { assert.equal((await fixture().create()).created, true); });
test('deleted, archived, personal or owner-inaccessible board is unavailable', async () => {
  for (const change of [f => { f.state.board = null; }, f => { f.state.board.status = 'Archive'; }, f => { f.state.board.teamId = null; }, f => { f.state.noAccess = true; }]) {
    const f = fixture(); change(f); await assert.rejects(f.create(), errorCode('unavailable', 404));
    assert.equal(f.state.notifications.length, 0);
  }
});
test('live team board accessible to owner is still allowed', async () => { assert.equal((await fixture().create()).created, true); });
test('flag off and lookup failure refuse creation and status', async () => {
  for (const mode of ['flag', 'flagFailure']) {
    const f = fixture(); const created = await f.create();
    if (mode === 'flag') f.state.flag = false; else f.state.flagFailure = true;
    await assert.rejects(f.create(), errorCode('feature_disabled', 403));
    await assert.rejects(f.service.getBoardAccessRequest(ctx(), created.request.id, NOW), errorCode('feature_disabled'));
    assert.equal(f.state.notifications.length, 1);
  }
});
test('flag on permits create and own status without granting', async () => {
  const f = fixture(); const result = await f.create();
  assert.equal((await f.service.getBoardAccessRequest(ctx(), result.request.id, NOW)).request.status, 'pending');
  assert.equal(f.state.grants, 0);
});
test('duplicate requests cannot replace reason, extend TTL or enqueue again', async () => {
  const f = fixture(); const first = await f.create();
  const second = await f.service.createBoardAccessRequest(ctx(), { project_id: 15, reason: 'Replace the reason' }, new Date(+NOW + 100));
  assert.equal(second.created, false);
  assert.equal(second.request.id, first.request.id);
  assert.equal(second.request.expiresAt, first.request.expiresAt);
  assert.equal(f.state.requests[0].reason, 'Investigate deployment');
  assert.equal(f.state.notifications.length, 1);
  assert.equal(f.state.broadcasts, 1);
  assert.equal(f.state.logs.at(-1).outcome, 'replay');
});
test('a first request creates exactly one immutable row and notification', async () => {
  const f = fixture(); await f.create(); assert.equal(f.state.requests.length, 1); assert.equal(f.state.notifications.length, 1);
});
test('concurrent duplicate creation returns one request and one notification', async () => {
  const f = fixture(); const results = await Promise.all([f.create(), f.create()]);
  assert.equal(results.filter(row => row.created).length, 1);
  assert.equal(results[0].request.id, results[1].request.id);
  assert.equal(f.state.notifications.length, 1);
});
test('already-member is a no-op receipt without a request', async () => {
  const f = fixture(); f.state.members.push({ id: 9, projectId: 15, agentId: 'agent-1' });
  assert.equal((await f.create()).already_member, true);
  assert.equal(f.state.requests.length, 0); assert.equal(f.state.notifications.length, 0);
});
test('foreign UUID or different agent cannot read receipt', async () => {
  const f = fixture(); const created = await f.create();
  await assert.rejects(f.service.getBoardAccessRequest(ctx(), ID, NOW), errorCode('unavailable', 404));
  f.state.agent.id = 'agent-2';
  await assert.rejects(f.service.getBoardAccessRequest(ctx({ agentId: 'agent-2' }), created.request.id, NOW), errorCode('unavailable', 404));
});
test('same agent can read its actual request UUID', async () => {
  const f = fixture(); const created = await f.create(); assert.equal((await f.service.getBoardAccessRequest(ctx(), created.request.id, NOW)).request.id, created.request.id);
});
test('status enforces expiry without a cleanup job', async () => {
  const f = fixture(); const created = await f.create();
  const result = await f.service.getBoardAccessRequest(ctx(), created.request.id, new Date(+NOW + 7 * 86400000));
  assert.equal(result.request.status, 'expired'); assert.equal(result.request.canApprove, false);
  assert.equal(f.state.requests[0].status, 'expired');
});
test('unexpired request remains pending', async () => {
  const f = fixture(); const created = await f.create(); assert.equal((await f.service.getBoardAccessRequest(ctx(), created.request.id, new Date(+NOW + 1000))).request.status, 'pending');
});
test('expired predecessor is committed as terminal and cannot be replayed as pending', async () => {
  const f = fixture(); await f.create();
  await assert.rejects(f.service.createBoardAccessRequest(ctx(), { project_id: 15, reason: 'x' }, new Date(+NOW + 7 * 86400000 + 1000)), errorCode('request_cooldown', 429));
  assert.equal(f.state.requests[0].status, 'expired'); assert.equal(f.state.notifications.length, 1);
});
test('decline, expiry and cancellation require a 24-hour cooldown', async () => {
  for (const status of ['declined', 'expired', 'cancelled']) {
    const f = fixture(); await f.create(); Object.assign(f.state.requests[0], { status, resolvedAt: NOW });
    await assert.rejects(f.create(), errorCode('request_cooldown', 429));
    assert.equal(f.state.notifications.length, 1);
  }
});
test('new request is allowed after cooldown without changing old receipt', async () => {
  const f = fixture(); await f.create(); Object.assign(f.state.requests[0], { status: 'declined', resolvedAt: NOW });
  const result = await f.service.createBoardAccessRequest(ctx(), { project_id: 15, reason: 'Fresh consent' }, new Date(+NOW + 86400001));
  assert.equal(result.created, true); assert.equal(f.state.requests.length, 2); assert.equal(f.state.requests[0].status, 'declined');
});
test('agent hourly, owner daily and owner active quotas reject new requests', async () => {
  for (const [kind, limit] of [['hour', 5], ['day', 20], ['active', 20]]) {
    const f = fixture();
    for (let i = 0; i < limit; i++) f.state.requests.push({ id: `existing-${i}`, agentIdAtRequest: kind === 'hour' ? 'agent-1' : `agent-${i + 10}`, ownerUserIdAtRequest: 6,
      status: kind === 'active' ? 'pending' : 'approved', expiresAt: new Date(+NOW + 10000), createdAt: new Date(+NOW - (kind === 'active' ? 2 * 86400000 : 1000)) });
    await assert.rejects(f.create(), errorCode('request_limit', 429)); assert.equal(f.state.notifications.length, 0);
  }
});
test('just below every quota still permits a new request', async () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) f.state.requests.push({ id: `old-${i}`, agentIdAtRequest: 'agent-1', ownerUserIdAtRequest: 6, status: 'approved', createdAt: new Date(+NOW - 1000) });
  assert.equal((await f.create()).created, true);
});
test('pending replay is allowed at quota and does not reset quota', async () => {
  const f = fixture(); await f.create(); for (let i = 0; i < 30; i++) f.state.requests.push({ id: `old-${i}`, agentIdAtRequest: 'agent-1', ownerUserIdAtRequest: 6, status: 'approved', createdAt: NOW });
  assert.equal((await f.create()).created, false); assert.equal(f.state.notifications.length, 1);
});
test('serialization retry is bounded and broadcast failure does not undo creation', async () => {
  const f = fixture({ broadcastFails: true }); f.conflict(2);
  assert.equal((await f.create()).created, true); assert.equal(f.state.requests.length, 1);
});
test('audit stores IDs and machine outcomes but never reason text or credentials', async () => {
  const f = fixture(); await f.create({ reason: '<script>untrusted request</script>' });
  assert.equal(f.state.logs[0].credential, 'agent_bearer');
  assert.doesNotMatch(JSON.stringify(f.state.logs), /script|untrusted request|generation-1|example.test/);
});

test('expiry cooldown ends relative to immutable expiry, not the next read time', async () => {
  const f = fixture(); await f.create();
  const result = await f.service.createBoardAccessRequest(ctx(), { project_id: 15, reason: 'Fresh consent after expiry' }, new Date(+NOW + 8 * 86400000 + 1));
  assert.equal(result.created, true); assert.equal(f.state.requests[0].status, 'expired');
  assert.equal(+f.state.requests[0].resolvedAt, +NOW + 7 * 86400000);
});
