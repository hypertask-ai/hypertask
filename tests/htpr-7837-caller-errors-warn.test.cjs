const test = require('node:test')
const assert = require('node:assert/strict')
const { z } = require('zod')
const { load } = require('./task-route-loader.cjs')

const { logger, isCallerError } = load('src/lib/mcp-server/utils/logger.ts', {})

function capture(run) {
  const lines = []
  const originals = { error: console.error, warn: console.warn, info: console.info, debug: console.debug }
  for (const level of Object.keys(originals)) {
    console[level] = (line) => lines.push(JSON.parse(line))
  }
  try {
    run()
  } finally {
    Object.assign(console, originals)
  }
  return lines
}

test('a zod validation error is a caller error', () => {
  const error = new z.ZodError([{ code: 'custom', path: ['task_id'], message: 'Either task_id must be provided' }])
  assert.equal(isCallerError(error), true)
})

test('a zod validation error logs at warn, not error', () => {
  const error = new z.ZodError([{ code: 'custom', path: ['task_id'], message: 'Either task_id must be provided' }])
  const lines = capture(() => logger.failure('Failed to get tasks', error, { correlationId: 'test' }))
  assert.deepEqual(lines.map((line) => line.level), ['warn'])
  assert.equal(lines[0].message, 'Failed to get tasks')
})

test('an upstream server failure still logs at error', () => {
  const error = Object.assign(new Error('Upstream request failed: 500'), { httpStatus: 500 })
  const lines = capture(() => logger.failure('Failed to get tasks', error, { correlationId: 'test' }))
  assert.deepEqual(lines.map((line) => line.level), ['error'])
})

test('a plain failure without a caller signal still logs at error', () => {
  const lines = capture(() => logger.failure('Failed to get tasks', new Error('socket hang up'), { correlationId: 'test' }))
  assert.deepEqual(lines.map((line) => line.level), ['error'])
})
