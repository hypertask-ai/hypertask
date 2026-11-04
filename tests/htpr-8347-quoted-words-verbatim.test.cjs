const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const { assertAgentWriting, AgentWritingError } = load('src/lib/agents/writing.ts', {})

const hisWords = 'He said this runs long because it needs the whole story before anyone can decide what to do next.'
const ownLong = 'This sentence of our own runs far too long for a person to scan quickly and it needs cutting.'

test('a quoted block keeps his words verbatim', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent-1', {
    description: `<p><strong>Problem:</strong> Readers miss the ask.</p><blockquote><p>${hisWords}</p></blockquote><p>Fix: Ask once.</p>`,
  }))
})

test('a quoted block may hold a value from his own words', () => {
  assert.doesNotThrow(() => assertAgentWriting('agent-1', {
    text: '<blockquote><p>Look at src/lib/example.ts first.</p></blockquote>',
  }))
})

test('an own long sentence is still refused and named', () => {
  assert.throws(
    () => assertAgentWriting('agent-1', { description: `<p>${ownLong}</p>` }),
    (error) => error instanceof AgentWritingError
      && error.field === 'description'
      && /twelve words \("This sentence of our own/.test(error.message),
  )
})

test('text after a quote is still checked', () => {
  assert.throws(
    () => assertAgentWriting('agent-1', { description: `<blockquote><p>${hisWords}</p></blockquote><p>${ownLong}</p>` }),
    /twelve words/,
  )
})

test('a human write is never checked', () => {
  assert.doesNotThrow(() => assertAgentWriting(null, { description: `<p>${ownLong}</p>` }))
})
