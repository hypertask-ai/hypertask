const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { teamFixture } = require('./helpers/htpr-7179-team.cjs');

const scopedSkillsFlag = 'htpr-7663-scoped-agent-skills';
const request = path => new NextRequest(`http://localhost/api/mcp/${path}`);

function fixture(mode, actor = 'bound', discovery = 'ON') {
  const f = teamFixture(mode, actor);
  if (f.state.ctx.teamScope) f.state.ctx.teamScope = { ...f.state.ctx.teamScope };
  const skills = [
    { id: 1, userId: f.user.id, projectId: null, project: null, slug: 'personal', name: 'Personal', enabled: true, body: 'global-sentinel' },
    ...f.projects.map(project => ({ id: project.id, userId: null, projectId: project.id, project, slug: 'review', name: project.name, enabled: true, body: `${project.name}-skill` })),
    { id: 2, userId: 999, projectId: null, project: null, slug: 'other-owner', name: 'Other owner', enabled: true, body: 'other-owner-sentinel' },
  ];
  for (const skill of skills) Object.defineProperty(skill, 'project', { enumerable: false });
  f.prisma.aI_Skill = f.model(skills, 'skill');
  Object.assign(f.mocks, {
    '@/lib/flags': {
      HTPR_7663_SCOPED_AGENT_SKILLS_FLAG: scopedSkillsFlag,
      isFeatureEnabled: async (key, userId) => {
        if (key !== scopedSkillsFlag) return false;
        assert.equal(userId, f.user.id);
        if (discovery === 'ERROR') throw new Error('discovery flag lookup failed');
        return discovery === 'ON';
      },
    },
    '@/app/api/ai/_lib/modelProvider': {},
    '@/app/api/ai/_lib/byokKeys': {},
    '@/lib/ai/tools/execution': { withToolErrors: execute => execute },
    '@/lib/ai/tools/helpers': { sanitizeForJson: value => value },
    ai: { tool: definition => definition },
  });
  const { createListSkillsTool } = f.load('src/lib/ai/tools/listSkills.ts');
  const tool = createListSkillsTool({
    user: f.user,
    actingAgentId: f.state.ctx.agentId,
    teamScope: f.state.ctx.teamScope,
    sendStatus: () => {},
  }).hypertask_list_skills;
  return { ...f, skills, tool };
}

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  test(`${mode}: MCP and app-chat discovery expose only readable team boards, including unfiltered discovery`, async () => {
    const f = fixture(mode);
    const route = f.load('src/lib/mcp/operations/skills/operation.ts');
    for (const projectId of [undefined, 15, 16]) {
      const req = request(`skills${projectId ? `?project_id=${projectId}` : ''}`);
      const response = await route.GET(req);
      assert.equal(response.status, 200);
      const mcp = await response.json();
      const chat = await f.run(req, () => f.tool.execute(projectId ? { project_id: projectId } : {}));
      const expected = projectId ? [projectId] : [15, 16];
      assert.deepEqual(mcp.skills.map(skill => skill.id), expected);
      assert.deepEqual(chat.skills.map(skill => skill.id), expected);
      assert.equal(mcp.total, expected.length);
      assert.equal(chat.total, expected.length);
      assert.doesNotMatch(JSON.stringify([mcp, chat]), /global-sentinel|other-owner-sentinel|B1-skill|C1-skill/);
    }
    for (const projectId of [25, 35]) {
      const req = request(`skills?project_id=${projectId}`);
      const response = await route.GET(req);
      assert.equal(response.status, 403);
      assert.doesNotMatch(await response.text(), /global-sentinel|B1-skill|C1-skill/);
      await assert.rejects(f.run(req, () => f.tool.execute({ project_id: projectId })), /access denied/);
    }
    assert.deepEqual(f.writes, []);
  });

  test(`${mode}: an agent's foreign-team board grant cannot override its credential scope`, async () => {
    const f = fixture(mode);
    f.projects[3].members.push({ userId: f.user.id, agentId: f.agent.id, status: 'Accepted', agent: f.agent });
    const route = f.load('src/lib/mcp/operations/skills/operation.ts');
    const response = await route.GET(request('skills'));
    assert.deepEqual((await response.json()).skills.map(skill => skill.id), [15, 16]);
    const chat = await f.run(request('skills'), () => f.tool.execute({}));
    assert.deepEqual(chat.skills.map(skill => skill.id), [15, 16]);
    assert.equal((await route.GET(request('skills?project_id=25'))).status, 403);
    await assert.rejects(f.run(request('skills'), () => f.tool.execute({ project_id: 25 })), /access denied/);
    const allowed = await route.GET(request('skills?project_id=15'));
    assert.equal(allowed.status, 200);
    assert.deepEqual((await allowed.json()).skills.map(skill => skill.id), [15]);
    const allowedChat = await f.run(request('skills'), () => f.tool.execute({ project_id: 15 }));
    assert.deepEqual(allowedChat.skills.map(skill => skill.id), [15]);
  });
}

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  for (const discovery of ['OFF', 'ERROR']) {
    test(`${mode} ${discovery}: unfiltered discovery is refused while readable project skills stay available and scope restrictions remain enforced`, async () => {
      const f = fixture(mode, 'bound', discovery);
      const route = f.load('src/lib/mcp/operations/skills/operation.ts');
      let reads = 0;
      const findMany = f.prisma.aI_Skill.findMany;
      f.prisma.aI_Skill.findMany = async args => { reads++; return findMany(args); };
      const response = await route.GET(request('skills'));
      assert.equal(response.status, 403);
      assert.doesNotMatch(await response.text(), /global-sentinel|A1-skill|B1-skill/);
      await assert.rejects(f.run(request('skills'), () => f.tool.execute({})), /access denied/);
      assert.equal(reads, 0);
      const allowed = await route.GET(request('skills?project_id=15'));
      assert.equal(allowed.status, 200);
      assert.deepEqual((await allowed.json()).skills.map(skill => skill.id), [15]);
      const chat = await f.run(request('skills'), () => f.tool.execute({ project_id: 15 }));
      assert.deepEqual(chat.skills.map(skill => skill.id), [15]);
      f.projects[3].members.push({ userId: f.user.id, agentId: f.agent.id, status: 'Accepted', agent: f.agent });
      assert.equal((await route.GET(request('skills?project_id=25'))).status, 403);
      await assert.rejects(f.run(request('skills'), () => f.tool.execute({ project_id: 25 })), /access denied/);
      assert.deepEqual(f.writes, []);
    });
  }
}

