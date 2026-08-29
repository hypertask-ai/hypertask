// Editor uploads stored a hardcoded "1" instead of the real byte count, so every
// attachment added through the task description or a comment failed the download
// integrity check and no client could ever fetch the file. These tests encode why
// that sentinel must be treated as "never measured" and repaired on first download.
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
  cache: false,
})
const { createAttachmentDownloadHandler } = jiti(
  path.join(root, 'src/lib/mcp/attachments/downloadHandler.ts')
)
const { measuredSizeString } = jiti(
  path.join(root, 'src/lib/attachments/measuredSize.ts')
)

const bytes = Buffer.from('a real pdf that is definitely longer than one byte')

function request(query = 'task_id=42&attachment_id=19601') {
  return new NextRequest(`https://example.test/api/mcp/tasks/attachments?${query}`)
}

function handler({ storedSize, ...overrides } = {}) {
  const repaired = []
  const dependencies = {
    checkRateLimit: async () => null,
    validateAuth: async () => ({ user: { id: 6 }, agentId: null }),
    authorizeRead: async () => null,
    findTask: async (_context, taskId) => ({ id: taskId }),
    findAttachment: async () => ({
      fileName: 'EU_AI_Act_Company_Overview.pdf',
      fileType: 'application/pdf',
      fileSize: storedSize,
      fileSource: 'https://storage.example.test/private-object',
    }),
    fetchAttachment: async () => ({ buffer: bytes, contentType: 'application/pdf' }),
    normalizeMime: (value) => value || 'application/octet-stream',
    isStorageFetchError: () => false,
    recordMeasuredSize: async (attachmentId, size) => { repaired.push([attachmentId, size]) },
    ...overrides,
  }
  return { GET: createAttachmentDownloadHandler(dependencies), repaired }
}

test('serves an attachment whose stored size is the legacy unmeasured sentinel', async () => {
  const { GET } = handler({ storedSize: '1' })
  const response = await GET(request())

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-length'), String(bytes.length))
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
})

test('repairs the unmeasured size so later reads report the real byte count', async () => {
  const { GET, repaired } = handler({ storedSize: '1' })
  await GET(request())

  assert.deepEqual(repaired, [[19601, bytes.length]])
})

test('treats a missing stored size as unmeasured and repairs it too', async () => {
  const { GET, repaired } = handler({ storedSize: null })
  const response = await GET(request())

  assert.equal(response.status, 200)
  assert.deepEqual(repaired, [[19601, bytes.length]])
})

test('still rejects a genuinely measured size that does not match the bytes', async () => {
  const { GET, repaired } = handler({ storedSize: String(bytes.length + 5) })
  const response = await GET(request())

  assert.equal(response.status, 409)
  assert.deepEqual(repaired, [], 'a mismatched measured size must never be overwritten')
})

test('fails closed on a corrupt stored size instead of treating it as unmeasured', async () => {
  // A malformed size is not "never measured": trusting it would silently drop
  // the integrity guarantee for whatever wrote the bad value.
  // '01', ' 1 ' and '1e0' all read as 1 through Number(). Treating them as the
  // legacy sentinel would skip the length check forever, because the repair
  // path only ever rewrites the exact string '1'.
  for (const storedSize of [
    '-1',
    '1.5',
    'not-a-number',
    '9007199254740993',
    '01',
    ' 1 ',
    '1e0',
    '1.0',
  ]) {
    const { GET, repaired } = handler({ storedSize })
    const response = await GET(request())

    assert.equal(response.status, 409, `expected ${storedSize} to be rejected`)
    assert.deepEqual(repaired, [], 'a corrupt size must never be silently overwritten')
  }
})

test('a genuine one byte upload is served and rewritten with its true size', async () => {
  // Known ceiling of the sentinel: a real one byte file reads as unmeasured, so
  // it skips the length check and is simply rewritten with the same value.
  const oneByte = Buffer.from('x')
  const { GET, repaired } = handler({
    storedSize: '1',
    fetchAttachment: async () => ({ buffer: oneByte, contentType: 'application/pdf' }),
  })
  const response = await GET(request())

  assert.equal(response.status, 200)
  assert.deepEqual(repaired, [[19601, 1]])
})

test('does not record a size for a download that fails its content type check', async () => {
  // Writing a length back for bytes we then refuse would launder a bad object
  // into a row that looks verified.
  const { GET, repaired } = handler({
    storedSize: '1',
    fetchAttachment: async () => ({ buffer: bytes, contentType: 'text/html' }),
  })
  const response = await GET(request())

  assert.equal(response.status, 409)
  assert.deepEqual(repaired, [])
})

test('serves the file even when repairing the stored size fails', async () => {
  const { GET } = handler({
    storedSize: '1',
    recordMeasuredSize: async () => { throw new Error('database unavailable') },
  })
  const response = await GET(request())

  assert.equal(response.status, 200)
})

test('a measured size is stored verbatim so downloads can verify it', () => {
  assert.equal(measuredSizeString(0), '0')
  assert.equal(measuredSizeString(1), '1')
  assert.equal(measuredSizeString(2048576), '2048576')
  // A size read back out of the database arrives as a string and must survive.
  assert.equal(measuredSizeString('4096'), '4096')
})

test('an unusable client-supplied size is stored as unmeasured, never as a fake number', () => {
  // The original bug was a fake "1" written for every editor upload. Storing any
  // other bad value would reintroduce it, so these all become null.
  for (const value of [
    undefined, null, NaN, Infinity, -1, 1.5, '', 'abc', {},
    Number.MAX_SAFE_INTEGER + 1,
    '0x10', '1e3', ' 42 ', '-1', '4096.0',
  ]) {
    assert.equal(measuredSizeString(value), null, `expected ${String(value)} to be unmeasured`)
  }
})
