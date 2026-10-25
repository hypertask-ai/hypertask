const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const validations = load('src/lib/mcp-server/validations/project.validation.ts', {})
const { SectionService } = load('src/lib/mcp-server/lib/services/section.service.ts', {})

const sections = [
  { id: 1, section_title: 'Triage', projectId: 10450, visibility: true, deleted: false, ranking: 'A1', isDone: false, autoAssign: null, taskCount: 3 },
  { id: 2, section_title: 'In Progress', projectId: 10450, visibility: true, deleted: false, ranking: 'A2', isDone: false, autoAssign: null, taskCount: 1 },
  { id: 3, section_title: 'Done', projectId: 10450, visibility: true, deleted: false, ranking: 'A3', isDone: true, autoAssign: null, taskCount: 9 },
]

function service(extra = {}) {
  const calls = []
  const apiClient = {
    makeRequest: async (path, options) => {
      calls.push({ path, options })
      if (extra.respond) return extra.respond(path, options)
      if (path.includes('/tasks?')) return { success: true, tasks: [], total: 0, limit: 50, offset: 0 }
      return { success: true, sections: sections.map((section) => ({ ...section })), projectId: 10450 }
    },
  }
  return { client: new SectionService(apiClient), calls }
}

test('list accepts a semantic role and filters columns by it', async () => {
  const { client } = service()
  const result = await client.manageSection({ action: 'list', project_id: 10450, role: 'in-progress' }, { roleEnabled: true })
  assert.equal(result.sections.length, 1)
  assert.equal(result.sections[0].section_title, 'In Progress')
  assert.equal(result.sections[0].role, 'in-progress')
})

test('list without a role returns every column with its role, unchanged order', async () => {
  const { client } = service()
  const result = await client.manageSection({ action: 'list', project_id: 10450 }, { roleEnabled: true })
  assert.deepEqual(result.sections.map((section) => section.id), [1, 2, 3])
  assert.deepEqual(result.sections.map((section) => section.role), ['intake', 'in-progress', 'done'])
})

test('a done column reports done even when its title does not say so', async () => {
  const { client } = service({
    respond: async () => ({
      success: true,
      projectId: 10450,
      sections: [{ ...sections[0], id: 7, section_title: 'Shipped it', isDone: true }],
    }),
  })
  const result = await client.manageSection({ action: 'list', project_id: 10450, role: 'done' }, { roleEnabled: true })
  assert.deepEqual(result.sections.map((section) => section.id), [7])
})

test('get with a matching role returns the column and its role', async () => {
  const { client } = service()
  const result = await client.manageSection({ action: 'get', project_id: 10450, section_id: 2, role: 'in-progress', include_tasks: false }, { roleEnabled: true })
  assert.equal(result.section.id, 2)
  assert.equal(result.section.role, 'in-progress')
})

test('get with a different role fails with the reason', async () => {
  const { client } = service()
  await assert.rejects(
    () => client.manageSection({ action: 'get', project_id: 10450, section_id: 2, role: 'done', include_tasks: false }, { roleEnabled: true }),
    /has role in-progress, not done/
  )
})

test('an unknown role is refused by the schema', () => {
  const parsed = validations.SectionCrudInputSchema.safeParse({ action: 'list', project_id: 10450, role: 'shipping' })
  assert.equal(parsed.success, false)
  assert.ok(parsed.error.issues.some((issue) => issue.path.join('.') === 'role'))
})

test('writes refuse role and say why', () => {
  for (const input of [
    { action: 'create', project_id: 10450, title: 'Blocked', role: 'in-progress' },
    { action: 'update', project_id: 10450, section_id: 1, title: 'Renamed', role: 'done' },
    { action: 'delete', project_id: 10450, section_id: 1, role: 'done' },
  ]) {
    const parsed = validations.SectionCrudInputSchema.safeParse(input)
    assert.equal(parsed.success, false)
    assert.match(
      parsed.error.issues.find((issue) => issue.path.join('.') === 'role').message,
      /role follows the column title and cannot be set; use action list with role to find the (in-progress|done) column/
    )
  }
})

test('create and update responses carry the new column role', async () => {
  const { client } = service({
    respond: async (path, options) => ({
      success: true,
      section: { ...sections[0], id: 11, section_title: options.method === 'POST' ? 'Ready to start' : 'Review' },
    }),
  })
  const created = await client.manageSection({ action: 'create', project_id: 10450, title: 'Ready to start' }, { roleEnabled: true })
  assert.equal(created.section.role, 'ready')
  const updated = await client.manageSection({ action: 'update', project_id: 10450, section_id: 11, title: 'Review' }, { roleEnabled: true })
  assert.equal(updated.section.role, 'human-review')
})

test('with the flag off, role is ignored and the output matches today', async () => {
  const { client } = service()
  const listed = await client.manageSection({ action: 'list', project_id: 10450, role: 'in-progress' })
  assert.deepEqual(listed.sections.map((section) => section.id), [1, 2, 3])
  assert.equal(Object.hasOwn(listed.sections[0], 'role'), false)
  const got = await client.manageSection({ action: 'get', project_id: 10450, section_id: 2, role: 'done', include_tasks: false })
  assert.equal(got.section.id, 2)
  assert.equal(Object.hasOwn(got.section, 'role'), false)
})