for (const discovery of ['ON', 'OFF', 'ERROR']) {
  for (const actor of ['unbound', 'human']) {
    test(`${discovery} ${actor}: personal skills and authorized project skills remain available through both list boundaries`, async () => {
      const f = fixture('ENFORCE', actor, discovery);
      const route = f.load('src/lib/mcp/operations/skills/operation.ts');
      for (const projectId of [undefined, 15, 25]) {
        const req = request(`skills${projectId ? `?project_id=${projectId}` : ''}`);
        const response = await route.GET(req);
        assert.equal(response.status, 200);
        const expected = projectId ? [1, projectId] : [1];
        assert.deepEqual((await response.json()).skills.map(skill => skill.id), expected);
        const chat = await f.run(req, () => f.tool.execute(projectId ? { project_id: projectId } : {}));
        assert.deepEqual(chat.skills.map(skill => skill.id), expected);
      }
    });
  }
}

function streamHarness(f, text, projectId) {
  const turns = [];
  const errors = [];
  const { runChatStream } = f.load('src/lib/ai/chatStream/runStream.ts', {
    '@/app/api/ai/chat/stream/streamLease': {
      createTurnDeadline: () => ({ clear() {} }),
      releaseAiChatStreamLease: async () => {},
      AI_CHAT_TURN_DEADLINE_RESERVE_SECONDS: 0,
    },
    '@/app/api/ai/_lib/heartbeatExecution': {},
    '@/app/api/ai/chat/stream/persistAssistantMessage': {},
    '@/utils/controllers/comments/linkifyTicketRefs': {},
    '@/lib/telemetry/aiChatObservability': { recordAiChatTurn: async () => {} },
    '@vercel/functions': { waitUntil: () => {} },
    '@/lib/ai/chatAlerts/service': { recordAiChatAlertSample: async () => {} },
    '@/lib/ai/chatStream/errors': {
      includedAllowanceError: () => false,
      reportHandledChatError: async error => errors.push(error),
      userFacingErrorMessage: error => error.message,
      userFacingErrorDetails: () => ({}),
      sseFrame: (event, data) => JSON.stringify({ event, data }),
    },
    './fleetTurn': { routeAgentMention: async () => false },
    './modelTurn': { runModelTurn: async (_state, body, resolution) => turns.push({ body, resolution }) },
  });
  const state = {
    body: { default_context: { project_id: projectId } },
    dbUser: f.user,
    requestMessage: text,
    actingAgent: f.state.ctx.agentId ? { ...f.agent, teamScope: f.state.ctx.teamScope } : null,
    gatewayTags: {},
    selected: { resolvedModelId: 'fixture', usageProvider: 'fixture' },
    turnStartedAtMs: Date.now(),
    maxDuration: 60,
    encoder: new TextEncoder(),
    clientConnected: true,
  };
  const controller = { enqueue() {}, close() {} };
  return { turns, errors, run: () => f.run(request('ai/chat/stream'), () => runChatStream(controller, state)) };
}

