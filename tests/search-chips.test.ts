import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeSearchValue, candidateQuery, chipQuery, splitSearchChips } from '../src/lib/search/chips'
import { parseSearchQuery } from '../src/lib/search/operators'
import { buildSearchUrl } from '../src/lib/searchArchive'

test('chips follow the server parser while unrecognised tokens stay editable', () => {
  const raw = 'anthropic from:"@Kamil Grzegorzewicz" -label:bug foo:bar in:#Product'
  const { chips, text } = splitSearchChips(raw)
  assert.deepEqual(chips.map(({ operator, value, negated }) => ({ operator, value, negated })), [
    { operator: 'from', value: '@Kamil Grzegorzewicz', negated: false },
    { operator: 'label', value: 'bug', negated: true },
    { operator: 'in', value: '#Product', negated: false },
  ])
  assert.equal(text, 'anthropic foo:bar')
  assert.deepEqual(parseSearchQuery(chipQuery(chips, text)).filters, parseSearchQuery(raw).filters)
  assert.equal(splitSearchChips('foo:bar').chips.length, 0)
  assert.equal(splitSearchChips('from: 6 login').chips[0].value, '6')
  assert.equal(splitSearchChips('label: "needs design" login').chips[0].value, 'needs design')
})

test('unfinished operator values stay in the editor until completed', () => {
  assert.deepEqual(splitSearchChips('login from:ka', true).chips, [])
  assert.equal(activeSearchValue('login from:ka')?.value, 'ka')
  assert.deepEqual(activeSearchValue('label:'), { operator: 'label', value: '', start: 0 })
  assert.deepEqual(activeSearchValue('@Kamil'), { operator: 'from', value: 'Kamil', start: 0 })
  assert.deepEqual(activeSearchValue('#Pro'), { operator: 'in', value: 'Pro', start: 0 })
  assert.equal(activeSearchValue('login '), null)
  assert.equal(candidateQuery('from', 'Kamil Grzegorzewicz'), 'from:"@Kamil Grzegorzewicz"')
  assert.equal(candidateQuery('in', 'Product Board'), 'in:"#Product Board"')
  assert.equal(splitSearchChips('from:"@Kamil Grzegorzewicz"').chips.length, 1)
  const names = { from: ['Kamil Grzegorzewicz'] }
  assert.equal(splitSearchChips('from:Kamil ', true, names).text, 'from:Kamil ')
  assert.equal(splitSearchChips('from:Kamil Grz', true, names).text, 'from:Kamil Grz')
  assert.equal(splitSearchChips('from:Kamil Grzegorzewicz', true, names).chips[0].value, 'Kamil Grzegorzewicz')
  assert.equal(splitSearchChips('from:Kamil Grzegorzewicz login', true, names).text, 'login')
  assert.equal(splitSearchChips('from:ka anthropic', true, { from: ['Ka', 'Kamil'] }).text, 'from:ka anthropic')
  assert.equal(splitSearchChips('from:Ka', true, { from: ['Ka', 'Kamil'] }).chips.length, 0)
  assert.equal(splitSearchChips('from:Kamil', true, names).chips.length, 0)
  assert.deepEqual(activeSearchValue('from:ka anthropic', { from: ['Ka', 'Kamil'] }),
    { operator: 'from', value: 'ka', start: 0, end: 7 })
  assert.equal(splitSearchChips('is:open', true).chips[0].value, 'open')
})

test('URL round trip preserves chips, free text, filters and board context', () => {
  const query = chipQuery(splitSearchChips('label:"needs design" in:"#Product Board" anthropic').chips, 'anthropic')
  const url = buildSearchUrl(query, 1, false, 7)
  const parsed = new URL(url, 'https://example.test')
  assert.equal(parsed.searchParams.get('fromProject'), '7')
  assert.equal(parsed.searchParams.get('index'), '1')
  assert.equal(chipQuery(splitSearchChips(parsed.searchParams.get('searchTerm')!).chips,
    splitSearchChips(parsed.searchParams.get('searchTerm')!).text), query)
  assert.equal(parseSearchQuery(parsed.searchParams.get('searchTerm')!).filters.in?.[0].value, '#Product Board')
})

test('removed chips are omitted from the next search query', () => {
  const { chips, text } = splitSearchChips('from:@Kamil label:bug login')
  assert.equal(chipQuery(chips.filter((_, index) => index !== 1), text), 'from:@Kamil login')
})
