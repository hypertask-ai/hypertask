const test = require('node:test')
const assert = require('node:assert/strict')
const { loadModule } = require('./helpers/loadModule.cjs')

const calls = []
let rows = []
const prisma = {
  agentRunActivity: {
    findMany: async (query) => {
      calls.push(query)
      return rows.slice(query.skip ?? 0, (query.skip ?? 0) + query.take)
    },
  },
}
const { loadTaskAgentLog } = loadModule('src/lib/agentRuns/taskAgentLog.ts', {
  '@/lib/prisma': { __esModule: true, default: prisma },
  '@/utils/controllers/projects/getAllIncludes': {
    projectContentAccessWhere: (userId, agentId, teamScope) => ({
      probe: 'project-access',
      userId,
      agentId,
      teamScope,
    }),
  },
})

const baseCall = {
  taskId: 42,
  userId: 6,
  callerAgentId: 'runner-agent',
  teamScope: null,
  limit: 20,
}

test('an agent reads back the note it wrote in the log', async () => {
  calls.length = 0
  rows = [
    {
      id: 'activity-1',
      runId: 'run-1',
      type: 'THOUGHT',
      text: 'Claimed. Session working it now.',
      createdAt: new Date('2026-11-03T10:33:42.163Z'),
      run: { agentId: 'agent-1', agent: { displayName: 'Runner 9' } },
    },
  ]

  assert.deepEqual(await loadTaskAgentLog(baseCall), [
    {
      id: 'activity-1',
      agentId: 'agent-1',
      agentName: 'Runner 9',
      runId: 'run-1',
      type: 'thought',
      text: 'Claimed. Session working it now.',
      createdAt: '2026-11-03T10:33:42.163Z',
    },
  ])
})

test('a team scoped agent token still only reads its own team projects', async () => {
  calls.length = 0
  rows = []
  const teamScope = { teamId: 'team-3', accessBinding: 'binding-1' }

  await loadTaskAgentLog({ ...baseCall, teamScope })

  assert.deepEqual(calls[0].where, {
    run: {
      taskId: 42,
      task: {
        project: {
          probe: 'project-access',
          userId: 6,
          agentId: 'runner-agent',
          teamScope,
        },
      },
    },
  })

  calls.length = 0
  await loadTaskAgentLog(baseCall)
  assert.deepEqual(calls[0].where, { run: { taskId: 42 } })
})

test('the activity read honors the agent filter, the offset and the cap', async () => {
  calls.length = 0
  rows = []

  await loadTaskAgentLog({
    ...baseCall,
    limit: 500,
    offset: 40,
    agentId: 'agent-9',
  })

  assert.equal(calls[0].where.run.agentId, 'agent-9')
  assert.equal(calls[0].take, 100)
  assert.equal(calls[0].skip, 40)
  assert.deepEqual(calls[0].orderBy, [{ createdAt: 'desc' }, { id: 'desc' }])
})
