const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true })
const { operatorSuggestions, searchCompletion, localValueSuggestions, searchFilterType, searchFilterColour, SEARCH_FILTER_COLOURS, SEARCH_TIPS, highlightedTitle } = jiti(path.join(root, 'src/lib/search/autocomplete.ts'))
const { SEARCH_OPERATORS, LOGIC_OPERATORS, parseSearchQuery } = jiti(path.join(root, 'src/lib/search/operators.ts'))
const { splitSearchChips } = jiti(path.join(root, 'src/lib/search/chips.ts'))

test('operator prefixes match only the real parser operators, including aliases and exclusions', () => {
  for (const [prefix, expected] of Object.entries({ fr: ['from'], la: ['label'], is: ['is'], as: ['assignee'], in: ['in'], ha: ['has'], af: ['after'], be: ['before'], bo: ['board'], on: ['on'], a: ['assignee', 'after'] })) {
    assert.deepEqual(operatorSuggestions(prefix), expected)
    assert.deepEqual(operatorSuggestions(prefix.toUpperCase()), expected)
  }
  assert.deepEqual(operatorSuggestions('priority'), [])
  assert.deepEqual(operatorSuggestions(''), [])
  const completion = searchCompletion('login -fr')
  assert.equal(completion.kind, 'operator')
  assert.equal(completion.start, 6)
  assert.equal(completion.negated, true)
  for (const text of ['"fr', '"my fr', 'priority:', 'login ', 'is:op']) {
    assert.notEqual(searchCompletion(text)?.kind, 'operator', text)
  }
})

test('HTPR-6935 natural value completions include every parser operator and supported phrase in the replacement range', () => {
  for (const [phrase, operator] of [...SEARCH_OPERATORS.map((operator) => [operator, operator]), ['by', 'from'], ['created by', 'from'], ['assigned to', 'assignee'], ['commented by', 'commenter']]) {
    for (const leading of ['', 'bug ', 'bug -']) {
      const query = `${leading}${phrase} valentin`
      const completion = searchCompletion(query, {}, true)
      assert.ok(completion, query)
      assert.equal(completion.kind, 'value', query)
      assert.equal(completion.operator, operator, query)
      assert.equal(completion.value, 'valentin', query)
      assert.equal(completion.start, leading.trim() ? 4 : 0, query)
      assert.equal(completion.end, query.length, query)
      assert.equal(Boolean(completion.negated), leading.endsWith('-'), query)
    }
  }
  const completion = searchCompletion('bug ASSIGNED   TO valentin', {}, true)
  assert.equal(completion.operator, 'assignee')
  assert.equal(completion.start, 4)
  for (const query of ['bug valentin', 'platform valentin', 'unrecognised valentin', '"from valentin', '"commented by valentin', 'from valentin ']) {
    assert.equal(searchCompletion(query, {}, true), null, query)
  }
  assert.equal(searchCompletion('commented by valentin'), null)
  assert.equal(searchCompletion('commenter valentin'), null)
  assert.equal(searchCompletion('from:@valentin').start, 0)
})

test('all operators get either access-scoped entity lookups or valid local values', () => {
  const now = new Date('2026-10-01T23:45:00Z')
  for (const operator of SEARCH_OPERATORS) {
    assert.equal(searchCompletion(`${operator}:`, {}, true).kind, 'value')
    assert.equal(searchCompletion(`${operator}:`, {}, true).operator, operator)
    const suggestions = localValueSuggestions(operator, '', now)
    if (['from', 'commenter', 'assignee', 'in', 'board', 'label'].includes(operator)) {
      assert.equal(suggestions, null, 'entities use the existing authorized API')
    } else {
      assert.ok(suggestions.length)
      for (const { id } of suggestions) {
        assert.equal(parseSearchQuery(`${operator}:${id}`).filters[operator][0].value, id)
        if (operator !== 'is' && operator !== 'has') assert.match(id, /^\d{4}-\d{2}-\d{2}$/)
      }
    }
  }
  assert.deepEqual(localValueSuggestions('is', '').map((row) => row.id), ['open', 'done', 'archived'])
  assert.deepEqual(localValueSuggestions('has', '').map((row) => row.id), ['attachment', 'comment', 'due', 'due-date'])
  assert.deepEqual(localValueSuggestions('is', 'd').map((row) => row.id), ['done'])
  assert.deepEqual(localValueSuggestions('has', 'd').map((row) => row.id), ['due', 'due-date'])
  assert.deepEqual(localValueSuggestions('is', 'closed'), [])
})

