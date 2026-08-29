const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { NextRequest } = require('next/server')

// HTPR-5646: in-app feedback must land on the product board (15), section
// "Bugs", labeled user-feedback, priority Urgent - not the retired feedback
// board (2101), whose drain agent no longer exists.

const root = path.resolve(__dirname, '..')

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}

const calls = { sectionWhere: null, labelFindWhere: null, labelCreates: [], createTaskCoreArgs: null }

stubModule('src/lib/auth/getSessionUser.ts', {
  getSessionUser: async () => ({ userId: 6 }),
})

stubModule('src/lib/prisma.ts', {
  default: {
    user: {
      findUnique: async () => ({ id: 6, displayName: 'Valentin', email: 'v@example.test' }),
    },
    project: {
      findFirst: async (args) => {
        calls.sectionWhere = args.select.section.where
        return {
          uniqueIdentifier: 'HTPR',
          ownerId: 6,
          section: [{ id: 111, section_title: 'Bugs' }],
        }
      },
    },
    label: {
      findFirst: async (args) => {
        calls.labelFindWhere = args.where
        return { id: 'label-user-feedback' }
      },
      create: async (args) => {
        calls.labelCreates.push(args)
        return { id: 'label-created' }
      },
    },
    member: {
      findMany: async () => [],
    },
    notification: {
      create: async () => ({ id: 1 }),
    },
  },
})

stubModule('src/lib/realtime/server.ts', {
  broadcastInboxChange: async () => {},
})

stubModule('src/utils/controllers/assignees/assign.ts', {
  default: async () => ({ status: 200, json: { body: [] } }),
})

stubModule('src/utils/controllers/tasks/createTaskCore.ts', {
  createTaskCore: async (options) => {
    calls.createTaskCoreArgs = options
    return { task: { id: 999 }, description: {} }
  },
})

const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
  cache: false,
})
const { POST } = jiti(path.join(root, 'src/app/api/feedback/route.ts'))

function feedbackRequest(body) {
  return new NextRequest('https://example.test/api/feedback', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

test('feedback submission routes to board 15, section Bugs, labeled user-feedback, priority Urgent', async () => {
  const response = await POST(feedbackRequest({ text: 'Something is broken', kind: 'Bug' }))
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.success, true)

  assert.deepEqual(calls.sectionWhere, {
    deleted: false,
    visibility: true,
    section_title: 'Bugs',
  })
  assert.deepEqual(calls.labelFindWhere, { projectId: 15, value: 'user-feedback' })
  assert.equal(calls.labelCreates.length, 0)

  assert.ok(calls.createTaskCoreArgs)
  assert.equal(calls.createTaskCoreArgs.projectId, 15)
  assert.equal(calls.createTaskCoreArgs.sectionId, 111)
  assert.deepEqual(calls.createTaskCoreArgs.labelIds, ['label-user-feedback'])
  assert.equal(calls.createTaskCoreArgs.priorityIndex, 1)
})

test('feedback submission creates the user-feedback label when it does not exist yet', async () => {
  const prismaStub = require.cache[path.join(root, 'src/lib/prisma.ts')].exports.default
  const originalFindFirst = prismaStub.label.findFirst
  prismaStub.label.findFirst = async (args) => {
    calls.labelFindWhere = args.where
    return null
  }
  calls.labelCreates.length = 0

  try {
    const response = await POST(feedbackRequest({ text: 'Missing label case', kind: 'Idea' }))
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.success, true)
    assert.equal(calls.labelCreates.length, 1)
    assert.deepEqual(calls.labelCreates[0].data, { value: 'user-feedback', projectId: 15 })
    assert.deepEqual(calls.createTaskCoreArgs.labelIds, ['label-created'])
  } finally {
    prismaStub.label.findFirst = originalFindFirst
  }
})
