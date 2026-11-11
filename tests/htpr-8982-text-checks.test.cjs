const assert = require('node:assert/strict')
const test = require('node:test')
const { performance } = require('node:perf_hooks')
const { spawnSync } = require('node:child_process')
const { load } = require('./task-route-loader.cjs')

const { assertAgentWriting, AgentWritingError } = load('src/lib/agents/writing.ts')
const { MAX_CHECK_TEXT_LENGTH, dropBlockquotes, stripTags } = load('src/lib/text/safeHtmlText.mjs')
const ticket = load('src/lib/tickets/plainLanguageTicket.mjs')
const question = `<p><strong>What this is:</strong> A choice about search.</p>
<ul><li>Search misses reminders.</li><li>People lose work.</li><li>The change restores search.</li></ul>
<p><strong>Question:</strong> Restore search?</p>
<p><strong>My recommendation:</strong> Yes.</p>
<p><strong>Why:</strong> People can find reminders.</p>
<p><strong>Yes:</strong> Search finds reminders.</p>
<p><strong>No:</strong> Search stays unchanged.</p>`
const normalTicket = ticket.renderPlainLanguageTicketDescription({
  whatWrongOrWanted: 'Search misses reminders.', whoItAffects: 'Everyone.',
  recommendedCourseAndWhy: 'Restore search.', whatValentinMustDecide: 'Nothing.', howToUndo: 'Revert the change.',
})
const checkWriting = (text, previous = {}) => assertAgentWriting('agent', { text }, previous, { houseRules: true })

if (process.env.HTPR_8982_PERF === '1') {
  for (const [name, unit] of [['tags', '<'], ['quotes', '<blockquote '], ['spaces', ' ']]) {
    const text = unit.repeat(Math.ceil(1_048_576 / unit.length)).slice(0, 1_048_576)
    const samples = []
    for (let run = 0; run < 5; run += 1) {
      const start = performance.now()
      assert.equal(ticket.hasPlainLanguageTicketBlock(text), false)
      assert.deepEqual(ticket.missingPlainLanguageTicketLabels(text), ticket.PLAIN_LANGUAGE_TICKET_LABELS)
      assert.throws(() => ticket.assertPlainLanguageTicketBlock(text), ticket.PlainLanguageTicketError)
      assert.throws(() => checkWriting(text), AgentWritingError)
      samples.push(performance.now() - start)
    }
    assert.ok(samples.every((ms) => ms < 100), `${name}: ${JSON.stringify(samples)}`)
    console.log(JSON.stringify({ name, bytes: text.length, samples, outcome: 'refused before parsing' }))
  }
} else {
  test('1 MB crafted text is refused within 100 ms in each of five runs', () => {
    const result = spawnSync(process.execPath, [__filename], {
      env: { ...process.env, HTPR_8982_PERF: '1' }, encoding: 'utf8', timeout: 15_000,
    })
    assert.equal(result.status, 0, result.stderr || String(result.error))
    assert.match(result.stdout, /refused before parsing/)
    console.log(result.stdout)
  })

  test('ticket checks still accept normal descriptions and reject misplaced blocks', () => {
    assert.equal(ticket.hasPlainLanguageTicketBlock(normalTicket), true)
    assert.deepEqual(ticket.missingPlainLanguageTicketLabels(normalTicket), [])
    assert.equal(ticket.assertPlainLanguageTicketBlock(normalTicket), undefined)
    assert.equal(ticket.hasPlainLanguageTicketBlock(`<p>Introduction.</p>${normalTicket}`), false)
    assert.equal(ticket.hasPlainLanguageTicketBlock(`<blockquote>${normalTicket}</blockquote>`), false)
  })

  test('text at the cap is checked, not truncated; over the cap is refused', () => {
    const atCap = normalTicket.padEnd(MAX_CHECK_TEXT_LENGTH, ' ')
    assert.equal(ticket.hasPlainLanguageTicketBlock(atCap), true)
    assert.equal(ticket.hasPlainLanguageTicketBlock(`${atCap}x`), false)
    assert.throws(() => ticket.assertPlainLanguageTicketBlock(`${atCap}x`), /100000 characters/)
    const prose = '<p>Search works.</p>'.padEnd(MAX_CHECK_TEXT_LENGTH, ' ')
    assert.equal(checkWriting(prose), undefined)
    assert.throws(() => checkWriting(`${prose}x`), /100000 characters/)
  })

  test('normal question passes even after unrelated ticket lists', () => {
    const earlier = '<h2>Problem</h2><ul><li>One.</li><li>Two.</li><li>Three.</li><li>Four.</li></ul>'
    assert.equal(checkWriting(question), undefined)
    assert.equal(checkWriting(earlier + question), undefined)
    assert.throws(() => checkWriting(question.replace('</ul>', '<li>Four.</li></ul>')), /three points/)
    assert.throws(() => checkWriting(question.replace('Restore search?', 'Restore search.')), /question mark/)
    assert.throws(() => checkWriting(question.replace('<p><strong>No:</strong> Search stays unchanged.</p>', '')), /No is missing/)
  })

  test('question inside a list keeps its own context point count', () => {
    assert.equal(checkWriting(question.replace('<p><strong>Question:', '<li><p><strong>Question:')), undefined)
  })

  test('oversized legacy text does not block a legitimate short edit', () => {
    assert.equal(checkWriting('<p>Search works.</p>', { text: '<'.repeat(1_048_576) }), undefined)
  })

  test('linear HTML scans preserve complete quotes, mixed case and malformed tails', () => {
    assert.equal(dropBlockquotes('Before<BLOCKQUOTE class="old">quoted</BLOCKQUOTE>After'), 'Before\nAfter')
    assert.equal(dropBlockquotes('Before<blockquote>unclosed'), 'Before<blockquote>unclosed')
    assert.equal(stripTags('Before<strong>bold</strong>After<unfinished'), 'Before bold After<unfinished')
    assert.equal(stripTags('a<>b'), 'a<>b')
    assert.equal(dropBlockquotes('<blockquoteExtra>kept</blockquote>'), '<blockquoteExtra>kept</blockquote>')
    const malformed = '<blockquote '.repeat(8_000)
    const start = performance.now()
    assert.equal(dropBlockquotes(malformed), malformed)
    assert.equal(stripTags('<'.repeat(96_000)), '<'.repeat(96_000))
    assert.equal(ticket.hasPlainLanguageTicketBlock(malformed), false)
    assert.ok(performance.now() - start < 100)
  })
}
