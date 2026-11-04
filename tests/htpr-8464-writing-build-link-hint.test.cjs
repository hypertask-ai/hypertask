const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const { assertAgentWriting } = load('src/lib/agents/writing.ts', {})

function refusal(text) {
  try {
    assertAgentWriting('agent-1', { description: text })
  } catch (error) {
    return error
  }
  throw new Error('the text was accepted')
}

test('a refused build id names the link escape and keeps the agent log path', () => {
  const error = refusal('<p>The build failed on the release commit 9e5741ca.</p>')
  assert.match(error.message, /Technical details belong in the agent log: a build or commit id \("9e5741ca"\)\./)
  assert.match(error.message, /link the build or commit/)
  assert.match(error.message, /agent log\.$/)
})

test('a description that links the failing build is accepted', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent-1', {
    description: '<p>Production stopped serving after the last release.</p><p>Build: <a href="https://vercel.com/hypertask/deploys/dpl_9e5741ca">the failing build</a>.</p>',
  }))
})

test('the raw id stays refused so people text stays plain', () => {
  const error = refusal('<p>The failing build is dpl_9e5741ca and it stopped serving.</p>')
  assert.equal(error.code, 'invalid_field')
  assert.match(error.message, /Technical details belong in the agent log/)
})

test('robot status and long sentences keep their own advice', () => {
  const status = (() => {
    try {
      assertAgentWriting('agent-1', { text: 'Next: wait for checks.' })
    } catch (error) {
      return error
    }
    throw new Error('the status line was accepted')
  })()
  assert.match(status.message, /Use short plain sentences for people; put technical details and status in the agent log\.$/)

  const long = refusal('<p>This deliberately long sentence contains far too many words for a brief update that people can scan easily.</p>')
  assert.match(long.message, /Use short plain sentences for people; put technical details and status in the agent log\.$/)
})