test('dates use UTC calendar boundaries and reject malformed or nonexistent dates', () => {
  const now = new Date('2026-10-01T23:59:00Z')
  for (const operator of ['after', 'before', 'on']) {
    assert.deepEqual(localValueSuggestions(operator, '', now).map((row) => row.id), ['2026-10-01', '2026-09-30', '2026-09-24', '2026-09-28'])
    assert.equal(localValueSuggestions(operator, 'yest', now)[0].id, '2026-09-30')
    assert.deepEqual(localValueSuggestions(operator, '2024-02-29', now), [{ id: '2024-02-29', name: '2024-02-29' }])
    assert.deepEqual(localValueSuggestions(operator, 'updated:2024-02-29', now), [{ id: 'updated:2024-02-29', name: 'updated:2024-02-29' }])
    assert.deepEqual(localValueSuggestions(operator, '2026-02-30', now), [])
    assert.deepEqual(localValueSuggestions(operator, '2026-13-01', now), [])
  }
  assert.equal(localValueSuggestions('after', 'this', new Date('2026-01-01T00:00:00Z'))[0].id, '2025-12-29')
})

test('filter palettes and title highlighting use scoped semantic tokens', () => {
  const config = jiti(path.join(root, 'tailwind.config.ts')).default
  const { backgroundColor, borderColor } = config.theme.extend
  assert.equal(new Set(Object.values(SEARCH_FILTER_COLOURS)).size, 6)
  assert.equal(searchFilterType('from'), searchFilterType('assignee'))
  assert.equal(searchFilterType('in'), searchFilterType('board'))
  for (const operator of SEARCH_OPERATORS) {
    const type = searchFilterType(operator)
    assert.equal(searchFilterColour(operator), `bg-search-filter-${type} border-search-filter-${type}`)
    assert.equal(backgroundColor[`search-filter-${type}`], `var(--bg-search-filter-${type})`)
    assert.equal(borderColor[`search-filter-${type}`], `var(--border-search-filter-${type})`)
    assert.ok(SEARCH_TIPS[operator].example.startsWith(`${operator}:`))
    assert.ok(SEARCH_TIPS[operator].meaning)
  }
  assert.equal(backgroundColor['search-highlight'], 'var(--bg-search-highlight)')
  assert.deepEqual(Object.keys(SEARCH_TIPS).sort(), [...SEARCH_OPERATORS, ...LOGIC_OPERATORS, 'phrase', 'exclude'].sort())
})

test('drafting retains a complete value until acceptance; submitted values become chips', () => {
  for (const query of ['is:open', 'has:comment', 'after:2026-10-01', 'label:"Bug"']) {
    assert.equal(splitSearchChips(query, true, {}, true).text, query)
    assert.equal(splitSearchChips(`${query} `, true, {}, true).chips.length, 1)
    assert.equal(splitSearchChips(query, false, {}, true).chips.length, 1)
  }
  for (const query of ['from:"Kamil Gr', 'label:"Needs ']) {
    assert.equal(splitSearchChips(query, true, {}, true).chips.length, 0)
    assert.equal(searchCompletion(query).kind, 'value')
  }
})

test('title highlights are literal, case insensitive and omit filter values without HTML injection', () => {
  assert.deepEqual(highlightedTitle('Fix LOGIN and login form', 'login is:open'), [
    { text: 'Fix ', matched: false }, { text: 'LOGIN', matched: true }, { text: ' and ', matched: false }, { text: 'login', matched: true }, { text: ' form', matched: false },
  ])
  assert.deepEqual(highlightedTitle('An open task', 'is:open'), [{ text: 'An open task', matched: false }])
  assert.deepEqual(highlightedTitle('a+b [draft]', 'a+b'), [{ text: 'a+b', matched: true }, { text: ' [draft]', matched: false }])
  assert.equal(highlightedTitle('<img src=x onerror=alert(1)>', 'img').map((part) => part.text).join(''), '<img src=x onerror=alert(1)>')
})
