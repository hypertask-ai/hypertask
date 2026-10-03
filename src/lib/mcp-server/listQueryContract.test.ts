// Run: npx tsx src/lib/mcp-server/listQueryContract.test.ts
import assert from 'node:assert/strict'
import { buildToolName } from './config/mcp-standards'
import {
  LIST_QUERY_DESCRIPTION_SUFFIX,
  withListQueryDescription,
} from './listQueryDescriptions'

function demo() {
  const listTasks = buildToolName('list_tasks')
  const enabledListTasks = 'Lists tasks. filter.has_pr=red matches a red PR badge.'
  assert.equal(withListQueryDescription(listTasks, enabledListTasks), enabledListTasks)

  const search = buildToolName('search_tasks')
  const searchOn = withListQueryDescription(search, 'Searches for tasks.')
  assert.equal(searchOn, `Searches for tasks.${LIST_QUERY_DESCRIPTION_SUFFIX}`)
  assert.ok(searchOn.includes('filter.has_pr=red'))

  for (const name of [
    buildToolName('list_projects'),
    buildToolName('list_labels'),
    buildToolName('section'),
    buildToolName('get_comments_for_task'),
    buildToolName('list_agents'),
  ]) {
    const enabled = withListQueryDescription(name, 'Base description.')
    assert.ok(enabled.includes('Shared list params'), name)
  }
}

demo()
console.log('listQueryContract tests passed')
