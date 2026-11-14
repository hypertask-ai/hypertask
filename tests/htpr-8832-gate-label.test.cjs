const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const { assertAgentWriting } = load('src/lib/agents/writing.ts', {})

function refusal(text) {
  try {
    assertAgentWriting('agent-1', { text })
  } catch (error) {
    return error
  }
  throw new Error('the text was refused and should have been accepted')
}

test('a heading that only ends in gate is accepted', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent-1', { text: '<p>Observation gate: the page rendered for a person.</p>' }))
  assert.doesNotThrow(() => assertAgentWriting('agent-1', { text: '<p>Acceptance gate: both cases answered.</p>' }))
  assert.doesNotThrow(() => assertAgentWriting('agent-1', { text: '<p>Full-day observation gate: steady overnight.</p>' }))
})

test('a bare gate label opening a line is still refused', () => {
  assert.match(refusal('Gate: shipped and clean').message, /Robot status belongs in the agent log \("Gate:"\)\./)
  assert.match(refusal('<p>Gates: 3 of 5</p>').message, /Robot status belongs in the agent log \("Gates:"\)\./)
})

test('the other status labels are still refused', () => {
  for (const label of ['Next', 'Helpers', 'Outputs', 'Claimed', 'Released', 'Resume']) {
    assert.match(refusal(`${label}: anything here`).message, /Robot status belongs in the agent log/)
  }
})
