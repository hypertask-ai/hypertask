const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./task-route-loader.cjs');

function fixture(entry) {
  const agentId = entry === 'route' ? 'caller-agent' : undefined;
  const teamScope = entry === 'route' ? { teamId: 'team-a', accessBinding: 'owner:account-a:0' } : undefined;
  const access = { status: { not: 'Deleted' }, project: { viewer: 6, agentId, teamScope } };
  const person = { id: 7, email: 'owner@example.com', displayName: 'Owner' };
  const agent = { id: 'agent', displayName: 'Runner', userId: 6, visibility: 'PRIVATE', members: [], photoURL: null };
  const hiddenAgent = { ...agent, id: 'hidden-agent', displayName: 'Secret', userId: 9 };
  const task = (id, extra = {}) => ({
    id, ticketNumber: `HT-${id}`, title: `Task ${id}`, uniqueIndex: id,
    projectId: 15, section: 'In Progress', assignees: [{ user: person, agent: null, agentAssigner: null }],
    status: 'Normal', accessible: true, ...extra,
  });
  const main = task(42);
  const visible = task(43, { assignees: [{ user: person, agent: null, agentAssigner: null }, { user: person, agent, agentAssigner: null }] });
  const empty = task(44, { section: 'Todo', assignees: [] });
  const hidden = task(45, { accessible: false });
  const deleted = task(46, { status: 'Deleted' });
  const relations = [visible, hidden, deleted].map((targetTask) => ({
    sourceTaskId: 42, targetTaskId: targetTask.id, sourceTask: main, targetTask,
    relationType: 'RELATED',
  }));
  relations.push({ sourceTaskId: empty.id, targetTaskId: 42, sourceTask: empty, targetTask: main, relationType: 'BLOCKS' });
  const activities = Array.from({ length: 7 }, (_, i) => ({
    id: String(i), type: 'THOUGHT', text: `Working ${i}`,
    createdAt: new Date(1000 * (7 - i)), run: { agent: i === 0 ? hiddenAgent : agent },
  }));
  const queries = [];
  const commentLimits = [];
  const prisma = {
    task: { findFirst: async () => ({ id: 42, pullRequests: [] }) },
    comment: { count: async () => 0, findMany: async (query) => {
      if (query.select.id) commentLimits.push(query.take);
      return [];
    } },
    taskRelations: { findMany: async (query) => {
      assert.deepEqual(query.where.OR[0].targetTask, access);
      assert.deepEqual(query.where.OR[1].sourceTask, access);
      return relations.filter((relation) => {
        const related = relation.sourceTaskId === 42 ? relation.targetTask : relation.sourceTask;
        return related.accessible && related.status !== 'Deleted';
      });
    } },
    agentRunActivity: { findMany: async (query) => {
      queries.push(query);
      assert.deepEqual(query.where.run.task, access);
      assert.deepEqual(query.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
      return query.where.run.taskId === 43 ? activities.slice(0, query.take) : [];
    } },
  };
  const mappedTask = { id: 42, title: 'Main', description: '', section: 'Todo', labels: [], assignees: [], sub_tasks: [] };
  const stubs = {
    ai: { tool: (definition) => definition },
    '@/lib/prisma': { default: prisma },
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: (handler) => (request) => handler(request),
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId, teamScope }),
    },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: (userId, agentId, teamScope) => ({ viewer: userId, agentId, teamScope }) },
    '@/lib/mcp/tasks/resolveTask': { findTaskByIdentifier: async () => ({ id: 42, projectId: 15 }) },
    '@/lib/mcp/tasks/mappers': {
      taskMcpGetInclude: () => ({}), mapTaskToMcpGetResponse: () => mappedTask,
    },
    '@/lib/mcp/tasks/extractPrLinks': { extractPrLinks: () => [] },
    '@/lib/pullRequests/githubPullRequests': { derivePullRequestDisplayState: () => '', parseGithubPullRequestUrl: () => null },
    '@/lib/pullRequests/taskPullRequests': { refreshTaskPullRequests: async () => [] },
    '@/lib/ai/tools/execution': { withToolErrors: (fn) => fn },
    '@/lib/ai/tools/helpers': { mapTaskToMcpGetResponse: () => mappedTask, stripInlineDataUris: (text) => text, sanitizeForJson: (value) => value },
  };
  const { mapTaskAssignees } = load('src/lib/mcp/tasks/mappers.ts', {
    '@/lib/prisma': { default: prisma },
    '@/lib/auth/agentScope': {},
    '@/lib/tasks/sameBoardRelations': {},
    '@/utils/controllers/projects/getAllIncludes': {},
    '@/lib/staleness': {},
    '@/lib/pullRequests/githubPullRequests': {},
  });
  stubs['@/lib/mcp/tasks/mappers'].mapTaskAssignees = mapTaskAssignees;
  return { stubs, queries, commentLimits };
}

