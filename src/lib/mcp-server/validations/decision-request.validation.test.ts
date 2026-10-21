import assert from 'node:assert/strict'
import { validateAndSanitizeDecisionRequestCrudInput } from './decision-request.validation'

function expectThrow(fn: () => void, messageIncludes: string) {
  assert.throws(fn, (err: any) => {
    assert.ok(String(err.message).includes(messageIncludes), `expected error containing "${messageIncludes}", got: ${err.message}`)
    return true
  })
}

function demo() {
  const created = validateAndSanitizeDecisionRequestCrudInput({
    action: 'create',
    task_id: 1,
    question: '  Ship it?  ',
    options: [' Yes ', ' No '],
  })
  assert.equal(created.question, 'Ship it?')
  assert.deepEqual(created.options, ['Yes', 'No'])

  expectThrow(
    () => validateAndSanitizeDecisionRequestCrudInput({ action: 'create', task_id: 1, options: ['Yes', 'No'] }),
    'question is required'
  )

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

  expectThrow(() => validateAndSanitizeDecisionRequestCrudInput({ action: 'cancel' }), 'decision_request_id is required')
  const cancelled = validateAndSanitizeDecisionRequestCrudInput({ action: 'cancel', decision_request_id: 5 })
  assert.equal(cancelled.decision_request_id, 5)

  console.log('decision-request.validation.test.ts: all assertions passed')
}

demo()
