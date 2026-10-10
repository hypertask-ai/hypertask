const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const load = () => import(pathToFileURL(path.join(__dirname, '../.github/scripts/layout-lock-approval.mjs')).href)
const URL_A = 'https://app.hypertask.ai/detail/project-15/7100'
const matrix = (pages, approvedIn) => JSON.stringify({ sourceCommit: 'x', pages, ...(approvedIn ? { approvedIn } : {}) })
const FILE = 'e2e/smoke/layout-lock-matrix.baseline.json'

test('unchanged files and metadata-only edits need no approval', async () => {
  const { checkApproval } = await load()
  const base = matrix({ board: { a: 1 } })
  const result = checkApproval([{ file: FILE, base, head: base.replace('"x"', '"y"') }], '')
  assert.deepEqual(result, { failures: [], approvals: [] })
})

test('a changed matrix page without approvedIn fails and names the page', async () => {
  const { checkApproval } = await load()
  const { failures } = checkApproval([{ file: FILE, base: matrix({ board: { a: 1 } }), head: matrix({ board: { a: 2 } }) }], '')
  assert.equal(failures.length, 1)
  assert.match(failures[0], /"board" changed without a valid approvedIn/)
})

test('approvedIn must be a full ticket URL and the PR body must repeat it', async () => {
  const { checkApproval } = await load()
  const files = (approvedIn) => [{ file: FILE, base: matrix({ board: { a: 1 } }), head: matrix({ board: { a: 2 } }, approvedIn) }]
  assert.match(checkApproval(files({ board: 'TICKET-1' }), '').failures[0], /valid approvedIn/)
  const missingLine = checkApproval(files({ board: URL_A }), 'Summary only')
  assert.deepEqual(missingLine.failures, [`The PR body must contain the line: Layout change approved: ${URL_A}`])
  const ok = checkApproval(files({ board: URL_A }), `Summary\n\nLayout change approved: ${URL_A}\n`)
  assert.deepEqual(ok, { failures: [], approvals: [URL_A] })
})

test('removed and added pages count as changes; removed flag ratchet entries do not', async () => {
  const { checkApproval } = await load()
  const removed = checkApproval([{ file: FILE, base: matrix({ board: { a: 1 }, inbox: { a: 1 } }), head: matrix({ board: { a: 1 } }) }], '')
  assert.match(removed.failures[0], /"inbox" was removed/)
  const added = checkApproval([{ file: FILE, base: matrix({}), head: matrix({ search: { a: 1 } }) }], '')
  assert.match(added.failures[0], /"search" changed/)
  const ratchet = 'e2e/smoke/layout-lock-matrix.flag-changes.json'
  const entry = { flag: 'htpr-1-x', page: 'board', anchors: ['a'] }
  assert.deepEqual(checkApproval([{ file: ratchet, base: JSON.stringify([entry]), head: '[]' }], '').failures, [])
  assert.match(checkApproval([{ file: ratchet, base: '[]', head: JSON.stringify([entry]) }], '').failures[0], /"htpr-1-x\/board" changed/)
  assert.deepEqual(checkApproval([{ file: ratchet, base: '[]', head: JSON.stringify([{ ...entry, approvedIn: URL_A }]) }], `Layout change approved: ${URL_A}`).failures, [])
})

test('the older baseline is guarded per screen and device', async () => {
  const { checkApproval } = await load()
  const file = 'e2e/smoke/layout-lock.baseline.json'
  const json = (x, approvedIn) => JSON.stringify({ viewports: { Desktop: { viewport: { width: 1440 }, screens: { ticket: { x } } } }, ...(approvedIn ? { approvedIn } : {}) })
  assert.match(checkApproval([{ file, base: json(1), head: json(2) }], '').failures[0], /"ticket\/Desktop" changed/)
  assert.deepEqual(checkApproval([{ file, base: json(1), head: json(2, { 'ticket/Desktop': URL_A }) }], `Layout change approved: ${URL_A}`).failures, [])
})
