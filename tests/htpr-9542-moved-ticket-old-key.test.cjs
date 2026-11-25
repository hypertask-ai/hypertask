const test = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest } = require('next/server')
const { load } = require('./task-route-loader.cjs')
const { fixture, matches } = require('./helpers/agent-board-scope.cjs')

const flag = 'htpr-9542-moved-ticket-old-key'
const moved = { id: 150, ticketNumber: 'FLEET-9' }
const oldKey = {
  id: 2,
  taskId: 150,
  projectId: 15,
  uniqueIndex: 1,
  ticketNumber: 'HTPR-15',
  createdAt: new Date('2026-11-02T00:00:00.000Z'),
}
const olderKey = {
  id: 1,
  taskId: 150,
  projectId: 20,
  uniqueIndex: 4,
  ticketNumber: 'INAI-4',
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
}

function harness({ enabled = true, flagError = false, aliasError = false, aliases = [oldKey, olderKey], occupants = [] } = {}) {
  const calls = []
  const db = {
    taskNumberAlias: {
      findMany: async (args) => {
        calls.push('alias')
        if (aliasError) throw new Error('alias down')
        return aliases.filter((row) => matches(row, args.where))
      },
    },
    task: {
      findMany: async (args) => {
        calls.push('task')
        return occupants.filter((row) => matches(row, args.where))
      },
    },
  }
  const mod = load('src/lib/mcp/tasks/previousTicketNumbers.ts', {
    '@/lib/prisma': { default: db },
    '@/lib/flags': {
      isFeatureEnabled: async (key) => {
        calls.push(['flag', key])
        if (flagError) throw new Error('flag down')
        return enabled && key === flag
      },
    },
  })
  return { ...mod, calls }
}

test('the moved-ticket flag defaults to Everyone', () => {
  const definition = load('src/lib/flags/definitions/htpr-9542-moved-ticket-old-key.ts')
  assert.equal(definition.HTPR_9542_MOVED_TICKET_OLD_KEY_FLAG, flag)
  assert.equal(definition.default.key, flag)
  assert.equal(definition.default.kind, 'bugfix')
  assert.equal(definition.default.defaultMode, 'EVERYONE')
  assert.equal(definition.default.releaseRisk.risk, 'small')
})

test('a moved ticket names old keys that still open it, newest first', async () => {
  const { previousTicketNumbersByTask } = harness()
  const names = await previousTicketNumbersByTask([moved])
  assert.deepEqual(names.get(150), ['HTPR-15', 'INAI-4'])
})

test('a reused old number is not named, and the current key is not repeated', async () => {
  const { previousTicketNumbersByTask } = harness({
    aliases: [
      oldKey,
      { ...olderKey, ticketNumber: 'FLEET-9' },
      { ...olderKey, id: 3, ticketNumber: '  ' },
    ],
    occupants: [{ id: 999, projectId: 15, uniqueIndex: 1, status: 'Normal' }],
  })
  const names = await previousTicketNumbersByTask([moved])
  assert.equal(names.get(150), undefined)
})

test('the same old key is named once', async () => {
  const { previousTicketNumbersByTask } = harness({
    aliases: [oldKey, { ...oldKey, id: 3, ticketNumber: 'htpr-15', createdAt: new Date('2026-10-01T00:00:00.000Z') }],
  })
  const names = await previousTicketNumbersByTask([moved])
  assert.deepEqual(names.get(150), ['HTPR-15'])
})

test('with the switch off the read does not look up old keys', async () => {
  const { nameMovedTicketKeys, calls } = harness({ enabled: false })
  const [task] = await nameMovedTicketKeys(6, [moved])
  assert.equal(task.previousTicketNumbers, undefined)
  assert.deepEqual(calls, [['flag', flag]])
})

test('an old-key lookup failure leaves the ticket without old keys', async () => {
  const { nameMovedTicketKeys, calls } = harness({ aliasError: true })
  const [task] = await nameMovedTicketKeys(6, [moved])
  assert.equal(task.previousTicketNumbers, undefined)
  assert.deepEqual(calls, [['flag', flag], 'alias'])
})

test('a flag read failure leaves the ticket without old keys', async () => {
  const { nameMovedTicketKeys, calls } = harness({ flagError: true })
  const [task] = await nameMovedTicketKeys(6, [moved])
  assert.equal(task.previousTicketNumbers, undefined)
  assert.deepEqual(calls, [['flag', flag]])
})

function request(url, body) {
  return new NextRequest(`http://localhost${url}`, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {})
}

test('move and get name the old key, and a ticket that never moved stays unchanged', async () => {
  const f = fixture()
  const task = f.tasks.find((row) => row.id === 150)
  task.projectId = 4060
  task.project = f.projects.find((project) => project.id === 4060)
  task.uniqueIndex = 9
  task.ticketNumber = 'FLEET-9'
  const aliases = [oldKey]
  f.prisma.taskNumberAlias.findMany = async (args = {}) => aliases.filter((row) => matches(row, args.where))
  const flags = (enabled) => ({
    ...f.mocks['@/lib/flags'],
    isFeatureEnabled: async (key) => enabled && key === flag,
  })
  const loadMove = (enabled) => f.load('src/lib/mcp/operations/tasks/move/operation.ts', {
    '@/lib/flags': flags(enabled),
    '@/lib/mcp/routeWrapper': {
      ...f.mocks['@/lib/mcp/routeWrapper'],
      withMcpRouteMutationLease: async (_db, _actor, run) => run(),
    },
    '@/utils/controllers/tasks/moveToDifferentBoard': {
      moveTaskToDifferentBoard: async () => ({ success: true, task }),
    },
    '@/utils/controllers/activities/createLabelActivity': {},
    '@/utils/controllers/urls/extractUrlsFromContent': {},
    '@/lib/agentWebhooks/outbox': {},
  }).POST
  const movedResponse = await loadMove(true)(request('/api/mcp/tasks/move', {
    task_id: 150,
    target_project_id: 4060,
    target_section_id: 4060,
  }))
  assert.equal(movedResponse.status, 200)
  const movedBody = await movedResponse.json()
  assert.equal(movedBody.task.ticketNumber, 'FLEET-9')
  assert.deepEqual(movedBody.task.previousTicketNumbers, ['HTPR-15'])

  const quiet = await loadMove(false)(request('/api/mcp/tasks/move', {
    task_id: 150,
    target_project_id: 4060,
    target_section_id: 4060,
  }))
  assert.equal(quiet.status, 200)
  assert.equal((await quiet.json()).task.previousTicketNumbers, undefined)

  const read = f.load('src/lib/mcp/operations/tasks/operation.ts', { '@/lib/flags': flags(true) }).GET
  const one = await (await read(request('/api/mcp/tasks?task_id=150'))).json()
  assert.deepEqual(one.tasks.find((row) => row.id === 150).previousTicketNumbers, ['HTPR-15'])
  const board = await (await read(request('/api/mcp/tasks?project_id=4060'))).json()
  assert.deepEqual(board.tasks.find((row) => row.id === 150).previousTicketNumbers, ['HTPR-15'])
  assert.equal(board.tasks.find((row) => row.id === 40600).previousTicketNumbers, undefined)
})
