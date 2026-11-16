const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const { SectionService } = load('src/lib/mcp-server/lib/services/section.service.ts', {
  '@/lib/flags': { isFeatureEnabled: async () => true },
})

const sections = [
  { id: 1, section_title: 'Triage', projectId: 10450, visibility: true, deleted: false, ranking: 'A1', isDone: false, autoAssign: null, taskCount: 3 },
  { id: 2, section_title: 'In Progress', projectId: 10450, visibility: true, deleted: false, ranking: 'A2', isDone: false, autoAssign: null, taskCount: 1 },
]

function service() {
  const apiClient = {
    makeRequest: async (path) => {
      if (path.includes('/tasks?')) return { success: true, tasks: [], total: 0, limit: 50, offset: 0 }
      return { success: true, sections: sections.map((section) => ({ ...section })), projectId: 10450 }
    },
  }
  return new SectionService(apiClient)
}

const refusal = (error) => ({
  code: error.code,
  details: error.details,
})

test('a missing section is a named refusal, not a bare server error', async () => {
  const client = service()
  await assert.rejects(
    () => client.manageSection({ action: 'get', project_id: 10450, section_id: 999, include_tasks: false }, { roleEnabled: true, userId: 6 }),
    (error) => {
      assert.match(error.message, /Section 999 not found in project 10450/)
      assert.deepEqual(refusal(error), { code: -32602, details: { field: 'section_id', code: 'not_found' } })
      return true
    }
  )
})

test('a column with another role is a named refusal, not a bare server error', async () => {
  const client = service()
  await assert.rejects(
    () => client.manageSection({ action: 'get', project_id: 10450, section_id: 2, role: 'done', include_tasks: false }, { roleEnabled: true, userId: 6 }),
    (error) => {
      assert.match(error.message, /has role in-progress, not done/)
      assert.deepEqual(refusal(error), { code: -32602, details: { field: 'role', code: 'invalid_value' } })
      return true
    }
  )
})
