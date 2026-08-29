// IUrl is the transport shape the editor posts. It carries fields the Url model
// does not have, because the attachment row consumes them. Spreading it into a
// Prisma write throws "Unknown argument" and silently breaks attachment sync on
// comment edits, so every URL write must go through the allowlist.
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
  cache: false,
})
const { urlRowData } = jiti(path.join(root, 'src/lib/attachments/urlRowData.ts'))

// Every column on the Prisma Url model, id aside.
const URL_COLUMNS = ['urlString', 'title', 'commentId', 'TaskId', 'Attachment']

const transportPayload = {
  urlString: 'https://storage.example.test/object',
  title: 'EU_AI_Act_Company_Overview.pdf',
  commentId: 77,
  TaskId: 42,
  Attachment: true,
  // None of these are Url columns.
  attachmentType: 'application/pdf',
  fileSize: 204800,
  projectId: 15,
  ticketNumber: 'HTPR-5530',
}

test('a URL write receives Url columns only', () => {
  assert.deepEqual(Object.keys(urlRowData(transportPayload)).sort(), [...URL_COLUMNS].sort())
})

test('the attachment-only fields never reach the URL write', () => {
  const written = urlRowData(transportPayload)
  for (const field of ['attachmentType', 'fileSize', 'projectId', 'ticketNumber']) {
    assert.equal(field in written, false, `${field} would fail the Prisma write`)
  }
})

test('the Url column values are carried through unchanged', () => {
  assert.deepEqual(urlRowData(transportPayload), {
    urlString: 'https://storage.example.test/object',
    title: 'EU_AI_Act_Company_Overview.pdf',
    commentId: 77,
    TaskId: 42,
    Attachment: true,
  })
})

test('overrides win so a new comment row is linked to the comment being saved', () => {
  const written = urlRowData(transportPayload, { commentId: 99, taskId: 1234 })

  assert.equal(written.commentId, 99)
  assert.equal(written.TaskId, 1234)
})

test('a null commentId override is honoured rather than falling back to the payload', () => {
  // Description URLs are stored with no comment. Treating null as "unset" would
  // reattach them to whatever comment the payload happened to carry.
  assert.equal(urlRowData(transportPayload, { commentId: null }).commentId, null)
})

test('a missing url string becomes empty rather than undefined', () => {
  assert.equal(urlRowData({ TaskId: 42 }).urlString, '')
})

test('an omitted Attachment stays undefined so an update never clears the flag', () => {
  // Prisma treats undefined as "leave this column alone". Coercing it to false
  // would un-mark an existing attachment row on every comment edit.
  assert.equal(urlRowData({ urlString: 'x', TaskId: 42 }).Attachment, undefined)
})

test('a supplied Attachment is normalised to a real boolean', () => {
  for (const [supplied, expected] of [[true, true], [false, false], [1, true], ['yes', true], [0, false], ['', false]]) {
    assert.equal(
      urlRowData({ urlString: 'x', TaskId: 42, Attachment: supplied }).Attachment,
      expected,
      `Attachment ${JSON.stringify(supplied)} must reach the column as ${expected}`
    )
  }
})

test('both URL write sites in the comment path go through the allowlist', () => {
  // A future edit that spreads the raw transport object again would reintroduce
  // the unknown-argument failure, and no unit test of this helper would notice.
  const source = require('node:fs').readFileSync(
    path.join(root, 'src/utils/controllers/urls/addIntoTask.ts'),
    'utf8'
  )
  assert.match(source, /data: urlRowData\(matchedUrlData\)/)
  assert.match(source, /urlRowData\(urlData, \{ commentId \}\)/)
  assert.doesNotMatch(source, /data: matchedUrlData\b/)
  assert.doesNotMatch(source, /\.\.\.urlData/)
})

test('the description URL writes go through the allowlist too', () => {
  // The description controller has its own create paths. Without this guard a
  // raw spread there would reintroduce the unknown-argument failure while every
  // test of addIntoTask.ts still passed.
  const source = require('node:fs').readFileSync(
    path.join(root, 'src/utils/controllers/urls/addIntoTaskDesc.ts'),
    'utf8'
  )
  assert.match(source, /data: urlsToAdd\.map\(urlData => urlRowData\(urlData, \{ taskId \}\)\)/)
  assert.doesNotMatch(source, /data: \{[^}]*\.\.\.urlData/s)
})
