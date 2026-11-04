const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const { assertAgentWriting } = load('src/lib/agents/writing.ts', {})

const tally = (count) =>
  `<p>AI feedback tally: ai-fb-cd5497fcb6f7</p><p>Seen ${count} times</p>` +
  '<p>Last seen: 2026-11-04T01:30:19.626Z</p><p>Reporting display names: Valentin Yeo</p><p>Clients: </p>'

test('an agent can put back the feedback tally comment Hypertask wrote', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent-1', { text: tally(2) }))
})

test('a changed tally count is accepted too', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent-1', { text: tally(3) }, { text: tally(2) }))
})

test('an agent can add its own note under the tally line', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent-1', { text: `${tally(2)}<p>Restored the count I overwrote.</p>` }))
})

test('an agent can edit a feedback ticket description that carries the fingerprint line', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent-1', {
    description: '<p>Fingerprint: ai-fb-cd5497fcb6f7</p><p>An agent could not restore a tally comment.</p>',
  }))
})

test('a raw id outside the generated line is still refused', () => {
  assert.throws(
    () => assertAgentWriting('agent-1', { text: '<p>The tally line is cd5497fcb6f7 and it was refused.</p>' }),
    /Technical details belong in the agent log: a build or commit id/,
  )
})

test('a lookalike line with a wrong id shape is still refused', () => {
  assert.throws(
    () => assertAgentWriting('agent-1', { text: '<p>AI feedback tally: ai-fb-cd5497fcb6f7ff</p>' }),
    /Technical details belong in the agent log/,
  )
})
