const test = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./helpers/comment-routing.cjs')

const note = '<p>Progress &amp; next step</p>'

test('an agent outside the board is told why its note was not saved, not given a server error', async () => {
  const h = setup({ noRun: true, notMember: true })
  const response = await h.post({ text: note })
  assert.equal(response.status, 403)
  assert.equal(response.body.code, 'forbidden')
  assert.match(response.body.error, /not a member of this board/)
  assert.match(response.body.error, /hypertask_request_board_access/)
  assert.equal(h.calls.comments.length, 0)
})

test('a board member whose log cannot open keeps the retry answer', async () => {
  const h = setup({ noRun: true })
  const response = await h.post({ text: note })
  assert.equal(response.status, 503)
  assert.match(response.body.error, /Retry later/)
  assert.equal(h.calls.comments.length, 0)
})

test('a board member keeps the hidden agent log post', async () => {
  const h = setup()
  const response = await h.post({ text: note })
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'log')
  assert.equal(h.calls.comments.length, 0)
})

test('without kind, agent progress stays in the log instead of asking for kind', async () => {
  const h = setup()
  const response = await h.post({ text: note })
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'log')
  assert.equal(h.calls.comments.length, 0)
})

test('a people comment with kind still reaches the ticket thread', async () => {
  const h = setup({ notMember: true })
  const response = await h.post({ text: note, kind: 'qa' })
  assert.equal(response.status, 201)
  assert.equal(h.calls.comments.length, 1)
})

test('neither refusal answers 5xx on the paths the caller can fix', async () => {
  for (const options of [{ noRun: true, notMember: true }, {}]) {
    const h = setup(options)
    const response = await h.post({ text: note })
    assert.ok(response.status < 500, `answered ${response.status}`)
  }
})
