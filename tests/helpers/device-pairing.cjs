const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { NextRequest } = require('next/server');
const { load } = require('../task-route-loader.cjs');

const ORIGIN = 'https://app.hypertask.ai';
const SECRET = 'v'.repeat(43);
const CLAIMANT = 'c'.repeat(43);
const CHALLENGE = createHash('sha256').update(SECRET).digest('base64url');

function fixture() {
  const state = { flows: [], agents: [], teams: [], boards: [], flags: true, owner: 42, actor: null, sequence: 0, rate: 1, failProvision: false, codes: [], humanGrantWrites: 0, grant: null };
  let queue = Promise.resolve();
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('gt' in value) return row[key] != null && row[key] > value.gt;
      if ('lt' in value) return row[key] != null && row[key] < value.lt;
      if ('lte' in value) return row[key] != null && row[key] <= value.lte;
    }
    return row[key] === value;
  });
  const flows = {
    async create({ data }) {
      const row = { id: randomUUID(), createdAt: new Date(), state: 'PENDING', challenge: null, claimantHash: null, clientName: null, oauthClientId: null, agentId: null, teamId: null, projectId: null, credential: null, deliveryResult: null, deliveryRetryUntil: null, ...data };
      state.flows.push(row);
      return { ...row };
    },
    async findMany({ where }) { return state.flows.filter(row => matches(row, where)).map(row => ({ ...row })); },
    async deleteMany({ where }) { const before = state.flows.length; state.flows = state.flows.filter(row => !matches(row, where)); return { count: before - state.flows.length }; },
    async findUnique({ where }) { const row = state.flows.find(row => matches(row, where)); return row ? { ...row } : null; },
    async findFirst({ where }) { const row = state.flows.find(row => matches(row, where)); return row ? { ...row } : null; },
    async findUniqueOrThrow(args) { const row = await flows.findUnique(args); if (!row) throw new Error('missing flow'); return row; },
    async updateMany({ where, data }) { const rows = state.flows.filter(row => matches(row, where)); for (const row of rows) Object.assign(row, data); return { count: rows.length }; },
    async update({ where, data }) { const row = state.flows.find(row => matches(row, where)); assert.ok(row); Object.assign(row, data); return { ...row }; },
  };
  const prisma = {
    devicePairing: flows,
    user: { findUnique: async ({ where }) => ({ id: where.id, email: 'pairing@example.invalid', uid: 'fixture-user', mcpTokensRevokedAt: null }), findUniqueOrThrow: async ({ where }) => ({ id: where.id, email: 'pairing@example.invalid', stripe_customer_id: null }) },
    googleAccount: { findFirst: async () => ({ id: 'existing-account' }) },
    team: { create: async ({ data }) => { const row = { id: `team-${++state.sequence}`, ...data }; state.teams.push(row); return row; } },
    $queryRaw: async () => [{ client_id: 'test-client' }],
    revokedToken: { findFirst: async () => null },
    agent: {
      create: async ({ data }) => { const row = { id: `agent-${++state.sequence}`, revokedAt: null, credentialTeamId: null, credentialTeamAccessBinding: null, runtimeGeneration: 1, ...data }; state.agents.push(row); return row; },
      findFirst: async ({ where }) => state.agents.find(row => matches(row, where)) ?? null,
      updateMany: async ({ where, data }) => { const rows = state.agents.filter(row => matches(row, where)); for (const row of rows) Object.assign(row, data); return { count: rows.length }; },
      update: async ({ where, data }) => { const row = state.agents.find(row => row.id === where.id); assert.ok(row); Object.assign(row, data); return row; },
    },
    user_Activity: { updateMany: async () => ({ count: 1 }) },
    $transaction(run) {
      const result = queue.then(async () => {
        const snapshot = structuredClone({ flows: state.flows, agents: state.agents, teams: state.teams, boards: state.boards, codes: state.codes, humanGrantWrites: state.humanGrantWrites, grant: state.grant });
        try { return await run(prisma); } catch (error) { Object.assign(state, snapshot); throw error; }
      });
      queue = result.catch(() => {});
      return result;
    },
  };
  const mocks = {
    '@/lib/prisma': { default: prisma },
    '@/utils/controllers/logs/createLog': { default: async () => {} },
    '@/lib/telemetry/activationOccurrences': { enqueueAgentConnection: async () => null },
    '@/lib/telemetry/analyticsIntents': { processAnalyticsIntentSoon: () => {} },
    '@/lib/mcp/managementKeyTeamScope': { agentWithinTeamWhere: () => ({}), getManagementKeyTeam: async (_userId, teamId) => {
      const team = state.teams.find(row => row.id === teamId);
      if (!team) return null;
      return { id: team.id, title: team.title ?? null, isOwner: true, accessBinding: 'owner:existing-account:0' };
    } },
    '@/lib/flags': { isFeatureEnabled: async () => { if (state.flagError) throw new Error('flags unavailable'); return state.flags; } },
    '@/lib/auth/currentUser': { loadCurrentUser: async () => state.actor ?? { userId: state.owner, source: 'legacy' } },
    '@/lib/redis': { getRedis: async () => { if (state.rateError) throw new Error('rate store unavailable'); return { eval: async () => state.rate }; } },
    '@/lib/crypto/byokCipher': { encryptSecret: value => `encrypted:${value}`, decryptSecret: value => { assert.ok(value.startsWith('encrypted:')); return value.slice(10); } },
    '@/lib/mcp/auth/verifyJwt': {
      MCP_TOKEN_ISSUED_AT_MS_CLAIM: "mcpIssuedAtMs",
      verifyMcpJwtToken: () => ({ mcpIssuedAtMs: Date.now() }),
      createMcpToken: (_owner, _email, _expiry, agentId, teamScope) => { state.lastTeamScope = teamScope; return `agent-only-test-credential:${agentId}`; },
      agentTokenCredentialFields: token => ({ mcpTokenJti: token ? `generation:${token}` : null, mcpTokenHash: token ? 'test-only-digest' : null }),
    },
    '@/utils/controllers/projects/createProjectWithStableName': { createProjectWithStableName: async data => {
      if (state.failProvision) throw new Error('provisioning interrupted');
      const board = { id: ++state.sequence, ...data };
      state.boards.push(board);
      return board;
    } },
    '@/utils/controllers/projects/create': {
      starterBoardSections: () => ({ create: [] }),
      createProjectViewAndCreateDefault: async () => {},
    },
    '@/lib/telemetry/savedWork': { enqueueBoardCreated: async () => 'analytics-key', processAnalyticsIntentSoon: () => {} },
  };
  const domain = load('src/lib/auth/devicePairing.ts', mocks);
  const { POST } = load('src/app/api/cli/device/[action]/route.ts', { ...mocks, '@/lib/auth/devicePairing': domain });
  async function request(action, body, { cookie, origin = ORIGIN, authorization } = {}) {
    const headers = { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}) };
    const response = await POST(new NextRequest(`${ORIGIN}/api/cli/device/${action}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }), { params: Promise.resolve({ action }) });
    const data = await response.json();
    return { response, status: response.status, data };
  }
  async function start() {
    const result = await request('start', {});
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.match(result.response.headers.get('cache-control'), /no-store/);
    const setCookie = result.response.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    return { ...result.data, cookie: setCookie.split(';')[0] };
  }
  async function claim(flow, overrides = {}) {
    const result = await request('claim', { code: flow.code, claimant: CLAIMANT, challenge: CHALLENGE, clientName: 'Test terminal', ...overrides });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result;
  }
  async function approved() {
    const flow = await start(); await claim(flow);
    const result = await request('approve', { id: flow.id }, flow);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return flow;
  }
  return { state, prisma, domain, request, start, claim, approved, load: (file, extra = {}) => load(file, { ...mocks, ...extra }) };
}


module.exports = { fixture, ORIGIN, SECRET, CLAIMANT, CHALLENGE };
