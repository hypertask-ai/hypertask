import assert from 'node:assert/strict'
import { searchTaskDescription } from '../src/lib/mcp/tasks/searchDescription.ts'

const full = '<h2>Done when</h2><p>full acceptance criteria stay in the JSON</p>'
const task = { description: '', description_: { content: full } }

assert.equal(searchTaskDescription(task, false), '')
assert.equal(searchTaskDescription(task, true), full)
assert.equal(searchTaskDescription({ description: 'legacy only' }, true), 'legacy only')
console.log('full description ok')
