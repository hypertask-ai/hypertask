const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const { assertAgentWriting } = load('src/lib/agents/writing.ts', {})

const longSentence = 'This sentence is far too long for a person to read in one go because it keeps going past the limit'

function refusal(text, previous = {}) {
  try {
    assertAgentWriting('agent-1', { text }, previous)
  } catch (error) {
    return error
  }
  throw new Error('the text was accepted')
}

test('a technical refusal names the offending phrase', () => {
  const error = refusal('Please put exit code here.')
  assert.equal(error.field, 'text')
  assert.match(error.message, /^text: Technical details belong in the agent log \("exit code"\)\./)
})

test('a robot status refusal names the offending label', () => {
  const error = refusal('Next: take the following ticket')
  assert.match(error.message, /Robot status belongs in the agent log \("Next:"\)\./)
})

test('a long sentence refusal names the sentence', () => {
  const error = refusal(longSentence)
  assert.match(error.message, /Keep each sentence within twelve words \("This sentence is far too long for a person to read in one go/)
})

test('a named sentence is clipped so the message stays readable', () => {
  const error = refusal(`${longSentence} and then it adds a great deal more text to make sure the quoted part is clipped by the excerpt helper`)
  const quoted = error.message.match(/\(([^()]*)\)/)
  assert.ok(quoted, 'the refusal must quote the offending text')
  assert.ok(quoted[1].length <= 80, `the quoted text must be clipped, got ${quoted[1].length} characters`)
  assert.match(quoted[1], /\.\.\."$/)
})

test('a nameable phrase still carries the plain-language advice', () => {
  const error = refusal('Please put exit code here.')
  assert.match(error.message, /Use short plain sentences for people; put technical details and status in the agent log\.$/)
})

test('short plain agent text is accepted', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent-1', { text: 'The board looks clean.' }))
})

test('an unchanged line is not checked again', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent-1', { text: longSentence }, { text: longSentence }))
})

test('a human write is never checked', () => {
  assert.doesNotThrow(() => assertAgentWriting(null, { text: longSentence }))
})
