import assert from 'node:assert/strict'
import test from 'node:test'
import { attachmentDownloadHint, withAttachmentDownloadHints } from '../src/lib/mcp/tasks/attachmentDownloadHint'
import definition, { HTPR_8742_ATTACHMENT_DOWNLOAD_HINT_FLAG } from '../src/lib/flags/definitions/htpr-8742-attachment-download-hint'

test('attachment download hint names the authenticated request', () => {
  assert.equal(HTPR_8742_ATTACHMENT_DOWNLOAD_HINT_FLAG, 'htpr-8742-attachment-download-hint')
  assert.equal(definition.key, HTPR_8742_ATTACHMENT_DOWNLOAD_HINT_FLAG)
  assert.equal(definition.kind, 'bugfix')
  assert.equal(definition.defaultMode, 'EVERYONE')
  const hint = attachmentDownloadHint(88, 12)
  assert.equal(hint, 'GET /api/mcp/tasks/attachments?task_id=88&attachment_id=12 with the same bearer token. fileSource is not an agent download.')
})

test('download instructions appear only when the flag is on', () => {
  const task = {
    id: 88,
    attachments: [{ id: 12, fileName: 'shot.png', fileSource: 'https://files.example/shot.png' }],
  }
  const off = withAttachmentDownloadHints(task, false)
  assert.equal(off, task)
  assert.equal('download' in off.attachments[0], false)
  const on = withAttachmentDownloadHints(task, true)
  const shown = on.attachments[0] as { fileSource: string; download: string }
  assert.equal(shown.fileSource, task.attachments[0].fileSource)
  assert.equal(shown.download, attachmentDownloadHint(88, 12))
  const empty = { id: 88 }
  assert.equal(withAttachmentDownloadHints(empty, true), empty)
})
