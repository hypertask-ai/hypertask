// Assert-based demo because this repository has no Vitest setup.
// Run: npx tsx src/lib/mcp-server/validations/decision-request.validation.test.ts
import assert from 'node:assert/strict'
import { validateAndSanitizeDecisionRequestCrudInput } from './decision-request.validation'

function expectThrow(fn: () => void, messageIncludes: string) {
  assert.throws(fn, (err: any) => {
    assert.ok(String(err.message).includes(messageIncludes), `expected error containing "${messageIncludes}", got: ${err.message}`)
    return true
  })
}

function demo() {
  // create requires question + options, trims and dedupes
  const created = validateAndSanitizeDecisionRequestCrudInput({
    action: 'create',
    task_id: 1,
    question: '  Ship it?  ',
    options: [' Yes ', ' No '],
  })
  assert.equal(created.question, 'Ship it?')
  assert.deepEqual(created.options, ['Yes', 'No'])

  // create missing question fails
  expectThrow(
    () => validateAndSanitizeDecisionRequestCrudInput({ action: 'create', task_id: 1, options: ['Yes', 'No'] }),
    'question is required'
  )

  // create with duplicate options fails
  expectThrow(
    () =>
      validateAndSanitizeDecisionRequestCrudInput({
        action: 'create',
        task_id: 1,
        question: 'Q?',
        options: ['Yes', 'Yes'],
      }),
    'duplicates'
  )

  // create with < 2 options fails
  expectThrow(
    () =>
      validateAndSanitizeDecisionRequestCrudInput({
        action: 'create',
        task_id: 1,
        question: 'Q?',
        options: ['Only one'],
      }),
    'at least 2'
  )

  // create with two task identifiers fails
  expectThrow(
    () =>
      validateAndSanitizeDecisionRequestCrudInput({
        action: 'create',
        task_id: 1,
        ticket_number: 'HTPR-1',
        question: 'Q?',
        options: ['Yes', 'No'],
      }),
    'only one task identification method'
  )

  // answer requires decision_request_id + selected_option
  expectThrow(
    () => validateAndSanitizeDecisionRequestCrudInput({ action: 'answer' }),
    'decision_request_id is required'
  )
  expectThrow(
    () => validateAndSanitizeDecisionRequestCrudInput({ action: 'answer', decision_request_id: 5 }),
    'selected_option is required'
  )
  const answered = validateAndSanitizeDecisionRequestCrudInput({
    action: 'answer',
    decision_request_id: 5,
    selected_option: '  Yes  ',
    note: '  ship it  ',
  })
  assert.equal(answered.selected_option, 'Yes')
  assert.equal(answered.note, 'ship it')

  // get/cancel require decision_request_id
  expectThrow(() => validateAndSanitizeDecisionRequestCrudInput({ action: 'cancel' }), 'decision_request_id is required')
  const cancelled = validateAndSanitizeDecisionRequestCrudInput({ action: 'cancel', decision_request_id: 5 })
  assert.equal(cancelled.decision_request_id, 5)

  console.log('decision-request.validation.test.ts: all assertions passed')
}

demo()
