import assert from 'node:assert/strict'
import test from 'node:test'

import { UpdateTaskInputSchema } from '../src/lib/mcp-server/validations/task.validation'
import { normalizeTaskInput } from '../src/lib/mcp-server/utils/normalize-task-input'
import { isAcceptedRichTextInput } from '../src/utils/helperFunctions/markdownToHtml'

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

test('plain text is distinguishable from the previously accepted rich-text contract', () => {
  assert.equal(isAcceptedRichTextInput('Plain API description'), false)
  assert.equal(isAcceptedRichTextInput('<p>HTML description</p>', 'html'), true)
  assert.equal(isAcceptedRichTextInput('**Markdown description**'), true)
  assert.equal(isAcceptedRichTextInput('Plain markdown description', 'markdown'), true)
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
