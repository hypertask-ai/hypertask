import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { parseTaskStatusParam } from '../src/lib/mcp/listQuery'

const ALL = ['Normal', 'Archive', 'Deleted'] as const
const SEARCHABLE = ['Normal', 'Archive'] as const

test('status=open and other CLI words map to the stored status', () => {
  assert.equal(parseTaskStatusParam('open', ALL), 'Normal')
  assert.equal(parseTaskStatusParam('archived', ALL), 'Archive')
  assert.equal(parseTaskStatusParam('Deleted', ALL), 'Deleted')
})

test('still allowed: no status or an empty status lists open tasks', () => {
  assert.equal(parseTaskStatusParam(null, SEARCHABLE), 'Normal')
  assert.equal(parseTaskStatusParam('', SEARCHABLE), 'Normal')
  assert.equal(parseTaskStatusParam('Normal', ALL), 'Normal')
})

test('now refused: unknown words and statuses the route does not allow', () => {
  assert.equal(parseTaskStatusParam('closed', ALL), null)
  assert.equal(parseTaskStatusParam('deleted', SEARCHABLE), null)
})

test('task list and search read status through parseTaskStatusParam', () => {
  for (const file of [
    'src/lib/mcp/operations/tasks/operation.ts',
    'src/lib/mcp/operations/tasks/search/operation.ts',
  ]) {
    const source = readFileSync(join(process.cwd(), file), 'utf8')
    assert.doesNotMatch(
      source,
      /searchParams\.get\('status'\)\s+as\s/,
      `${file} passes the raw status param to prisma; status=open crashed task.count (HTPR-7331)`,
    )
    assert.match(source, /parseTaskStatusParam\(searchParams\.get\('status'\)/)
  }
})
