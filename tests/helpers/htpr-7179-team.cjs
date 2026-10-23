const { fixture, matches, hydrate } = require('./agent-board-scope.cjs');
const teamScope = { teamId: 'team-a', accessBinding: 'owner:account-a:0' };
function teamFixture(mode, actor = 'bound') {
  const f = fixture();
  f.state.enforce = mode === 'ENFORCE';
  if (mode === 'FLAG_ERROR') f.state.flagError = new Error('fixture flag lookup failed');
  f.state.ctx.teamScope = actor === 'bound' ? teamScope : null;
  if (actor === 'human') f.state.ctx.agentId = null;
  const originalProject = f.projects[0];
  const originalTask = f.tasks[0];
  const unrelated = { id: 7, agents: [] };
  const definitions = [
    [15, 'A1', 'team-a', true, false], [16, 'A2', 'team-a', false, true],
    [17, 'A3', 'team-a', false, false], [25, 'B1', 'team-b', true, false],
    [26, 'B2', 'team-b', false, true], [35, 'C1', 'team-c', false, false],
    [45, 'L', null, true, false],
  ];
  f.projects.splice(0, f.projects.length, ...definitions.map(([id, label, teamId, owned, member]) => {
    const humanMember = { userId: f.user.id, user: f.user, agentId: null, status: 'Accepted' };
    const grant = (label === 'A1' || label === 'A2' || actor === 'unbound' && ['B1', 'B2'].includes(label));
    return { ...originalProject, id, title: `${label}-sentinel`, name: label, uniqueIdentifier: label, teamId, ownerId: owned ? f.user.id : unrelated.id, owner: owned ? f.user : unrelated, members: [...(member ? [humanMember] : []), ...(grant ? [{ userId: f.user.id, agentId: f.agent.id, status: 'Accepted', agent: f.agent }] : [])] };
  }));
  f.tasks.splice(0, f.tasks.length, ...f.projects.map(project => ({ ...originalTask, id: project.id * 10, projectId: project.id, project, title: `${project.name}-sentinel`, description: `${project.name}-sentinel`, description_: { content: `${project.name}-sentinel` }, ticketNumber: `${project.name}-1`, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), dueDate: null, savedContent: [], _count: { comments: 1, taskLabels: 0 } })));
  f.agent.members = f.projects.filter(p => p.members.some(m => m.agentId === f.agent.id)).map(project => ({ id: project.id, projectId: project.id, status: 'Accepted', project }));
  function model(rows, name) {
    return {
      findFirst: async args => hydrate(rows.find(row => matches(row, args.where)), args),
      findUnique: async args => hydrate(rows.find(row => matches(row, args.where)), args),
      findMany: async (args = {}) => rows.filter(row => matches(row, args.where)).map(row => hydrate(row, args)),
      count: async ({ where }) => rows.filter(row => matches(row, where)).length,
      create: async ({ data }) => { f.writes.push(name); const row = { id: 900 + rows.length, createdAt: new Date('2026-01-01'), ...data }; rows.push(row); return row; },
      updateMany: async ({ where, data }) => { const selected = rows.filter(row => matches(row, where)); selected.forEach(row => Object.assign(row, data)); if (selected.length) f.writes.push(name); return { count: selected.length }; },
      update: async ({ where, data }) => { const row = rows.find(row => matches(row, where)); if (!row) throw new Error('fixture not found'); f.writes.push(name); Object.assign(row, data); return row; },
      delete: async ({ where }) => { const index = rows.findIndex(row => matches(row, where)); if (index < 0) throw new Error('fixture not found'); f.writes.push(name); return rows.splice(index, 1)[0]; },
      deleteMany: async ({ where }) => { const selected = rows.filter(row => matches(row, where)); for (const row of selected) rows.splice(rows.indexOf(row), 1); if (selected.length) f.writes.push(name); return { count: selected.length }; },
    };
  }
  const pages = f.tasks.map(task => ({ id: task.id, publicId: `page-${task.projectId}`, projectId: task.projectId, project: task.project, taskId: null, task: null, links: [], _count: { links: 0 }, subPages: [], parentPage: null, parentPageId: null, archived: false, title: task.title, contentHtml: `<p>${task.title}</p>`, contentText: task.title, version: 1, updatedAt: task.updatedAt }));
  const comments = f.tasks.map(task => ({ id: task.id, taskId: task.id, task, creatorId: f.user.id, creator: f.user, text: task.title, activity: null, createdAt: task.createdAt, editedAt: null, editedByUserId: null, editedByAgentId: null, attachments: [], reactions: [], agent: null }));
  f.prisma.section = model(f.projects.map(project => ({ id: project.id, projectId: project.id, section_title: 'Todo', visibility: true, deleted: false, ranking: 'a' })), 'section');
  f.prisma.page = model(pages, 'page');
  f.prisma.comment = model(comments, 'comment');
  const agents = { getMcpSessionAgentSummary: async () => null, mapVisibleMcpAgent: () => null, mcpVisibleAgentSelect: () => ({ id: true }), loadVisibleMcpAgents: async () => new Map() };
  Object.assign(f.mocks, {
    '@/lib/mcp/agents': agents,
    '@/lib/mcp/agents/scopes': { requireRole: async () => null },
    '@/utils/controllers/activities/createLabelActivity': {},
    '@/lib/agentWebhooks/outbox': {},
    '@/utils/controllers/urls/extractUrlsFromContent': { persistUrlsForDescription: async () => {}, persistUrlsForComment: async () => {} },
    '@/utils/controllers/pages/standalonePagesEnabled': { standalonePagesEnabled: async () => true },
    '@/utils/controllers/turbopuffer/turbopufferHelper': { convertToPlain: s => s, upsertPageToTurbopuffer: async () => {}, deletePageFromTurbopuffer: async () => {} },
  });
  const services = f.load('src/lib/mcp/tasks/services.ts');
  f.mocks['@/lib/mcp/tasks/services'] = services;
  return { ...f, pages, comments, model, services };
}

module.exports = { teamFixture, teamScope, matches, hydrate };
