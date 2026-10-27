const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const FLAG = ['htpr', '7582', 'agent', 'access', 'request'].join('-');
const NOW = new Date('2026-10-24T12:00:00Z');
const ID = 'f605ee00-b3a3-41c4-bb9c-954d570d87d4';
const ctx = (extra = {}) => ({ user: { id: 6, email: 'owner@example.test' }, agentId: 'agent-1', teamScope: null, agentTokenGeneration: 'generation-1', agentRuntimeGeneration: 1, ...extra });
const session = (extra = {}) => ({ userId: 6, source: 'legacy', teamScope: null, needsBridge: true, ...extra });
const clone = value => structuredClone(value);
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(part => matches(row, part));
    if (key === 'OR') return value.some(part => matches(row, part));
    if (key === 'NOT') return !matches(row, value);
    const item = row[key];
    if (value === null || typeof value !== 'object' || value instanceof Date) return value instanceof Date ? +item === +value : item === value;
    if ('not' in value && (typeof value.not !== 'object' || value.not === null)) return item !== value.not;
    if ('in' in value) return value.in.includes(item);
    if ('gt' in value) return item > value.gt;
    if ('gte' in value) return item >= value.gte;
    if ('lte' in value) return item <= value.lte;
    if ('some' in value) return item.some(part => matches(part, value.some));
    return item != null && matches(item, value);
  });
}
function fixture(overrides = {}) {
  const state = {
    agent: { id: 'agent-1', userId: 6, displayName: 'Grok Bot', photoURL: null, revokedAt: null, archivedAt: null,
      credentialTeamId: null, credentialTeamAccessBinding: null, mcpTokenJti: 'generation-1', runtimeGeneration: 1,
      permissions: { role: 'write' }, members: [] },
    board: { id: 15, ownerId: 6, teamId: 'team-1', name: 'project-15', title: 'Software Factory', status: 'Normal' },
    requests: [], notifications: [], members: [], logs: [], flag: true, grants: 0, broadcasts: 0, locks: 0,
    ...overrides,
  };
  let tail = Promise.resolve();
  let conflicts = 0;
  const db = {};
  const table = (name) => ({
    findUnique: async ({ where }) => state[name].find(row => matches(row, where)) ?? null,
    findFirst: async ({ where = {} } = {}) => state[name].find(row => matches(row, where)) ?? null,
    findMany: async ({ where = {}, take } = {}) => state[name].filter(row => matches(row, where)).slice(0, take),
    count: async ({ where }) => state[name].filter(row => matches(row, where)).length,
    create: async ({ data }) => { const row = { id: name === 'requests' ? ID : state[name].length + 1, status: name === 'notifications' ? 'Normal' : 'pending', seen: false, archivedAt: null, createdAt: NOW, resolvedAt: null, resolutionReason: null, ...clone(data) }; state[name].push(row); return clone(row); },
    update: async ({ where, data }) => { const row = state[name].find(row => matches(row, where)); assert.ok(row, name); Object.assign(row, clone(data)); return clone(row); },
    updateMany: async ({ where, data }) => { const rows = state[name].filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, clone(data))); return { count: rows.length }; },
    deleteMany: async ({ where }) => { const rows = state[name].filter(row => !matches(row, where)); const count = state[name].length - rows.length; state[name] = rows; return { count }; },
  });
  db.agentBoardAccessRequest = table('requests');
  db.agent = { findUnique: async ({ where }) => state.agent?.id === where.id ? clone(state.agent) : null,
    findFirst: async ({ where }) => state.agent && matches(state.agent, where) ? clone(state.agent) : null };
  db.project = { findFirst: async ({ where }) => {
    if (!state.board || state.board.id !== where.id || state.board.status !== where.status) return null;
    if (state.noAccess && where.OR) return null;
    return clone(state.board);
  } };
  db.member = table('members');
  db.member.create = async ({ data }) => { if (state.failGrant) throw Error('insert failed'); state.grants++;
    const row = { id: state.members.length + 31, ...clone(data), agent: clone(state.agent), user: { id: 6 } }; state.members.push(row); return row; };
  db.notification = table('notifications');
  const attach = row => row ? { ...clone(row), boardAccessRequest: clone(state.requests.find(request => request.id === row.boardAccessRequestId)) } : null;
  db.notification.findMany = async ({ where = {} }) => state.notifications.map(attach).filter(row => matches(row, where));
  db.notification.findFirst = async ({ where }) => state.notifications.map(attach).find(row => matches(row, where)) ?? null;
  db.logs = { findFirst: async () => state.disabledSince ? { id: 7 } : null, create: async ({ data }) => { if (state.failAudit) throw Error('audit failed'); state.logs.push(data.log.startsWith('{') ? JSON.parse(data.log) : { marker: data.log }); return data; } };
  db.featureFlagChange = { findFirst: async () => state.disabledSince ? { id: 7 } : null };
  db.$queryRaw = async () => { state.locks++; return [{ id: 6 }]; };
  db.$transaction = async (run, options) => {
    if (options) assert.equal(options.isolationLevel, 'Serializable');
    if (conflicts-- > 0) throw { code: 'P2034' };
    const previous = tail; let release; tail = new Promise(resolve => { release = resolve; }); await previous;
    const before = clone(state);
    try { return await run(db); } catch (error) { Object.assign(state, before); throw error; } finally { release(); }
  };
  const stubs = {
    '@/lib/prisma': { __esModule: true, default: db },
    '@/lib/flags/keys': {},
    '@/lib/flags': { isFeatureEnabled: async () => { if (state.flagFailure) throw Error('flag lookup failed'); return state.flag; } },
    '@/lib/realtime/server': { broadcastInboxChange: async () => { state.broadcasts++; if (state.broadcastFails) throw Error('realtime down'); }, socketIdFromHeader: () => undefined },
    '@/lib/mcp/managementKeyTeamScope': { getManagementKeyTeam: async () => state.bindingRevoked ? null : { id: state.agent?.credentialTeamId ?? 'team-1', accessBinding: state.agent?.credentialTeamAccessBinding ?? 'binding-1' } },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({}) },
    '@/lib/agents/publicAgent': { publicAgentSelect: {} },
    '@/lib/agents/visibility': { boardAgentVisibilityWhere: () => ({}) },
    '@/lib/auth/agentScope': { agentScopeEnforced: () => true, recordAgentBoardScopeMiss: () => {} },
    '@/lib/mcp/agents/scopes': { getAgentRole: async () => state.agent?.permissions?.role ?? 'write', requireRole: async () => null },
  };
  const load = loader(stubs);
  const service = load('src/lib/agents/boardAccessRequests/service.ts');
  return { state, db, stubs, load, service, conflict: n => { conflicts = n; }, async create(input = {}) { return service.createBoardAccessRequest(ctx(), { project_id: 15, reason: 'Investigate deployment', ...input }, NOW); } };
}
const compiled = new Map();
function loader(stubs = {}) {
  const cache = new Map();
  function load(file) {
    const full = path.isAbsolute(file) ? file : path.join(root, file);
    if (cache.has(full)) return cache.get(full).exports;
    const loaded = { exports: {} }; cache.set(full, loaded);
    const code = compiled.get(full) ?? ts.transpileModule(fs.readFileSync(full, 'utf8'), { fileName: full, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true }, reportDiagnostics: true });
    compiled.set(full, code);
    assert.deepEqual(code.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), [], full);
    const requireLocal = name => {
      if (name in stubs) return stubs[name];
      if (name.startsWith('.') || name.startsWith('@/')) {
        let target = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(full), name);
        const candidates = [target, target + '.ts', target + '.tsx', target + '.json', path.join(target, 'index.ts')];
        target = candidates.find(item => fs.existsSync(item) && fs.statSync(item).isFile());
        if (!target) throw Error(`Missing ${name} from ${full}`);
        if (target.endsWith('.json')) return JSON.parse(fs.readFileSync(target, 'utf8'));
        return load(target);
      }
      if (name.startsWith('node:') || ['crypto', 'zod', 'next/server', 'react', 'react-dom/server'].includes(name)) return require(name);
      throw Error(`Unstubbed dependency (offline test): ${name} from ${full}`);
    };
    vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${code.outputText}\n})`, { filename: full })(requireLocal, loaded, loaded.exports, full, path.dirname(full));
    return loaded.exports;
  }
  return load;
}
module.exports = { fixture, loader, source, root, ctx, session, NOW, ID, FLAG, matches, ts };
