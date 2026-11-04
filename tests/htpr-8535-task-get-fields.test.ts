import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { parseFields, projectRows } from '../src/lib/mcp/listQuery'

const detail = {
  id: 79394,
  ticketNumber: 'HTPR-8535',
  uniqueIndex: 8535,
  url: '/detail/project-15/8535',
  title: 'A single ticket read rejects the field list that the task list accepts',
  section: 'Improvements',
  boardTitle: 'Hypertask Product',
  description: 'long html',
  assignees: [{ displayName: 'Runner 5', agent: { displayName: 'Runner 5' } }],
  comments: Array.from({ length: 20 }, (_, index) => ({ text: `comment ${index}` })),
  skill_context: { summary: 'none' },
}

test('a single ticket read keeps only the asked fields', () => {
  const [projected] = projectRows([detail], parseFields('title,section'))
  assert.deepEqual(projected, { title: detail.title, section: detail.section })
})

test('asked fields travel down a nested path and an empty ask is no projection', () => {
  assert.deepEqual(projectRows([detail], ['assignees.0.displayName']), [{ 'assignees.0.displayName': 'Runner 5' }])
  assert.deepEqual(projectRows([detail], parseFields(null)), [detail])
  assert.deepEqual(projectRows([detail], parseFields('')), [detail])
})

test('the ticket read projects the detail map the same way the list projects its rows', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/mcp/operations/tasks/operation.ts'), 'utf8')
  assert.match(source, /parseFields\(searchParams\.getAll\('fields'\)\)/)
  assert.match(source, /projectRows\(\[task\], singleTaskFields\)\[0\]/)
  for (const call of ['projectSingleTask(await mapTask(tasks[0]))', '.map(projectSingleTask)']) {
    assert.ok(source.includes(call), `the ticket read must project through ${call}`)
  }
})
