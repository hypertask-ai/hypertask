const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(path.join(root, 'tests/mcp-escalate.test.cjs'), {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
})
const { buildEscalationCommentHtml } = jiti(
  path.join(root, 'src/lib/mcp/tasks/escalationHtml.ts')
)

test('builds a flagged escalation comment with reason and attempts', () => {
  const html = buildEscalationCommentHtml({ reason: 'stuck on auth', attemptsSummary: 'tried A, B' })
  assert.ok(html.includes('Agent escalation'))
  assert.ok(html.includes('stuck on auth'))
  assert.ok(html.includes('Already tried'))
  assert.ok(html.includes('tried A, B'))
  // wrapped in block tags, not bare text
  assert.ok(html.startsWith('<p>'))
})

test('omits the attempts block when not provided', () => {
  const html = buildEscalationCommentHtml({ reason: 'no idea' })
  assert.ok(html.includes('no idea'))
  assert.ok(!html.includes('Already tried'))
})

test('escapes hostile reason/summary text (untrusted agent input)', () => {
  const html = buildEscalationCommentHtml({
    reason: '<script>alert(1)</script>',
    attemptsSummary: '"><img src=x onerror=bad()>',
  })
  // no live tags survive; hostile markup is neutralized to escaped text
  assert.ok(!html.includes('<script>'))
  assert.ok(!html.includes('<img'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('&lt;img'))
})
