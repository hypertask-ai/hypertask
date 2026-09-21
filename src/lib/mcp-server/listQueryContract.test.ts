import { logger as htLogger } from "#logger";
// Run: npx tsx src/lib/mcp-server/listQueryContract.test.ts
import assert from 'node:assert/strict'
import { buildToolName } from './config/mcp-standards'
import {
  LIST_QUERY_DESCRIPTION_SUFFIX,
  LIST_TASKS_LEGACY_DESCRIPTION,
  withListQueryDescription,
} from './listQueryDescriptions'

function demo() {
  const listTasks = buildToolName('list_tasks')
  const enabledListTasks = 'Lists tasks. filter.has_pr=red matches a red PR badge.'
  assert.equal(withListQueryDescription(listTasks, enabledListTasks, false), LIST_TASKS_LEGACY_DESCRIPTION)
  assert.equal(withListQueryDescription(listTasks, enabledListTasks, true), enabledListTasks)

  const search = buildToolName('search_tasks')
  const searchOff = withListQueryDescription(search, 'Searches for tasks.', false)
  assert.equal(searchOff, 'Searches for tasks.')
  const searchOn = withListQueryDescription(search, 'Searches for tasks.', true)
  assert.equal(searchOn, `Searches for tasks.${LIST_QUERY_DESCRIPTION_SUFFIX}`)
  assert.ok(searchOn.includes('filter.has_pr=red'))

  for (const name of [
    buildToolName('list_projects'),
    buildToolName('list_labels'),
    buildToolName('section'),
    buildToolName('get_comments_for_task'),
    buildToolName('list_agents'),
  ]) {
    const enabled = withListQueryDescription(name, 'Base description.', true)
    assert.ok(enabled.includes('Shared list params'), name)
    assert.equal(withListQueryDescription(name, 'Base description.', false), 'Base description.')
  }
}

demo()
htLogger.info('listQueryContract tests passed')
