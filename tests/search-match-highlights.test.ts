import assert from 'node:assert/strict'
import { test } from 'node:test'
import { highlightedSearchSnippet, highlightedTitle } from '../src/lib/search/autocomplete'

for (const text of ['Login title', 'A login description', 'A LOGIN comment']) {
  test(`safe literal highlighting: ${text}`, () => {
    assert.deepEqual(highlightedSearchSnippet(text, 'login from:6 label:Bug board:7').filter((part) => part.matched).map((part) => part.text.toLowerCase()), ['login'])
  })
}

test('snippet window finds late matches without changing or injecting user text', () => {
  const text = `${'prefix '.repeat(100)}<img onerror=bad()>login & [a+b] ${'suffix '.repeat(100)}`
  const parts = highlightedSearchSnippet(text, 'login [a+b]')
  assert.deepEqual(parts.filter((part) => part.matched).map((part) => part.text), ['login', '[a+b]'])
  assert.ok(parts.map((part) => part.text).join('').includes('<img onerror=bad()>'))
  assert.ok(parts[0].text.startsWith('...'))
  assert.ok(parts.at(-1)!.text.endsWith('...'))
  assert.ok(parts.map((part) => part.text).join('').length <= 226)
})

test('operator-only and unmatched snippets never invent highlights', () => {
  assert.ok(highlightedSearchSnippet('Valentin Bug board', 'from:Valentin label:Bug in:board').every((part) => !part.matched))
  assert.equal(highlightedSearchSnippet('', 'login').map((part) => part.text).join(''), '')
  assert.deepEqual(highlightedTitle('Literal .* text', '.*'), [{ text: 'Literal ', matched: false }, { text: '.*', matched: true }, { text: ' text', matched: false }])
})
