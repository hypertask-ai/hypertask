const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const errors = load('src/lib/mcp-server/utils/errors.ts', {})
const fixable = load('src/lib/aiFeedback/callerFixable.ts', {})

const labelRefusal = {
  success: false,
  error: 'Not found',
  code: 'not_found',
  field: 'labels',
  message: 'Label(s) not found on board 15: Later. Available labels: Bug, Quick wins.',
  details: { field: 'labels', code: 'not_found' },
}

test('a 400 refusal keeps the field and the reason for the agent (HTPR-8267)', () => {
  const error = errors.mapHttpErrorToMcpError(400, labelRefusal.message, 'corr-1', labelRefusal)
  assert.deepEqual(error.details, { field: 'labels', code: 'not_found' })
  assert.equal(error.message, labelRefusal.message)
  assert.equal(error.data.correlationId, 'corr-1')
})

test('the JSON-RPC error carries those details to the caller (HTPR-8267)', () => {
  const error = errors.mapHttpErrorToMcpError(400, 'Validation error', 'corr-2', {
    success: false,
    error: 'Validation error',
    code: 'invalid_field',
    field: 'due_date',
    details: { field: 'due_date', code: 'invalid_date' },
  })
  assert.equal(error.code, -32602)
  assert.deepEqual(error.toJsonRpcError().data.details, { field: 'due_date', code: 'invalid_date' })
})

test('a 400 body that names no field adds no details', () => {
  for (const body of [undefined, null, 'text', { success: false, error: 'Invalid request' }, { field: '' }]) {
    assert.equal(errors.mapHttpErrorToMcpError(400, 'Invalid request', 'corr-3', body).details, undefined)
  }
})

test('an allowed-values refusal still offers the values', () => {
  const error = errors.mapHttpErrorToMcpError(400, 'Validation error', undefined, {
    success: false,
    error: 'Validation error',
    code: 'invalid_field',
    field: 'priority',
    allowed_values: [0, 1, 2],
  })
  assert.deepEqual(error.details, { code: 'invalid_field', field: 'priority', allowed_values: [0, 1, 2] })
})

test('a refusal naming a field the caller can change no longer files a ticket (HTPR-8267)', () => {
  for (const code of ['not_found', 'missing_field', 'invalid_date', 'invalid_range', 'invalid_element', 'max_length_exceeded', 'unsupported_value']) {
    assert.equal(fixable.callerCanFixRefusal({ code, field: 'labels' }, 400), true, code)
  }
})

test('a refusal naming nothing, or a server fault, still files (HTPR-8267)', () => {
  assert.equal(fixable.callerCanFixRefusal({ code: 'not_found' }, 400), false)
  assert.equal(fixable.callerCanFixRefusal({ code: 'tool-exception' }, 400), false)
  assert.equal(fixable.callerCanFixRefusal({ code: 'invalid_date', field: 'labels' }, 500), false)
})

const { actionableToolError } = load('src/lib/mcp-server/tool-response.ts', {})

test('a generic refusal now names the field the caller must change (HTPR-8267)', () => {
  const error = errors.mapHttpErrorToMcpError(400, 'Validation error', 'corr-4', {
    success: false,
    error: 'Validation error',
    code: 'invalid_field',
    field: 'due_date',
    details: { field: 'due_date', code: 'invalid_date' },
  })
  assert.equal(
    actionableToolError(error),
    'Change due_date: invalid date. Fix that field and retry the same call.',
  )
})

test('an allowed-values refusal lists the values (HTPR-8267)', () => {
  const error = errors.mapHttpErrorToMcpError(400, 'Validation error', undefined, {
    success: false,
    error: 'Validation error',
    code: 'invalid_field',
    field: 'priority',
    details: { field: 'priority', code: 'invalid_range' },
    allowed_values: [0, 1, 2],
  })
  assert.equal(
    actionableToolError(error),
    'Change priority: invalid range. Allowed values: 0, 1, 2. Fix that field and retry the same call.',
  )
})

test('a refusal that already explains itself keeps its own wording (HTPR-8267)', () => {
  const error = errors.mapHttpErrorToMcpError(400, 'due_date must be a valid ISO 8601 date or datetime (e.g. "2026-03-10").', undefined, {
    success: false,
    error: 'Validation error',
    code: 'invalid_field',
    field: 'due_date',
    details: { field: 'due_date', code: 'invalid_date' },
  })
  assert.equal(
    actionableToolError(error),
    'due_date must be a valid ISO 8601 date or datetime (e.g. "2026-03-10"). Check the action\'s required parameters and permissions before retrying.',
  )
})

test('a refusal with no field keeps the old wording (HTPR-8267)', () => {
  const error = errors.mapHttpErrorToMcpError(400, 'Validation error', undefined, { success: false, error: 'Validation error' })
  assert.equal(
    actionableToolError(error),
    'Validation error. Check the action\'s required parameters and permissions before retrying.',
  )
})
