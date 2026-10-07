import assert from 'node:assert/strict'
import test from 'node:test'

import { UpdateTaskInputSchema } from '../src/lib/mcp-server/validations/task.validation'
import { normalizeTaskInput } from '../src/lib/mcp-server/utils/normalize-task-input'
import { validateTaskUpdateFields } from '../src/lib/mcp/tasks/fields/validateFields'
import { NextResponse } from 'next/server'

test('update_task keeps descriptions that link to another Hypertask ticket', () => {
  const input = {
    ticket_number: 'LACK-23',
    content_type: 'html' as const,
    description:
      '<p>ref <a href="https://app.hypertask.ai/detail/project-339/1405">INNE-1405</a></p>',
  }

  const normalized = normalizeTaskInput(input)
  const result = UpdateTaskInputSchema.safeParse(normalized)

  assert.equal(result.success, true)
  assert.deepEqual(normalized, input)
})

test('task update accepts plain text and stores editor paragraphs without a flag', async () => {
  for (const dryRun of [false, true]) {
    const body = { description: 'Problem context\n\nAdd to cart is restricted.' }
    const result = await validateTaskUpdateFields(body, dryRun)

    assert.ok(!(result instanceof NextResponse))
    assert.equal(body.description, '<p>Problem context</p><p>Add to cart is restricted.</p>')
  }
})

test('task update still rejects empty descriptions without a flag', async () => {
  const result = await validateTaskUpdateFields({ description: '   ' }, false)

  assert.ok(result instanceof NextResponse)
  assert.equal(result.status, 400)
})

test('task reference normalization still accepts a Hypertask URL as ticket_number', () => {
  assert.deepEqual(
    normalizeTaskInput({
      ticket_number: 'https://app.hypertask.ai/detail/project-339/1405',
    }),
    {
      project_id: 339,
      unique_index: 1405,
    },
  )
})
