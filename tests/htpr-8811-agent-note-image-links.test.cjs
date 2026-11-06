const test = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./helpers/comment-routing.cjs')
const { load } = require('./task-route-loader.cjs')

const shot = 'https://example.com/proof.png'
const embedded = `<p>Evidence</p><img src="${shot}" alt="shot">`

test('agent note image links ship for everyone and can be switched off', () => {
  const definition = load('src/lib/flags/definitions/htpr-8811-agent-note-image-links.ts', {})
  assert.equal(definition.HTPR_8811_AGENT_NOTE_IMAGE_LINKS_FLAG, 'htpr-8811-agent-note-image-links')
  assert.equal(definition.default.key, 'htpr-8811-agent-note-image-links')
  assert.equal(definition.default.kind, 'bugfix')
  assert.equal(definition.default.defaultMode, 'EVERYONE')
  assert.equal(definition.default.shippedOn, '2026-11-06')
  assert.equal(definition.default.releaseRisk.risk, 'small')
  assert.match(definition.default.description, /image links/)
  assert.match(definition.default.releaseRisk.reason, /attachment flags/)
})

test('a plain agent note with an image link is stored, and the source stays in the log', async () => {
  const h = setup({ formattedText: embedded })
  const response = await h.post({ text: `Evidence\n\n![shot](${shot})` })
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'log')
  assert.equal(response.body.visibleToPeople, false)
  assert.equal(response.body.activity.text, `Evidence\nshot (${shot})`)
  assert.equal(h.calls.comments.length, 0)
  assert.equal(h.calls.activities.length, 1)
  assert.equal(h.calls.activities[0][2].text, `Evidence\nshot (${shot})`)
})

test('markdown image links with no attachment flags follow the same note path', async () => {
  const text = `See the shot\n\n![shot](${shot})`
  const h = setup({ realMarkdown: true, inlineImages: true })
  const preview = await h.post({ content_type: 'markdown', text, dry_run: true })
  assert.equal(preview.status, 200)
  assert.match(preview.body.would.text, /<img\b[^>]*src="https:\/\/example\.com\/proof\.png"/)
  assert.equal(preview.body.would.routedTo, 'log')
  const response = await h.post({ content_type: 'markdown', text })
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'log')
  assert.equal(response.body.visibleToPeople, false)
  assert.equal(response.body.activity.text, `See the shot\nshot (${shot})`)
  assert.equal(h.calls.comments.length, 0)
  const off = setup({ realMarkdown: true, inlineImages: true, imageNoteLinks: false })
  const rejected = await off.post({ content_type: 'markdown', text })
  assert.equal(rejected.status, 400)
  assert.equal(rejected.body.field, 'kind')
  assert.equal(rejected.body.error, 'Choose kind (question|qa|done) before attaching files to a people comment.')
  assert.equal(off.calls.comments.length + off.calls.activities.length, 0)
})

test('a bare image URL turned into an inline image is still an agent note', async () => {
  const h = setup({ inlineImages: true })
  const response = await h.post({ text: `<p>Compare ${shot}.</p>` })
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'log')
  assert.equal(response.body.visibleToPeople, false)
  assert.equal(response.body.activity.text, `Compare ${shot}.`)
  assert.equal(h.calls.comments.length, 0)
  assert.equal(h.calls.activities.length, 1)
})

test('switching the flag off rejects the same image link again', async () => {
  const h = setup({ imageNoteLinks: false, formattedText: embedded })
  const response = await h.post()
  assert.equal(response.status, 400)
  assert.equal(response.body.code, 'missing_field')
  assert.equal(response.body.field, 'kind')
  assert.equal(response.body.error, 'Choose kind (question|qa|done) before attaching files to a people comment.')
  assert.equal(h.calls.comments.length + h.calls.activities.length + h.calls.runs.length, 0)
})

for (const body of [
  { has_attachments: true },
  { images: [shot] },
  { attachments: [{ filename: 'shot.png', content_type: 'image/png', url: shot }] },
]) {
  test(`supplied attachment flags still require kind when the note also has an image link: ${JSON.stringify(body)}`, async () => {
    const h = setup({ formattedText: embedded })
    const response = await h.post(body)
    assert.equal(response.status, 400)
    assert.equal(response.body.field, 'kind')
    assert.equal(response.body.error, 'Choose kind (question|qa|done) before attaching files to a people comment.')
    assert.equal(h.calls.comments.length + h.calls.activities.length, 0)
    const posted = await h.post({ ...body, kind: 'qa', text: 'Proof attached.' })
    assert.equal(posted.status, 201)
    assert.equal(posted.body.routedTo, 'comments')
    assert.equal(posted.body.comment.kind, 'qa')
    assert.equal(h.calls.comments.length, 1)
    assert.equal(h.calls.activities.length, 0)
  })
}

test('a person comment with an image link stays on the thread', async () => {
  const h = setup({ human: true, formattedText: embedded })
  const response = await h.post()
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'comments')
  assert.equal(response.body.visibleToPeople, true)
  assert.equal(h.calls.comments.length, 1)
  assert.equal(h.calls.activities.length, 0)
})

test('an explicit people kind still publishes an image link on the thread', async () => {
  const h = setup({ formattedText: '<p>Look</p><img src="https://example.com/proof.png" alt="shot">' })
  const response = await h.post({ kind: 'qa', text: 'Look' })
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'comments')
  assert.equal(response.body.comment.kind, 'qa')
  assert.equal(h.calls.activities.length, 0)
})
