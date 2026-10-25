const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const stubs = {
  '@/lib/flags': { isFeatureEnabled: async () => true, featureFlagCandidateUserIds: async () => null },
}
const fixable = load('src/lib/aiFeedback/callerFixable.ts', stubs)

test('a refusal that names a field or lists values is one the caller can fix', () => {
  assert.equal(fixable.callerCanFix({ code: 'unrecognized_keys', field: 'contnet' }), true)
  assert.equal(fixable.callerCanFix({ code: 'invalid_enum_value', field: 'relation_type', options: ['RelatedTo', 'BlockedBy', 'BlockedTo'] }), true)
  assert.equal(fixable.callerCanFix({ code: 'invalid_type', field: 'ticket_number' }), true)
})

test('a refusal that names nothing the caller can fix still files', () => {
  assert.equal(fixable.callerCanFix({ code: 'custom' }), false)
  assert.equal(fixable.callerCanFix({ code: 'custom', field: 'input' }), false)
  assert.equal(fixable.callerCanFix({}), false)
  assert.equal(fixable.callerCanFix({ code: 'tool-exception' }), false)
})

test('zod issues become a refusal with the offending field or the accepted values', () => {
  assert.deepEqual(
    fixable.refusalFromZodIssues([{ code: 'unrecognized_keys', keys: ['contnet'], path: [] }]),
    { code: 'unrecognized_keys', field: 'contnet' },
  )
  assert.deepEqual(
    fixable.refusalFromZodIssues([{ code: 'invalid_enum_value', path: ['input', 'relation_type'], options: ['RelatedTo', 'BlockedBy'] }]),
    { code: 'invalid_enum_value', field: 'input.relation_type', options: ['RelatedTo', 'BlockedBy'] },
  )
  assert.deepEqual(fixable.refusalFromZodIssues([]), {})
})

test('a fingerprint filed in the last day is quiet, an older one is not', () => {
  const now = new Date('2026-10-25T12:00:00Z')
  assert.equal(fixable.filedWithinLastDay('2026-10-25T11:00:00Z', now), true)
  assert.equal(fixable.filedWithinLastDay('2026-10-24T13:00:00Z', now), true)
  assert.equal(fixable.filedWithinLastDay('2026-10-24T11:00:00Z', now), false)
  assert.equal(fixable.filedWithinLastDay(null, now), false)
})
