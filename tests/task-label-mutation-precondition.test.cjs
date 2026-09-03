const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(
  path.join(__dirname, '../src/lib/mcp/tasks/services.ts'),
  'utf8',
)

function loadMutateTaskLabels(existing, resolveLabelIds = async (_projectId, labels) => labels) {
  const start = source.indexOf('export async function mutateTaskLabels')
  const end = source.indexOf('export async function createTask', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)

  const javascript = ts.transpileModule(
    source.slice(start, end).replace('export async function', 'async function'),
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
  ).outputText

  const creates = []
  let taskLock = Promise.resolve()
  const prisma = {
    $transaction: async (callback) => {
      let releaseTaskLock
      const previousTaskLock = taskLock
      taskLock = new Promise((resolve) => {
        releaseTaskLock = resolve
      })
      const tx = {
        taskLabel: prisma.taskLabel,
        acquireTaskLock: () => previousTaskLock,
      }
      try {
        return await callback(tx)
      } finally {
        releaseTaskLock()
      }
    },
    taskLabel: {
      findMany: async () => existing.map((row) => ({ ...row })),
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }) => {
        const row = {
          id: `task-label-${data.labelId}`,
          ...data,
          label: { id: data.labelId, value: data.labelId },
        }
        existing.push(row)
        creates.push(row)
        return row
      },
    },
  }
  const assertTaskBelongsToProject = async (tx) => tx.acquireTaskLock()
  const createLabelActivity = async () => undefined
  const emitAgentLabelChangeWebhook = async () => []
  const publishAgentWebhookDeliveries = async () => undefined

  const mutateTaskLabels = new Function(
    'resolveLabelIds',
    'prisma',
    'assertTaskBelongsToProject',
    'createLabelActivity',
    'emitAgentLabelChangeWebhook',
    'publishAgentWebhookDeliveries',
    `${javascript}; return mutateTaskLabels;`,
  )(
    resolveLabelIds,
    prisma,
    assertTaskBelongsToProject,
    createLabelActivity,
    emitAgentLabelChangeWebhook,
    publishAgentWebhookDeliveries,
  )

  return { mutateTaskLabels, creates }
}

const actor = { id: 6, email: 'valentin@example.com' }

test('label mutation skips when an excluded label is present', async () => {
  const existing = [{ taskId: 42, labelId: 'Bug', label: { id: 'Bug', value: 'Bug' } }]
  const { mutateTaskLabels, creates } = loadMutateTaskLabels(existing)

  await mutateTaskLabels(
    42,
    15,
    { add: ['FEATURE'], skipIfPresent: ['Bug', 'FEATURE'] },
    actor,
  )

  assert.deepEqual(creates, [])
  assert.deepEqual(existing.map(({ labelId }) => labelId), ['Bug'])
})

test('task-row serialization allows only one competing kind', async () => {
  assert.match(source, /WHERE "id" = \$\{taskId\}[\s\S]*FOR UPDATE/)
  const existing = []
  const { mutateTaskLabels, creates } = loadMutateTaskLabels(existing)
  const kinds = ['Bug', 'FEATURE']

  await Promise.all([
    mutateTaskLabels(42, 15, { add: ['Bug'], skipIfPresent: kinds }, actor),
    mutateTaskLabels(42, 15, { add: ['FEATURE'], skipIfPresent: kinds }, actor),
  ])

  assert.equal(creates.length, 1)
  assert.equal(existing.length, 1)
})

test('unknown exclusion labels fail before mutation', async () => {
  const resolveLabelIds = async (_projectId, labels) => {
    if (labels.includes('missing')) throw new Error('Label(s) not found in project: missing')
    return labels
  }
  const { mutateTaskLabels, creates } = loadMutateTaskLabels([], resolveLabelIds)

  await assert.rejects(
    mutateTaskLabels(
      42,
      15,
      { add: ['Bug'], skipIfPresent: ['missing'] },
      actor,
    ),
    /not found/,
  )
  assert.deepEqual(creates, [])
})
