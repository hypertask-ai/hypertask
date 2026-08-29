// Assert-based regression test because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/lib/mcp/tasks/updateFields.test.ts
import assert from 'node:assert/strict'
import { hasSingleTaskUpdate } from '@/lib/mcp/tasks/updateFields'

assert.equal(hasSingleTaskUpdate({ description: '' }), true)
assert.equal(hasSingleTaskUpdate({ title: '' }), true)
assert.equal(hasSingleTaskUpdate({ parent_task_id: null }), true)
assert.equal(hasSingleTaskUpdate({}), false)

console.log('tasks/update field-presence regression test passed')
