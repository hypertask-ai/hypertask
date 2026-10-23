const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { createJiti } = require('jiti')

test('HTPR-7618 registers a reversible Everyone bugfix', () => {
  const definition = createJiti(__filename, { interopDefault: true })(path.join(__dirname, '../src/lib/flags/definitions/htpr-7618-search-rows-fit-pane.ts'))
  assert.equal(definition.key, 'htpr-7618-search-rows-fit-pane')
  assert.equal(definition.kind, 'bugfix')
  assert.equal(definition.defaultMode, 'EVERYONE')
  assert.equal(definition.releaseRisk.risk, 'small')
  assert.ok(definition.releaseRisk.reason.trim().length > 0)
})
