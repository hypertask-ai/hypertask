import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSearchQuery, SEARCH_OPERATORS } from '../src/lib/search/operators'

test('each search operator consumes a value without lowercasing free text', () => {
  for (const operator of SEARCH_OPERATORS) {
    const parsed = parseSearchQuery(`MixedCase ${operator}:Value`)
    assert.equal(parsed.text, 'MixedCase')
    assert.deepEqual(parsed.filters[operator], [{ value: 'Value', negated: false }])
  }
})

test('unquoted values consume one token, or the longest accessible name', () => {
  assert.deepEqual(parseSearchQuery('label:bug login'), {
    text: 'login', filters: { label: [{ value: 'bug', negated: false }] },
  })
  assert.deepEqual(parseSearchQuery('label:"needs design" from:@Kamil Grzegorzewicz login', {
    from: ['Kamil', 'Kamil Grzegorzewicz'],
  }), {
    text: 'login', filters: {
      label: [{ value: 'needs design', negated: false }],
      from: [{ value: '@Kamil Grzegorzewicz', negated: false }],
    },
  })
  assert.deepEqual(parseSearchQuery('in:Product Planning login', {
    in: ['Product', 'Product Planning'],
  }), { text: 'login', filters: { in: [{ value: 'Product Planning', negated: false }] } })
  assert.deepEqual(parseSearchQuery('label:needs design', { label: ['needs design'] }), {
    text: '', filters: { label: [{ value: 'needs design', negated: false }] },
  })
  assert.equal(parseSearchQuery('label:"needs design" Fix This').text, 'Fix This')
})

test('repeated operators group values and negations', () => {
  const result = parseSearchQuery('Fix from:6 from:7 -label:stale is:open is:done')
  assert.equal(result.text, 'Fix')
  assert.deepEqual(result.filters.from, [
    { value: '6', negated: false }, { value: '7', negated: false },
  ])
  assert.deepEqual(result.filters.label, [{ value: 'stale', negated: true }])
  assert.deepEqual(result.filters.is, [
    { value: 'open', negated: false }, { value: 'done', negated: false },
  ])
})

test('unknown operators remain plain text and empty text stays empty', () => {
  assert.deepEqual(parseSearchQuery('foo:bar label:bug'), {
    text: 'foo:bar', filters: { label: [{ value: 'bug', negated: false }] },
  })
  assert.equal(parseSearchQuery('label:bug is:open').text, '')
  assert.deepEqual(parseSearchQuery('foo:bar'), { text: 'foo:bar', filters: {} })
})
