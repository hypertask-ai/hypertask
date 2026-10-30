const { withStubs } = require('./stub-map.cjs');
const path = require('node:path');
const { load } = require('../task-route-loader.cjs');
const root = path.resolve(__dirname, '../..');
const jiti = require('jiti')(__filename, { interopDefault: true, alias: { '@': path.join(root, 'src') } });
const access = jiti(path.join(root, 'src/utils/controllers/projects/getAllIncludes.ts'));

function matches(row, where = {}) {
  if (row == null) return where === null || where?.equals === require('@prisma/client').Prisma.DbNull;
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined || key === 'mode') return true;
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(branch => matches(row, branch));
    if (key === 'OR') return value.some(branch => matches(row, branch));
    if (key === 'NOT') return !(Array.isArray(value) ? value : [value]).some(branch => matches(row, branch));
    if (key === 'some') return row.some(item => matches(item, value));
    if (key === 'every') return row.every(item => matches(item, value));
    if (key === 'none') return !row.some(item => matches(item, value));
    if (key === 'is') return matches(row, value);
    if (key === 'in') return value.includes(row);
    if (key === 'notIn') return !value.includes(row);
    if (key === 'not') return !matchesValue(row, value);
    if (key === 'equals') return String(row).toLowerCase() === String(value).toLowerCase();
    if (key === 'contains') return String(row).toLowerCase().includes(value.toLowerCase());
    if (key === 'startsWith') return row.startsWith(value);
    if (key === 'gt') return row > value;
    if (key === 'gte') return row >= value;
    if (key === 'lte') return row <= value;
    return matchesValue(row[key], value);
  });
}
function matchesValue(row, value) {
  return value && typeof value === 'object' && !(value instanceof Date) ? matches(row, value) : row === value;
}
function hydrate(row, args = {}) {
  if (!row) return null;
  const result = args.select ? {} : { ...row };
  for (const [key, options] of Object.entries(args.select ?? args.include ?? {})) {
    if (options === true) result[key] = row[key];
    else if (options && typeof options === 'object') {
      result[key] = Array.isArray(row[key])
        ? row[key].filter(item => matches(item, options.where)).map(item => hydrate(item, options))
        : row[key] && matches(row[key], options.where) ? hydrate(row[key], options) : null;
    }
  }
  return result;
}
function fixture() {
  const user = { id: 6, email: 'scope@example.invalid', displayName: 'Owner', photoURL: null, mcpTokensRevokedAt: null };
  const agent = { crossTeamHomeTeamId: null, archivedAt: null, id: 'scope-agent', userId: user.id, revokedAt: null, credentialTeamId: null, credentialTeamAccessBinding: null, mcpTokenJti: null, runtimeGeneration: 1, permissions: { role: 'write' } };
  const projects = [15, 4060, 2128].map(id => ({ id, ownerId: user.id, owner: user, createdAt: new Date(), section: [], labels: [], _count: { members: 1, tasks: 1 }, teamId: 'team', status: 'Normal', title: `Board ${id}`, name: `Board ${id}`, members: id === 2128 ? [] : [{ userId: user.id, agentId: agent.id, status: 'Accepted', agent }] }));
  const tasks = projects.map(project => ({ id: project.id * 10, projectId: project.id, project, userId: user.id, user, status: 'Normal', title: `Task ${project.id}`, description: 'scope fixture', description_: { content: 'scope fixture' }, section: 'Todo', sectionId: project.id, uniqueIndex: 1, ticketNumber: `HTPR-${project.id}`, parentTaskId: null, parentTask: null, subTasks: [], Reminders: [], assignees: [], followers: [], taskLabels: [], attachments: [], pullRequests: [], customFieldValues: [], savedContent: [], agent: null, priority: null, estimate: null, _count: { comments: 0 }, createdAt: new Date(), updatedAt: new Date(), sectionChangedAt: new Date() }));
  const notifications = tasks.map(task => ({ id: task.id, userId: user.id, agentId: null, taskId: task.id, projectId: task.projectId, task, project: task.project, status: 'Normal', type: 'Mentioned', seen: false, archivedAt: null, fromUserId: 7, fromAgentId: null, createdAt: new Date(), fromUser: { displayName: 'Sender' }, fromAgent: null }));
  user.agents = [agent];
  const state = { enforce: true, events: [], grantReads: 0, flagReads: 0, user, agent, projects, tasks, notifications, writes: [], ctx: { user, agentId: agent.id, teamScope: null } };
  function model(rows, name) {
    return {
      findMany: async (args = {}) => rows.filter(row => matches(row, args.where)).slice(0, args.take ?? rows.length).map(row => hydrate(row, args)),
      findFirst: async (args = {}) => hydrate(rows.find(row => matches(row, args.where)), args),
      findUnique: async (args = {}) => hydrate(rows.find(row => matches(row, args.where)), args),
      count: async ({ where }) => rows.filter(row => matches(row, where)).length,
      updateMany: async ({ where, data }) => {
        const selected = rows.filter(row => matches(row, where));
        selected.forEach(row => Object.assign(row, data));
        if (selected.length) state.writes.push(name);
        return { count: selected.length };
      },
      update: async ({ where, data }) => {
        const row = rows.find(row => matches(row, where));
        state.writes.push(name);
        Object.assign(row, data);
        return row;
      },
      delete: async () => { state.writes.push(name); return {}; },
      deleteMany: async () => { state.writes.push(name); return { count: 1 }; },
      create: async ({ data }) => { state.writes.push(name); return { id: 1, ...data }; },
    };
  }
  const prisma = {
    task: model(tasks, 'task'), project: model(projects, 'project'), notification: model(notifications, 'notification'), user: model([user], 'user'), agent: model(user.agents, 'agent'), taskNumberAlias: model([], 'alias'), section: model(projects.map(project => ({ id: project.id, projectId: project.id, section_title: 'Todo', deleted: false })), 'section'),
    revokedToken: model([], 'revoked'), team: model([{ id: 'team', googleAccountId: 'account' }], 'team'),
    userSetting: { findUnique: async () => null },
    $transaction: async run => run(prisma),
  };
  prisma.member = { findMany: async args => {
    state.grantReads++;
    return projects.flatMap(project => project.members.map(member => ({ ...member, projectId: project.id }))).filter(row => matches(row, args.where)).map(row => hydrate(row, args));
  } };
  const crossTeamContext = load('src/lib/auth/crossTeamContext.ts', {});
  const scope = load('src/lib/auth/agentScope.ts', {
    '@/lib/auth/crossTeamContext': crossTeamContext,
    '@/lib/prisma': { default: prisma },
    '@/lib/flags': { isFeatureEnabled: async () => { state.flagReads++; if (state.flagError) throw state.flagError; return state.enforce; } },
    '@/lib/telemetry/signupAnalytics': { recordServerCapture: capture => state.events.push(capture) },
  });
  const scopedAccess = load('src/utils/controllers/projects/getAllIncludes.ts', { '@/lib/auth/agentScope': scope, '@/lib/auth/crossTeamContext': crossTeamContext });
  const mocks = {
    '@/lib/auth/agentScope': scope,
    '@/lib/auth/crossTeamContext': crossTeamContext,
    '@/lib/prisma': { default: prisma },
    '@/utils/controllers/projects/getAllIncludes': scopedAccess,
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/lib/realtime/server': { broadcastBoardChange: async () => {}, broadcastTaskChange: async () => {}, broadcastInboxChange: async () => {}, broadcastTaskComment: async () => {} },
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: handler => (req, ...args) => scope.withAgentScopeRequest(req, async () => { await scope.prepareAgentScope(state.ctx.user.id, state.ctx.agentId); return handler(req, ...args); }), validateMcpRouteAuth: async () => state.ctx, checkMcpRouteRateLimit: async () => null },
    '@/lib/mcp/auth': { createUnauthorizedResponse: () => Response.json({}, { status: 401 }), checkMcpRateLimit: async () => null, validateMcpAuth: async () => state.ctx },
    '@/lib/auth/sessionUserRecord': { loadSessionUserRecord: async () => user },
    '@/utils/controllers/projects/findPrefixAliasTasks': { findPrefixAliasTasks: async () => [] },
    '@/utils/controllers/logs/createLog': { default: async () => {} },
  };
  return { ...state, state, prisma, mocks, scope, access: scopedAccess, run: (req, run) => scope.withAgentScopeRequest(req, async () => { await scope.prepareAgentScope(state.ctx.user.id, state.ctx.agentId); return run(); }), load: (file, extra = {}) => load(file, withStubs(mocks, extra)) };
}
module.exports = { access, fixture, matches, hydrate, load };

module.exports.configureActor = (f, kind) => {
  if (kind === 'human') f.state.ctx.agentId = null;
  if (kind === 'zero' || kind === 'pending') f.projects.forEach(project => { project.members = []; });
  if (kind === 'pending') f.projects[0].members = [{ agentId: f.agent.id, status: 'Pending', agent: f.agent }];
  if (kind === 'revoked') f.agent.revokedAt = new Date();
  if (kind === 'other-owner') f.agent.userId = 7;
};

module.exports.enforcedScope = {
  agentScopeEnforced: () => true,
  recordAgentBoardScopeMiss: () => {},
  prepareAgentScope: async () => {},
  withAgentScopeRequest: (_request, run) => run(),
};
