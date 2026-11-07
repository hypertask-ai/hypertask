const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const { assertAgentWriting } = load('src/lib/agents/writing.ts', {})
const { FLAG_CHAT_RECORD, normalizeVisibleText } = load('src/lib/flags/approvalWords.ts', {})

const record = '<p>Valentin said in chat (2026-11-07): "just turn that feature off with multiple floating windows pls in the flags" Switch htpr-8334-multi-chat-windows to Off.</p>'

test('the comment rules accept the chat record the flag switch needs', () => {
  assert.ok(FLAG_CHAT_RECORD.test(normalizeVisibleText(record)), 'record is what the flag server reads')
  assert.doesNotThrow(() => assertAgentWriting('agent', { text: record }, {}, { houseRules: true }))
})

test('a code name outside a chat record is still refused', () => {
  assert.throws(() => assertAgentWriting('agent', { text: '<p>Remove feature flag htpr-7273-column-events now.</p>' }, {}, { houseRules: true }))
})

test('a quoted Valentin line that is not a switch record is still refused', () => {
  assert.throws(() => assertAgentWriting('agent', { text: '<p>Valentin said in chat (2026-11-07): "make the board faster"</p>' }, {}, { houseRules: true }))
})
