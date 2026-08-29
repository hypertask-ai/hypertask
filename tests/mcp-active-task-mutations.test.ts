import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hasActiveTaskOnlyMutation,
  isActiveTaskMutationTarget,
} from '../src/lib/mcp/tasks/activeTaskMutation'

test('assignment and section moves accept only active tasks', () => {
  assert.equal(isActiveTaskMutationTarget('Normal'), true)
  assert.equal(isActiveTaskMutationTarget('Archive'), false)
  assert.equal(isActiveTaskMutationTarget('Deleted'), false)
})

test('section and assignee updates require an active task', () => {
  assert.equal(hasActiveTaskOnlyMutation({ sectionId: 12 }), true)
  assert.equal(hasActiveTaskOnlyMutation({ assignee: [6] }), true)
  assert.equal(hasActiveTaskOnlyMutation({ assignee: [] }), true)
  assert.equal(hasActiveTaskOnlyMutation({}), false)
})
