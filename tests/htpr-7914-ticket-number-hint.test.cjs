const test = require('node:test')
const assert = require('node:assert/strict')
const { z } = require('zod')
const { load } = require('./task-route-loader.cjs')

const stubs = {}
const tasks = load('src/lib/mcp-server/validations/task.validation.ts', stubs)
const { actionableToolError, executeToolResult } = load('src/lib/mcp-server/tool-response.ts', stubs)
const { selectMcpTools } = load('src/lib/mcp-server/consolidated-tools.ts', stubs)

function tool(hint) {
  return selectMcpTools([{
    name: 'hypertask_get_tasks',
    description: 'get',
    parameters: tasks.getGetTasksInputSchema(),
    execute: async (args) => JSON.stringify({ success: true, args }),
  }], true, {}, true, false, false, false, false, false, false, hint)[0]
}

async function refusal(hint, args) {
  const result = await executeToolResult(tool(hint), args, 'fixture')
  assert.equal(result.isError, true)
  return result.content[0].text
}

test('a numeric ticket_number gets the accepted-shape hint when the hint is on', async () => {
  const message = await refusal(true, { action: 'get', input: { ticket_number: 7914 } })
  assert.match(message, /^Change input\.ticket_number/)
  assert.match(message, /Pass input\.ticket_number as a string like "HTPR-7914"/)
  assert.match(message, /task_id/)
  assert.match(message, /unique_index together with project_id/)
})

test('flag off keeps the old invalid-input message', async () => {
  const message = await refusal(false, { action: 'get', input: { ticket_number: 7914 } })
  assert.equal(message, "Change input.ticket_number.0: Invalid input: expected string, received number. Pass a value matching this action's input schema.")
})

test('the hint covers source_ and target_ticket_number and leaves other fields alone', () => {
  const issue = (path) => new z.ZodError([{ code: 'invalid_type', expected: 'string', received: 'number', path, message: 'Invalid input' }])
  assert.match(actionableToolError(issue(['input', 'source_ticket_number']), { ticketNumberShape: true }), /source_ticket_number as a string like "HTPR-7914"/)
  assert.match(actionableToolError(issue(['input', 'target_ticket_number']), { ticketNumberShape: true }), /target_ticket_number as a string like "HTPR-7914"/)
  assert.match(actionableToolError(issue(['ticket_number', 0]), { ticketNumberShape: true }), /Pass ticket_number as a string like "HTPR-7914"/)
  assert.equal(actionableToolError(issue(['input', 'title']), { ticketNumberShape: true }), "Change input.title: Invalid input. Pass a value matching this action's input schema.")
})

test('the catalog carries the hint only when the flag is passed in', () => {
  assert.deepEqual(tool(true).errorHints, { ticketNumberShape: true })
  assert.equal(tool(false).errorHints, undefined)
})

test('a correctly shaped call is untouched by the flag', async () => {
  const result = await executeToolResult(tool(true), { action: 'get', input: { ticket_number: 'HTPR-7914' } }, 'fixture')
  assert.equal(result.isError, undefined)
  assert.match(result.content[0].text, /"success":true/)
})
