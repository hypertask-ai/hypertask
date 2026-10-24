const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, ctx, session, NOW } = require('./htpr-7582-fixtures.cjs');
const fail = code => error => error.code === code;
const create = async (f) => (await f.create()).request.id;

test('agent admin and bridged cookie cannot approve themselves', async () => {
  for (const extra of [{ agentId: 'agent-1' }, { source: 'cli-bearer' }]) {
    const f = fixture(); f.state.agent.permissions.role = 'admin'; const id = await create(f);
    await assert.rejects(f.service.decideBoardAccessRequest(session(extra), id, 'approve', NOW), fail('human_owner_required'));
    assert.equal(f.state.members.length, 0); assert.equal(f.state.requests[0].status, 'pending');
    assert.equal(f.state.logs.at(-1).outcome, 'denied');
  }
});
test('human owner approval invokes exact shared grant with unchanged permissions', async () => {
  const f = fixture(); const id = await create(f); const permissions = structuredClone(f.state.agent.permissions);
  const result = await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW);
  assert.equal(result.request.status, 'approved'); assert.equal(result.request.accessPresent, true);
  assert.deepEqual(f.state.members.map(({ projectId, agentId, userId }) => ({ projectId, agentId, userId })), [{ projectId: 15, agentId: 'agent-1', userId: 6 }]);
  assert.deepEqual(f.state.agent.permissions, permissions); assert.equal(f.state.requests[0].decidedByUserId, 6);
  assert.equal(f.state.requests[0].memberId, f.state.members[0].id);
  assert.equal(f.state.logs.at(-1).operation, 'approve'); assert.equal(f.state.logs.at(-1).outcome, 'allowed');
});
test('non-owner cannot approve even with guessed request UUID', async () => {
  const f = fixture(); const id = await create(f);
  await assert.rejects(f.service.decideBoardAccessRequest(session({ userId: 7 }), id, 'approve', NOW), fail('unavailable'));
  assert.equal(f.state.grants, 0); assert.equal(f.state.requests[0].status, 'pending');
});
test('immutable recipient/current owner can still approve or decline', async () => {
  for (const decision of ['approve', 'decline']) {
    const f = fixture(); const id = await create(f);
    const result = await f.service.decideBoardAccessRequest(session(), id, decision, NOW);
    assert.equal(result.request.status, decision === 'approve' ? 'approved' : 'declined'); assert.equal(f.state.grants, decision === 'approve' ? 1 : 0);
    assert.equal(f.state.logs.at(-1).operation, decision); assert.equal(f.state.logs.at(-1).outcome, 'allowed');
  }
});
test('crafted approval cannot add an other-team agent', async () => {
  const f = fixture(); f.state.agent.members = [{ project: { teamId: 'foreign' } }]; const id = await create(f);
  await assert.rejects(f.service.decideBoardAccessRequest(session(), id, 'approve', NOW), fail('other_team')); assert.equal(f.state.grants, 0);
});
test('same-team agent can be approved and incompatible-team request can be declined', async () => {
  for (const decision of ['approve', 'decline']) {
    const f = fixture(); f.state.agent.members = [{ project: { teamId: decision === 'approve' ? 'team-1' : 'foreign' } }]; const id = await create(f);
    const result = await f.service.decideBoardAccessRequest(session(), id, decision, NOW);
    assert.equal(result.request.status, decision === 'approve' ? 'approved' : 'declined');
  }
});
test('deleted agent/board, changed owner/team/generation/access cancel without membership', async () => {
  for (const change of [f => { f.state.agent = null; f.state.requests[0].agentId = null; }, f => { f.state.board = null; f.state.requests[0].projectId = null; },
    f => { f.state.agent.userId = 7; }, f => { f.state.agent.revokedAt = NOW; }, f => { f.state.agent.runtimeGeneration++; },
    f => { f.state.agent.mcpTokenJti = 'rotated'; }, f => { f.state.board.teamId = 'moved'; }, f => { f.state.noAccess = true; }, f => { f.state.board.status = 'Archive'; }]) {
    const f = fixture(); const id = await create(f); change(f);
    const result = await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW);
    assert.equal(result.request.status, 'cancelled'); assert.equal(result.request.canApprove, false); assert.equal(f.state.grants, 0);
    assert.ok(f.state.logs.some(row => row.outcome === 'terminal'));
  }
});
test('live unchanged agent and board still allow the grant', async () => {
  const f = fixture(); const id = await create(f); assert.equal((await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW)).request.status, 'approved');
});
test('new owner cannot inherit previous consent prompt', async () => {
  const f = fixture(); const id = await create(f); f.state.agent.userId = 7;
  await assert.rejects(f.service.decideBoardAccessRequest(session({ userId: 7 }), id, 'approve', NOW), fail('unavailable'));
  assert.equal(f.state.grants, 0);
});
test('original current owner remains authorized', async () => {
  const f = fixture(); const id = await create(f); assert.equal((await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW)).request.status, 'approved');
});
test('live credential access-binding revocation cancels approval', async () => {
  const f = fixture(); f.state.agent.credentialTeamId = 'team-1'; f.state.agent.credentialTeamAccessBinding = 'binding-1';
  const id = (await f.service.createBoardAccessRequest(ctx({ teamScope: { teamId: 'team-1', accessBinding: 'binding-1' } }), { project_id: 15, reason: 'x' }, NOW)).request.id;
  f.state.bindingRevoked = true;
  assert.equal((await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW)).request.status, 'cancelled'); assert.equal(f.state.grants, 0);
});
test('unchanged scoped access binding still permits owner approval', async () => {
  const f = fixture(); f.state.agent.credentialTeamId = 'team-1'; f.state.agent.credentialTeamAccessBinding = 'binding-1';
  const id = (await f.service.createBoardAccessRequest(ctx({ teamScope: { teamId: 'team-1', accessBinding: 'binding-1' } }), { project_id: 15, reason: 'x' }, NOW)).request.id;
  assert.equal((await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW)).request.status, 'approved');
});
test('expired request cannot be approved without waiting for cron', async () => {
  const f = fixture(); const id = await create(f);
  assert.equal((await f.service.decideBoardAccessRequest(session(), id, 'approve', new Date(+NOW + 7 * 86400000))).request.status, 'expired'); assert.equal(f.state.grants, 0);
});
test('request just inside expiry remains approvable', async () => {
  const f = fixture(); const id = await create(f);
  assert.equal((await f.service.decideBoardAccessRequest(session(), id, 'approve', new Date(+NOW + 7 * 86400000 - 1))).request.status, 'approved');
});
test('flag off blocks cached approval', async () => {
  const f = fixture(); const id = await create(f); f.state.flag = false;
  await assert.rejects(f.service.decideBoardAccessRequest(session(), id, 'approve', NOW), fail('feature_disabled')); assert.equal(f.state.grants, 0);
});
test('flag on still permits owner approval', async () => {
  const f = fixture(); const id = await create(f); assert.equal((await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW)).request.status, 'approved');
});
test('past OFF cutoff prevents re-enable from reviving pending consent', async () => {
  const f = fixture(); const id = await create(f); f.state.disabledSince = true;
  assert.equal((await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW)).request.status, 'cancelled'); assert.equal(f.state.grants, 0);
});
test('fresh request with no OFF transition remains actionable', async () => {
  const f = fixture(); const id = await create(f); assert.equal((await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW)).request.status, 'approved');
});
test('retry after approval never regrants removed membership', async () => {
  const f = fixture(); const id = await create(f); await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW); f.state.members = [];
  const result = await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW);
  assert.equal(result.request.status, 'approved'); assert.equal(result.request.accessPresent, false); assert.match(result.request.nextStep, /no longer present/); assert.equal(f.state.grants, 1);
});
test('first approval still grants once', async () => {
  const f = fixture(); const id = await create(f); await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW); assert.equal(f.state.grants, 1);
});
test('independent existing membership fulfills only after live authorization', async () => {
  const f = fixture(); const id = await create(f); f.state.members.push({ id: 87, projectId: 15, agentId: 'agent-1', userId: 6 });
  const result = await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW);
  assert.equal(result.request.status, 'approved'); assert.equal(result.request.resolutionReason, 'already_member'); assert.equal(f.state.grants, 0); assert.equal(f.state.members.length, 1);
});
test('independently added membership does not bypass stale owner authorization', async () => {
  const f = fixture(); const id = await create(f); f.state.members.push({ id: 87, projectId: 15, agentId: 'agent-1' }); f.state.agent.userId = 7;
  assert.equal((await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW)).request.status, 'cancelled');
});
test('concurrent approve/decline has one terminal winner and matching membership', async () => {
  for (const order of [['approve', 'decline'], ['decline', 'approve']]) {
    const f = fixture(); const id = await create(f); const results = await Promise.all(order.map(action => f.service.decideBoardAccessRequest(session(), id, action, NOW)));
    assert.equal(results[0].request.status, results[1].request.status); assert.equal(f.state.grants, order[0] === 'approve' ? 1 : 0);
  }
});
test('grant insertion failure rolls back request transition and transactional audit', async () => {
  const f = fixture(); const id = await create(f); const before = f.state.logs.length; f.state.failGrant = true;
  await assert.rejects(f.service.decideBoardAccessRequest(session(), id, 'approve', NOW), /insert failed/);
  assert.equal(f.state.requests[0].status, 'pending'); assert.equal(f.state.members.length, 0); assert.equal(f.state.logs.length, before + 1);
  assert.equal(f.state.logs.at(-1).outcome, 'denied'); assert.equal(f.state.logs.at(-1).reason, 'transaction_failed');
});
test('successful grant commits membership, approval and audit together', async () => {
  const f = fixture(); const id = await create(f); await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW);
  assert.equal(f.state.members.length, 1); assert.equal(f.state.requests[0].status, 'approved'); assert.ok(f.state.logs.some(row => row.operation === 'approved' && row.outcome === 'terminal'));
});
test('transactional audit failure cannot leave membership without consent record', async () => {
  const f = fixture(); const id = await create(f); f.state.failAudit = true;
  await assert.rejects(f.service.decideBoardAccessRequest(session(), id, 'approve', NOW), /audit failed/);
  assert.equal(f.state.members.length, 0); assert.equal(f.state.requests[0].status, 'pending');
});
test('realtime outage does not change a committed approval into a failed grant', async () => {
  const f = fixture(); const id = await create(f); f.state.broadcastFails = true;
  assert.equal((await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW)).request.status, 'approved'); assert.equal(f.state.members.length, 1);
});

test('flag-off cutoff never misrepresents membership already granted before rollback', async () => {
  const f = fixture(); const id = await create(f); await f.service.decideBoardAccessRequest(session(), id, 'approve', NOW);
  f.state.disabledSince = true;
  assert.equal((await f.service.getBoardAccessRequest(ctx(), id, NOW)).request.accessPresent, true);
  assert.equal(f.state.grants, 1);
});
