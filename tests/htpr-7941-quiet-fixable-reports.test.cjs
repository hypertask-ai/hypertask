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

test('a value the caller wrote in the wrong format is one the caller can fix (HTPR-8202)', () => {
  assert.equal(fixable.callerCanFix({ code: 'invalid_format', field: 'input' }), true)
  assert.equal(fixable.callerCanFix({ code: 'invalid_format' }), false)
})

test('a refusal with a caller-fixable code is quiet only under 500 (HTPR-8202)', () => {
  assert.equal(fixable.callerCanFixRefusal({ code: 'invalid_format', field: 'input' }, 400), true)
  assert.equal(fixable.callerCanFixRefusal({ code: 'invalid_type', field: 'input' }, 400), true)
  assert.equal(fixable.callerCanFixRefusal({ code: 'invalid_format', field: 'input' }, 500), false)
  assert.equal(fixable.callerCanFixRefusal({ code: 'custom', field: 'input' }, 400), false)
  assert.equal(fixable.callerCanFixRefusal(undefined, 400), false)
})

test('a refusal that names nothing the caller can fix still files', () => {
  assert.equal(fixable.callerCanFix({ code: 'custom' }), false)
  assert.equal(fixable.callerCanFix({ code: 'custom', field: 'input' }), false)
  assert.equal(fixable.callerCanFix({}), false)
  assert.equal(fixable.callerCanFix({ code: 'tool-exception' }), false)
})

test('a fingerprint filed in the last day is quiet, an older one is not', () => {
  const now = new Date('2026-10-25T12:00:00Z')
  assert.equal(fixable.filedWithinLastDay('2026-10-25T11:00:00Z', now), true)
  assert.equal(fixable.filedWithinLastDay('2026-10-24T13:00:00Z', now), true)
  assert.equal(fixable.filedWithinLastDay('2026-10-24T11:00:00Z', now), false)
  assert.equal(fixable.filedWithinLastDay(null, now), false)
})

test('an old ticket edited today does not keep a fresh fingerprint quiet', () => {
  const now = new Date('2026-10-25T12:00:00Z')
  assert.equal(fixable.filedRecently({ createdAt: '2026-10-25T09:00:00Z' }, now), true)
  assert.equal(fixable.filedRecently({ createdAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-25T11:59:00Z' }, now), false)
  assert.equal(fixable.filedRecently(null, now), false)
})
