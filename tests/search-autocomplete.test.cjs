const assert = require('node:assert/strict')
const path = require('node:path')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true })
const { operatorSuggestions, searchCompletion, localValueSuggestions, searchFilterType, searchFilterColour, SEARCH_FILTER_COLOURS, SEARCH_TIPS, highlightedTitle } = jiti(path.join(root, 'src/lib/search/autocomplete.ts'))
const { SEARCH_OPERATORS, parseSearchQuery } = jiti(path.join(root, 'src/lib/search/operators.ts'))
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

test('all operators get either access-scoped entity lookups or valid local values', () => {
  const now = new Date('2026-10-01T23:45:00Z')
  const server = readFileSync(path.join(root, 'src/lib/search/filters.ts'), 'utf8')
  for (const operator of SEARCH_OPERATORS) {
    assert.equal(searchCompletion(`${operator}:`).kind, 'value')
    assert.equal(searchCompletion(`${operator}:`).operator, operator)
    const suggestions = localValueSuggestions(operator, '', now)
    if (['from', 'assignee', 'in', 'board', 'label'].includes(operator)) {
      assert.equal(suggestions, null, 'entities use the existing authorized API')
    } else {
      assert.ok(suggestions.length)
      for (const { id } of suggestions) {
        assert.equal(parseSearchQuery(`${operator}:${id}`).filters[operator][0].value, id)
        if (operator === 'is' || operator === 'has') assert.ok(server.includes(`case '${id}':`), `${id} is accepted by the server`)
        else assert.match(id, /^\d{4}-\d{2}-\d{2}$/)
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

test('filter palettes and title highlighting use scoped semantic tokens for every theme', () => {
  const config = jiti(path.join(root, 'tailwind.config.ts')).default
  const { backgroundColor, borderColor } = config.theme.extend
  const { resolvedThemeDomMetadata } = jiti(path.join(root, 'src/lib/themePreferences.ts'))
  const themes = ['light', 'dark', ...Object.keys(resolvedThemeDomMetadata)]
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
  const palette = readFileSync(path.join(root, 'src/app/search/search-autocomplete.css'), 'utf8')
  for (const type of Object.keys(SEARCH_FILTER_COLOURS)) {
    for (const role of ['bg', 'border']) {
      assert.match(palette, new RegExp(`--${role}-search-filter-${type}: #[0-9a-f]{6};`, 'i'), `${role} ${type}`)
    }
  }
  assert.match(palette, /--bg-search-highlight: var\(--bg-mention-highlight\);/)
  for (const theme of themes) {
    const css = readFileSync(path.join(root, `src/styles/tailwindThemes/${theme}.css`), 'utf8')
    assert.match(css, /--bg-mention-highlight:\s*#[0-9a-f]{6};/i, theme)
  }
  const component = readFileSync(path.join(root, 'src/app/search/SearchComp.tsx'), 'utf8')
  assert.match(component, /<mark[^>]*className="rounded-\[2px\] bg-search-highlight text-inherit"/)
  assert.deepEqual(Object.keys(SEARCH_TIPS).sort(), [...SEARCH_OPERATORS].sort())
})

test('enabled drafting retains a complete value until acceptance; flag off keeps 6370 behavior', () => {
  for (const query of ['is:open', 'has:comment', 'after:2026-10-01', 'label:"Bug"']) {
    assert.equal(splitSearchChips(query, true, {}, true).text, query)
    assert.equal(splitSearchChips(query, true).chips.length, 1)
    assert.equal(splitSearchChips(`${query} `, true, {}, true).chips.length, 1)
    assert.equal(splitSearchChips(query, false, {}, true).chips.length, 1)
  }
  for (const query of ['from:"Kamil Gr', 'label:"Needs ']) {
    assert.equal(splitSearchChips(query, true, {}, true).chips.length, 0)
    assert.equal(searchCompletion(query).kind, 'value')
  }
  const flags = readFileSync(path.join(root, 'src/lib/flags.ts'), 'utf8')
  const keys = readFileSync(path.join(root, 'src/lib/flags/keys.ts'), 'utf8')
  const component = readFileSync(path.join(root, 'src/app/search/SearchComp.tsx'), 'utf8')
  assert.match(keys, /HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG = "htpr-6688-search-autocomplete"/)
  assert.match(flags, /key: HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG/)
  assert.match(flags, /DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA"/)
  assert.match(component, /useFlag\(\s*HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG\s*\)/)
  assert.match(component, /autocompleteFlagEnabled \? \(\s*<SearchChipsInput[\s\S]*?\sautocompleteEnabled\s*\/>/)
})

test('title highlights are literal, case insensitive and omit filter values without HTML injection', () => {
  assert.deepEqual(highlightedTitle('Fix LOGIN and login form', 'login is:open'), [
    { text: 'Fix ', matched: false }, { text: 'LOGIN', matched: true }, { text: ' and ', matched: false }, { text: 'login', matched: true }, { text: ' form', matched: false },
  ])
  assert.deepEqual(highlightedTitle('An open task', 'is:open'), [{ text: 'An open task', matched: false }])
  assert.deepEqual(highlightedTitle('a+b [draft]', 'a+b'), [{ text: 'a+b', matched: true }, { text: ' [draft]', matched: false }])
  assert.equal(highlightedTitle('<img src=x onerror=alert(1)>', 'img').map((part) => part.text).join(''), '<img src=x onerror=alert(1)>')
})
