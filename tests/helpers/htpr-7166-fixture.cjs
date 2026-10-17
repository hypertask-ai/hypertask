const { load } = require('../task-route-loader.cjs');

function matches(row, where = {}) {
  if (!row) return false;
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'OR') return value.some(branch => matches(row, branch));
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(branch => matches(row, branch));
    if (value === null || typeof value !== 'object') return row[key] === value;
    if ('some' in value) return (Array.isArray(row[key]) ? row[key] : []).some(item => matches(item, value.some));
    if ('none' in value) return !(Array.isArray(row[key]) ? row[key] : []).some(item => matches(item, value.none));
    if ('isNot' in value) return row[key] != null;
    if ('in' in value) return value.in.includes(row[key]);
    if ('not' in value) return row[key] !== value.not;
    if ('equals' in value) return row[key] === value.equals;
    return matches(row[key], value.is ?? value);
  });
}
function project(row, query = {}) {
  if (!row) return null;
  const out = query.select ? {} : Object.fromEntries(Object.entries(row).filter(([, value]) => value === null || typeof value !== 'object' || value instanceof Date));
  for (const [key, rule] of Object.entries(query.select ?? query.include ?? {})) {
    if (!rule) continue;
    if (rule === true) out[key] = ['appliedView', 'unsavedView', 'default_view', 'project_view', 'project', 'owner', 'user', 'section', 'members'].includes(key) ? (Array.isArray(row[key]) ? row[key].map(item => project(item)) : project(row[key])) : row[key];
    else if (Array.isArray(row[key])) out[key] = row[key].filter(item => matches(item, rule.where)).slice(rule.skip ?? 0, rule.take === undefined ? undefined : (rule.skip ?? 0) + rule.take).map(item => project(item, rule));
    else out[key] = project(row[key], rule);
  }
  return out;
}
function fixture(options = {}) {
  const userId = options.anonymous ? null : 42;
  const agent = { id: 'owned-agent', userId: options.foreignAgent ? 99 : 42, revokedAt: options.revokedAgent ? new Date() : null };
  const human = { id: 42, agents: [agent] };
  const board = { id: 17, ownerId: options.owner ? 42 : 99, teamId: options.teamless ? null : 7, status: options.status ?? 'Normal', owner: options.owner ? human : { id: 99, agents: [] }, members: options.member ? [{ userId: 42, agentId: null, status: options.member, user: human }] : options.agent ? [{ userId: 99, agentId: agent.id, status: 'Accepted', agent }] : [], section: [{ id: 1, projectId: 17, deleted: false, section_title: 'Safe column', visibility: true }] };
  const pv = { id: 'pv', projectId: 17, default_view_id: 'default', project: board };
  const makeView = (id, overrides = {}) => ({ id, userId: 99, visibility: 'Public', title: id, slug: id, createdAt: new Date(0), lastUsedAt: new Date(0), project_view_id: 'pv', project_view: pv, owner: { id: 99, email: 'owner@example.test' }, ViewLastUsed: [], unsaved_User_Project_View: [], board_columns_view: [{ id: 1, section_title: id }], board_filters: { addedFilters: [] }, board_layout: 'Table', board_show_archived: true, board_staleness: null, ...overrides });
  const view = makeView('view', options.view);
  const defaultView = makeView('default', options.defaultView);
  const draft = makeView('draft', { userId: 42, visibility: 'Private', ...options.draft });
  const uv = { id: 'uv', userId: 42, project_view_id: 'pv', appliedViewId: 'view', unsavedViewId: options.unsaved ? 'draft' : null, appliedView: view, unsavedView: options.unsaved ? draft : null, project_view: pv, view_order: [] };
  Object.assign(pv, { default_view: defaultView, user_project_views: [uv], allViews: [view, defaultView] });
  board.project_view = pv;
  const effects = [], queries = [], writes = [];
  const views = [view, defaultView, draft];
  const read = (name, rows, unique = false) => async query => {
    queries.push([name, query]);
    const eligible = rows.filter(row => matches(row, query.where));
    return unique ? project(eligible[0], query) : eligible.map(row => project(row, query));
  };
  const write = (name, result) => async query => { effects.push(name); writes.push([name, query]); return typeof result === 'function' ? result(query) : result; };
  const prisma = {
    project: { findFirst: read('project', [board], true), findUnique: read('project', [board], true), findMany: read('projects', [board]) },
    project_View: { findFirst: read('container', [pv], true), findUnique: read('container', [pv], true), findMany: read('containers', [pv]), upsert: write('container-upsert', pv) },
    user_Project_View: { findUnique: async query => { queries.push(['state', query]); return options.noState ? null : project(uv, query); }, upsert: write('state-upsert', uv), update: write('state-update', uv), create: write('state-create', uv) },
    view: { findFirst: read('view', views, true), findUnique: read('view', views, true), findMany: read('views', [view, defaultView]), count: async query => { queries.push(['count', query]); return [view, defaultView].filter(row => matches(row, query.where)).length; }, update: write('view-update', query => ({ ...project(view), ...query.data })), delete: write('view-delete', view), deleteMany: write('view-deleteMany', { count: 1 }), create: write('view-create', query => ({ ...draft, ...query.data })) },
    view_Last_Used: { upsert: write('recency-upsert', {}), deleteMany: write('recency-delete', { count: 1 }) },
    section: { findMany: read('sections', board.section), findFirst: read('section', board.section, true), create: write('section-create', { id: 2, projectId: 17, section_title: 'New', visibility: true, deleted: false, ranking: 'a', isDone: null }) },
    invite: { findFirst: async () => ({ projectId: 17, userId: 42, expired: false }) },
    user: { findUnique: async () => ({ id: 42 }) },
    task: { findMany: read('tasks', []) },
    label: { findMany: async () => [] },
    $transaction: async operation => { effects.push('transaction'); return operation(prisma); },
  };
  class ManagedSmartSplitMutationError extends Error { constructor() { super('Manage this smart split from Manage views'); this.status = 409; } }
  const lock = async () => { effects.push('lock'); if (options.race) options.race({ board, view, defaultView, uv }); };
  const mocks = {
    '@/lib/telemetry/savedWork': { enqueueColumnCreated: async () => 'column-key', processAnalyticsIntentSoon: () => {} },
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/utils/controllers/tasks/attachWaitingOnUsers': { attachWaitingOnUsers: async rows => rows },
    '@/utils/controllers/tasks/attachOpenBlockingTasks': { attachOpenBlockingTasks: async rows => rows },
    '@/utils/controllers/tasks/attachAgentStatus': {},
    '@/lib/prisma': { default: prisma },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => userId === null ? null : { userId } },
    '@/lib/auth/sessionUserRecord': { loadSessionUserRecord: async () => ({ id: 42 }) },
    '@/lib/realtime/server': { broadcastBoardChange: () => effects.push('broadcast') },
    '@/utils/controllers/projects/views/boardFilterWriteLock': { acquireBoardFilterWriteLock: lock, assertViewIsNotManagedSmartSplit: async () => { effects.push('smart-guard'); if (options.managed) throw new ManagedSmartSplitMutationError(); }, ManagedSmartSplitMutationError, withBoardFilterWriteLock: async (_id, _filters, operation) => { await lock(); return operation(prisma); }, MissingBoardFilterLabelError: class extends Error {} },
    '@/lib/agents/publicAgent': { publicAgentSelect: {} }, '@/lib/cycles': { CYCLE_WINDOW_SIZE: 5, utcDate: () => new Date(0) }, '@/lib/agents/visibility': { boardAgentVisibilityWhere: () => ({}) }, '@/utils/controllers/notifications/visibleInboxScope': { visibleUserInboxWhere: () => ({}) },
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: fn => fn, validateMcpRouteAuth: async () => userId === null ? null : { user: { id: 42 }, agentId: options.agent ? agent.id : undefined }, checkMcpRouteRateLimit: async () => null },
    '@/lib/mcp/views/services': { createView: () => { throw Error('unused'); } },
    '@/lib/mcp/tasks/services': { validateProjectAccess: async () => ({ project: board, error: null }) },
    '@/utils/controllers/notifications/agentFirstTaskEmail': {}, '@/lib/telemetry/activationOccurrences': {},
    './viewHelpers': { appendSectionToAllViews: write('fanout', undefined) },
    '@/utils/helperFunctions/helperFunctions': { isDeepEqual: () => false, getCurrentProject: () => ({ _sections: [], firstTask: null }) },
    '@/utils/helperFunctions/Views/FilterHelperFunctions': { defaultFilterSettings: {}, getFilteredSections: value => value },
    '@/utils/helperFunctions/Views/SubtaskHelperFunction': { defaultSubtaskSettings: 'Show', getAppliedSubtaskSections: value => value },
    '@/utils/helperFunctions/Views/EmptySectionsHelperFunction': { defaultEmptySections: 'Show', getFilteredEmptySections: value => value },
    '@/lib/ai/tools/utils/sanitize': { sanitizeForJson: value => value },
    'ai': { tool: value => value },
  };
  return { board, pv, view, defaultView, draft, uv, effects, writes, queries, prisma, mocks, load: file => load(file, mocks), request: (body, query = {}) => ({ headers: new Headers(), query, json: async () => body }) };
}
const { savedViewBoardAccessWhere } = load('src/utils/controllers/projects/getAllIncludes.ts', {
  '@/lib/agents/publicAgent': {}, '@/lib/cycles': {}, '@/lib/agents/visibility': {}, '@/utils/controllers/notifications/visibleInboxScope': {},
});
module.exports = { fixture, matches, project, savedViewBoardAccessWhere };
