const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const source = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/utils/controllers/description/common-description-create.ts',
  ),
  'utf8',
)

test('task description snapshots serialize version allocation per task', () => {
  assert.match(source, /pg_advisory_xact_lock/)
  assert.match(source, /assertAgentAssignmentChangeAllowed/)

  const fence = source.indexOf('assertAgentAssignmentChangeAllowed')
  const lock = source.indexOf('pg_advisory_xact_lock')
  const read = source.indexOf('tx.description.findUnique')
  const count = source.indexOf('tx.docVersion.count')
  const create = source.indexOf('tx.docVersion.create')

  assert.ok(fence >= 0 && fence < lock)
  assert.ok(lock < read)
  assert.ok(read < count && count < create)
})