for (const discovery of ['ON', 'OFF', 'ERROR']) {
  for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
    test(`${discovery} ${mode}: the real chat stream refuses account-wide skill bodies but still resolves readable board and built-in skills`, async () => {
      const f = fixture(mode, 'bound', discovery);
      for (const projectId of [undefined, 15]) {
        const denied = streamHarness(f, '/personal Draft', projectId);
        await denied.run();
        assert.equal(denied.turns.length, 0);
        assert.equal(denied.errors.length, 1);
        assert.equal(denied.errors[0].status, 403);
      }
      const allowed = streamHarness(f, '/review /i Draft', 15);
      await allowed.run();
      assert.deepEqual(allowed.errors, []);
      assert.equal(allowed.turns.length, 1);
      assert.deepEqual(allowed.turns[0].resolution.skills.map(skill => skill.id), [15, -1]);
      assert.match(allowed.turns[0].resolution.systemPromptAddition, /A1-skill/);
      assert.doesNotMatch(allowed.turns[0].resolution.systemPromptAddition, /global-sentinel|B1-skill/);
      assert.equal(allowed.turns[0].body.message, 'Draft');
      const foreign = streamHarness(f, '/review Draft', 25);
      await foreign.run();
      assert.deepEqual(foreign.errors, []);
      assert.equal(foreign.turns[0].resolution.systemPromptAddition, '');
      assert.equal(foreign.turns[0].body.message, '/review Draft');
      assert.deepEqual(f.writes, []);
    });
  }
}

for (const actor of ['unbound', 'human']) {
  test(`${actor}: the real chat stream still applies personal skills`, async () => {
    const f = fixture('ENFORCE', actor);
    const h = streamHarness(f, '/personal Draft', 15);
    await h.run();
    assert.deepEqual(h.errors, []);
    assert.equal(h.turns.length, 1);
    assert.equal(h.turns[0].body.message, 'Draft');
    assert.match(h.turns[0].resolution.systemPromptAddition, /global-sentinel/);
  });
}

for (const scenario of ['no-board-grants', 'invalid-team-scope', 'revoked']) {
  test(`${scenario}: scoped discovery returns no skills instead of falling back to the owner`, async () => {
    const f = fixture('ENFORCE');
    const route = f.load('src/lib/mcp/operations/skills/operation.ts');
    const allowed = await route.GET(request('skills'));
    assert.equal(allowed.status, 200);
    assert.deepEqual((await allowed.json()).skills.map(skill => skill.id), [15, 16]);
    const allowedChat = await f.run(request('skills'), () => f.tool.execute({}));
    assert.deepEqual(allowedChat.skills.map(skill => skill.id), [15, 16]);
    if (scenario === 'no-board-grants') f.projects.forEach(project => { project.members = []; });
    if (scenario === 'invalid-team-scope') f.state.ctx.teamScope.accessBinding = '';
    if (scenario === 'revoked') f.agent.revokedAt = new Date();
    const response = await route.GET(request('skills'));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).skills, []);
    const chat = await f.run(request('skills'), () => f.tool.execute({}));
    assert.deepEqual(chat.skills, []);
    assert.equal(chat.total, 0);
    assert.deepEqual(f.writes, []);
  });
}

test('scoped discovery is an access-risk feature restricted to Owner + QA by default and can be switched off', async () => {
  const f = fixture('ENFORCE');
  const { default: definition } = f.load('src/lib/flags/definitions/htpr-7663-scoped-agent-skills.ts');
  assert.equal(definition.key, scopedSkillsFlag);
  assert.equal(definition.kind, 'feature');
  assert.equal(definition.releaseRisk.highRisk, 'access');
  assert.equal(definition.defaultMode, 'OWNER_AND_QA');
  const { defaultFeatureFlagMode, isFeatureEnabled } = f.load('src/lib/flags.ts');
  assert.equal(defaultFeatureFlagMode(scopedSkillsFlag), 'OWNER_AND_QA');
  for (const mode of [null, 'OWNER_AND_QA', 'OFF', 'EVERYONE']) {
    for (const [userId, email, ownerOrQa] of [[6, 'valentin.yeo@gmail.com', true], [985, 'valentin@hypertask.ai', true], [7, 'member@example.invalid', false], [6, 'not-owner@example.invalid', false]]) {
      const db = {
        featureFlag: { findUnique: async () => mode ? { mode } : null },
        user: { findUnique: async () => ({ email }) },
      };
      assert.equal(await isFeatureEnabled(scopedSkillsFlag, userId, db), mode === 'EVERYONE' || (mode === null || mode === 'OWNER_AND_QA') && ownerOrQa);
    }
  }
});
