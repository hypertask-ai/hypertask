const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(path.join(root, 'tests/mcp-evidence.test.cjs'), {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
})
const { normalizeEvidenceType, parseEvidenceInput } = jiti(
  path.join(root, 'src/lib/mcp/tasks/evidence.ts')
)

test('normalizes evidence type from enum name or loose forms', () => {
  assert.equal(normalizeEvidenceType('TestRun'), 'TestRun')
  assert.equal(normalizeEvidenceType('test_run'), 'TestRun')
  assert.equal(normalizeEvidenceType('test run'), 'TestRun')
  assert.equal(normalizeEvidenceType('DEPLOY'), 'Deploy')
  assert.equal(normalizeEvidenceType(undefined), 'Other')
  assert.equal(normalizeEvidenceType(null), 'Other')
  assert.equal(normalizeEvidenceType('bogus'), null)
  assert.equal(normalizeEvidenceType(5), null)
})

test('accepts a valid evidence payload and trims', () => {
  const r = parseEvidenceInput({ type: 'deploy', url: '  https://app.hypertask.ai/x  ', summary: '  live  ' })
  assert.equal(r.ok, true)
  assert.equal(r.value.type, 'Deploy')
  assert.equal(r.value.url, 'https://app.hypertask.ai/x')
  assert.equal(r.value.summary, 'live')
})

test('requires at least one of title/url/summary', () => {
  const r = parseEvidenceInput({ type: 'TestRun' })
  assert.equal(r.ok, false)
  assert.equal(r.field, 'evidence')
})

test('rejects a non-http(s) or malformed url', () => {
  assert.equal(parseEvidenceInput({ type: 'Link', url: 'javascript:alert(1)' }).ok, false)
  assert.equal(parseEvidenceInput({ type: 'Link', url: 'not a url' }).ok, false)
  assert.equal(parseEvidenceInput({ type: 'Link', url: 'ftp://x/y' }).ok, false)
})

test('rejects an unknown type', () => {
  const r = parseEvidenceInput({ type: 'nope', summary: 'x' })
  assert.equal(r.ok, false)
  assert.equal(r.field, 'type')
})
