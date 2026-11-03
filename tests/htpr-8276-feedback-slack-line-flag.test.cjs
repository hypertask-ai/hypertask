const test = require('node:test')
const assert = require('node:assert/strict')
const { loadModule } = require('./helpers/loadModule.cjs')

test('the feedback Slack line flag ships to Everyone with small risk', () => {
  const definition = loadModule('src/lib/flags/definitions/htpr-8276-feedback-slack-line.ts').default
  assert.equal(definition.key, 'htpr-8276-feedback-slack-line')
  assert.equal(definition.kind, 'improvement')
  assert.equal(definition.defaultMode, 'EVERYONE')
  assert.equal(definition.shippedOn, '2026-11-03')
  assert.equal(definition.releaseRisk.risk, 'small')
  assert.equal(definition.releaseRisk.highRisk, undefined)
  assert.match(definition.description, /Slack/)
})
