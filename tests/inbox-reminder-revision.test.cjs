const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
  cache: false,
})
const { nextReminderRevision } = jiti(
  path.join(root, 'src/utils/controllers/reminders/revision.ts')
)

test('reminder revisions advance beyond the locked row when the clock collides', () => {
  const previous = new Date('2026-08-13T12:00:00.123Z')
  const revision = nextReminderRevision(
    [{ createdAt: previous, updatedAt: previous, remindAt: null }],
    () => previous.getTime()
  )

  assert.equal(revision.getTime(), previous.getTime() + 1)
})

test('reminder revisions use the current clock when it is already newer', () => {
  const revision = nextReminderRevision(
    [{ updatedAt: new Date(1_000), remindAt: new Date(2_000) }],
    () => 3_000
  )

  assert.equal(revision.getTime(), 3_000)
})