for (const entry of ['route', 'tool']) {
  for (const summary of [false, true]) {
    test(`${entry} returns related context with summary=${summary}`, async () => {
      const { stubs, queries, commentLimits } = fixture(entry);
      let result;
      if (entry === 'route') {
        const { GET } = load('src/lib/mcp/operations/tasks/context/operation.ts', stubs);
        const response = await GET({ nextUrl: { searchParams: new URLSearchParams({ task_id: '42', project_id: '15', summary: String(summary) }) } });
        assert.equal(response.status, 200);
        result = response.body;
      } else {
        const { createTaskContextTool } = load('src/lib/ai/tools/taskContext.ts', stubs);
        result = await createTaskContextTool({ user: { id: 6 }, sendStatus() {} }).hypertask_task_context.execute({ task_id: 42, project_id: 15, summary });
      }
      assert.equal(result.success, true);
      assert.deepEqual(commentLimits, [summary ? 3 : 20]);
      assert.deepEqual(result.relatedTasks.map((task) => task.id), [43, 44]);
      const [related, empty] = result.relatedTasks;
      assert.equal(related.section, 'In Progress');
      assert.equal(related.assignees[0].displayName, 'Owner');
      assert.equal(related.assignees[1].type, 'agent');
      assert.equal(related.assignees[1].displayName, 'Runner');
      assert.equal(related.assignees[1].agentId, 'agent');
      assert.equal(related.direction, 'outgoing');
      assert.equal(empty.direction, 'incoming');
      assert.equal(empty.relationType, 'BLOCKS');
      assert.equal(related.agentActivities.length, 5);
      assert.equal(related.agentActivities[0].agentName, 'Private agent');
      assert.equal(related.agentActivities[1].agentName, 'Runner');
      assert.equal(related.agentActivities[1].text, 'Working 1');
      assert.equal(JSON.stringify(related).includes('Secret'), false);
      assert.deepEqual(empty.assignees, []);
      assert.deepEqual(empty.agentActivities, []);
      const { formatToolResponse } = load('src/lib/mcp-server/tool-response.ts');
      for (const format of ['concise', 'detailed']) {
        const formatted = JSON.parse(formatToolResponse(JSON.stringify(result), format, true, 20, 0, false));
        const [first, second] = formatted.data.relatedTasks;
        assert.equal(first.status ?? first.section, 'In Progress');
        assert.equal((first.assignee ?? first.assignees)[0].displayName, 'Owner');
        assert.equal((first.assignee ?? first.assignees)[1].agentId, 'agent');
        assert.equal(first.direction, 'outgoing');
        assert.equal(second.direction, 'incoming');
        assert.equal(second.relationType, 'BLOCKS');
        assert.deepEqual(first.agentActivities[0], related.agentActivities[0]);
        assert.deepEqual(second.agentActivities, []);
      }
      assert.deepEqual(queries.map((query) => query.where.run.taskId), [43, 44]);
      assert.ok(queries.every((query) => query.take === 5));
    });
  }
}
