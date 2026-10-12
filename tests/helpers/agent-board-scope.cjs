const path = require('node:path');
const { load } = require('../task-route-loader.cjs');
const root = path.resolve(__dirname, '../..');
const jiti = require('jiti')(__filename, { interopDefault: true, alias: { '@': path.join(root, 'src') } });
const access = jiti(path.join(root, 'src/utils/controllers/projects/getAllIncludes.ts'));

function matches(row, where = {}) {
  if (row == null) return where === null;
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
  const agent = { id: 'scope-agent', userId: user.id, revokedAt: null, runtimeGeneration: 1, permissions: { role: 'write' } };
  const projects = [15, 4060, 2128].map(id => ({ id, ownerId: user.id, owner: user, createdAt: new Date(), section: [], labels: [], _count: { members: 1, tasks: 1 }, teamId: 'team', status: 'Normal', title: `Board ${id}`, name: `Board ${id}`, members: id === 2128 ? [] : [{ userId: user.id, agentId: agent.id, status: 'Accepted', agent }] }));
  const tasks = projects.map(project => ({ id: project.id * 10, projectId: project.id, project, userId: user.id, user, status: 'Normal', title: `Task ${project.id}`, description: 'scope fixture', description_: { content: 'scope fixture' }, section: 'Todo', sectionId: project.id, uniqueIndex: 1, ticketNumber: `HTPR-${project.id}`, parentTaskId: null, parentTask: null, subTasks: [], Reminders: [], assignees: [], followers: [], taskLabels: [], attachments: [], pullRequests: [], customFieldValues: [], savedContent: [], agent: null, priority: null, estimate: null, _count: { comments: 0 }, createdAt: new Date(), updatedAt: new Date(), sectionChangedAt: new Date() }));
  const notifications = tasks.map(task => ({ id: task.id, userId: user.id, agentId: null, taskId: task.id, projectId: task.projectId, task, project: task.project, status: 'Normal', type: 'Mentioned', seen: false, archivedAt: null, fromUserId: 7, fromAgentId: null, createdAt: new Date(), fromUser: { displayName: 'Sender' }, fromAgent: null }));
  const state = { user, agent, projects, tasks, notifications, writes: [], ctx: { user, agentId: agent.id } };
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
    task: model(tasks, 'task'), project: model(projects, 'project'), notification: model(notifications, 'notification'), user: model([user], 'user'), agent: model([agent], 'agent'), taskNumberAlias: model([], 'alias'), section: model(projects.map(project => ({ id: project.id, projectId: project.id, section_title: 'Todo', deleted: false })), 'section'),
    revokedToken: model([], 'revoked'), team: model([{ id: 'team', googleAccountId: 'account' }], 'team'),
    userSetting: { findUnique: async () => null },
    $transaction: async run => run(prisma),
  };
  const mocks = {
    '@/lib/prisma': { default: prisma },
    '@/utils/controllers/projects/getAllIncludes': access,
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/lib/realtime/server': { broadcastBoardChange: async () => {}, broadcastTaskChange: async () => {}, broadcastInboxChange: async () => {}, broadcastTaskComment: async () => {} },
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: handler => handler, validateMcpRouteAuth: async () => state.ctx, checkMcpRouteRateLimit: async () => null },
    '@/lib/mcp/auth': { createUnauthorizedResponse: () => Response.json({}, { status: 401 }), checkMcpRateLimit: async () => null, validateMcpAuth: async () => state.ctx },
    '@/lib/auth/sessionUserRecord': { loadSessionUserRecord: async () => user },
    '@/utils/controllers/projects/findPrefixAliasTasks': { findPrefixAliasTasks: async () => [] },
    '@/utils/controllers/logs/createLog': { default: async () => {} },
  };
  return { ...state, state, prisma, mocks, load: (file, extra = {}) => load(file, { ...mocks, ...extra }) };
}
module.exports = { access, fixture, matches, hydrate, load };
