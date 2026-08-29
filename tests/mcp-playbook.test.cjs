const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(path.join(root, 'tests/mcp-playbook.test.cjs'), {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
})
const { parseBoardPlaybook } = jiti(
  path.join(root, 'src/lib/mcp/boards/playbook.ts')
)

test('accepts a well-formed playbook and trims/normalizes it', () => {
  const r = parseBoardPlaybook({
    definition_of_done: ['  tests pass  ', 'screenshot attached', ''],
    working_rules: '  branch off staging  ',
    notes: 'be terse',
    ignored_key: 'dropped',
  })
  assert.equal(r.ok, true)
  // empty checklist item filtered, others trimmed
  assert.deepEqual(r.value.definition_of_done, ['tests pass', 'screenshot attached'])
  assert.equal(r.value.working_rules, 'branch off staging')
  assert.equal(r.value.notes, 'be terse')
  // unknown keys are not persisted
  assert.equal('ignored_key' in r.value, false)
})

test('rejects the wrong shape', () => {
  assert.equal(parseBoardPlaybook(null).ok, false)
  assert.equal(parseBoardPlaybook('nope').ok, false)
  assert.equal(parseBoardPlaybook([]).ok, false)
  assert.equal(parseBoardPlaybook({ definition_of_done: 'not-an-array' }).ok, false)
  assert.equal(parseBoardPlaybook({ definition_of_done: [1, 2] }).ok, false)
  assert.equal(parseBoardPlaybook({ working_rules: 42 }).ok, false)
})

test('enforces size caps', () => {
  assert.equal(parseBoardPlaybook({ definition_of_done: Array(51).fill('x') }).ok, false)
  assert.equal(parseBoardPlaybook({ definition_of_done: ['x'.repeat(501)] }).ok, false)
  assert.equal(parseBoardPlaybook({ working_rules: 'x'.repeat(5001) }).ok, false)
})

test('an empty object is valid (clears the playbook)', () => {
  const r = parseBoardPlaybook({})
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, {})
})
