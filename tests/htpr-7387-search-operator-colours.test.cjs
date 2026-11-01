const assert = require('node:assert/strict')
const path = require('node:path')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false, interopDefault: true })
const { parseSearchTokens, SEARCH_OPERATORS, LOGIC_OPERATORS } = jiti(path.join(root, 'src/lib/search/operators.ts'))
const { splitSearchChips } = jiti(path.join(root, 'src/lib/search/chips.ts'))
const { operatorSuggestions, searchCompletion, localValueSuggestions, searchFilterType, searchFilterColour, SEARCH_TIPS } = jiti(path.join(root, 'src/lib/search/autocomplete.ts'))

const legacyTokens = [
  { operator: 'from', value: '@Kamil', negated: false, raw: 'from:@Kamil', start: 0, end: 11 },
  { operator: 'commenter', value: '@Kamil', negated: false, raw: 'commenter:@Kamil', start: 0, end: 16 },
  { operator: 'assignee', value: '@Kamil', negated: false, raw: 'assignee:@Kamil', start: 0, end: 15 },
  { operator: 'in', value: '#Product', negated: false, raw: 'in:#Product', start: 0, end: 11 },
  { operator: 'board', value: '#Product', negated: false, raw: 'board:#Product', start: 0, end: 14 },
  { operator: 'label', value: 'Bug', negated: false, raw: 'label:Bug', start: 0, end: 9 },
  { operator: 'is', value: 'done', negated: false, raw: 'is:done', start: 0, end: 7 },
  { operator: 'before', value: '2026-10-01', negated: false, raw: 'before:2026-10-01', start: 0, end: 17 },
  { operator: 'after', value: '2026-09-01', negated: false, raw: 'after:2026-09-01', start: 0, end: 16 },
  { operator: 'on', value: '2026-10-01', negated: false, raw: 'on:2026-10-01', start: 0, end: 13 },
  { operator: 'has', value: 'attachment', negated: false, raw: 'has:attachment', start: 0, end: 14 },
]

test('legacy token output captured from the production parser stays unchanged with logic off or on', () => {
  assert.deepEqual(legacyTokens.map((token) => token.operator), SEARCH_OPERATORS)
  for (const token of legacyTokens) {
    assert.deepEqual(parseSearchTokens(token.raw, {}, true), [token])
    assert.deepEqual(parseSearchTokens(token.raw, {}, true, true), [token])
  }
  assert.deepEqual(parseSearchTokens('commenter:@Kamil', {}, false, true), [])
  assert.deepEqual(parseSearchTokens('login -label:"needs design"'), [
    { operator: 'label', value: 'needs design', negated: true, raw: '-label:"needs design"', start: 6, end: 27 },
  ])
})

const families = {
  from: 'people', commenter: 'people', assignee: 'people',
  in: 'board', board: 'board', label: 'label', is: 'status',
  before: 'date', after: 'date', on: 'date', has: 'has',
  priority: 'status', type: 'has',
}

test('each Slack-style operator uses its existing family and suggestion source', () => {
  const now = new Date('2026-10-01T12:00:00Z')
  for (const [operator, family] of Object.entries(families)) {
    const token = parseSearchTokens(`${operator}:value`, {}, true, true)[0]
    assert.equal(token.operator, operator)
    assert.equal(searchFilterType(token.operator), family)
    assert.equal(searchFilterColour(token.operator), `bg-search-filter-${family} border-search-filter-${family}`)
    assert.ok(operatorSuggestions(operator.toUpperCase(), true, true).includes(operator))
    assert.equal(searchCompletion(`${operator}:`, {}, true, true).operator, operator)
    const suggestions = localValueSuggestions(operator, '', now)
    if (['from', 'commenter', 'assignee', 'in', 'board', 'label'].includes(operator)) {
      assert.equal(suggestions, null)
    } else {
      assert.ok(suggestions.length > 0)
    }
  }
  assert.deepEqual(localValueSuggestions('priority').map(({ id }) => id), ['urgent', 'high', 'medium', 'low'])
  assert.deepEqual(localValueSuggestions('type').map(({ id }) => id), ['ticket', 'comment'])
  assert.deepEqual(localValueSuggestions('priority', 'H'), [{ id: 'high', name: 'high' }])
  assert.deepEqual(localValueSuggestions('type', 'c'), [{ id: 'comment', name: 'comment' }])
  assert.deepEqual(localValueSuggestions('is').map(({ id }) => id), ['open', 'done', 'archived'])
  for (const operator of ['before', 'after', 'on']) {
    assert.deepEqual(localValueSuggestions(operator, '', now).map(({ id }) => id), ['2026-10-01', '2026-09-30', '2026-09-24', '2026-09-28'])
  }
})

test('logic tokens preserve ranges, quoting, negation and repeated operators', () => {
  assert.deepEqual(parseSearchTokens('fix priority:high -type:"comment" priority:low', {}, true, true), [
    { operator: 'priority', value: 'high', negated: false, raw: 'priority:high', start: 4, end: 17 },
    { operator: 'type', value: 'comment', negated: true, raw: '-type:"comment"', start: 18, end: 33 },
    { operator: 'priority', value: 'low', negated: false, raw: 'priority:low', start: 34, end: 46 },
  ])
  for (const operator of LOGIC_OPERATORS) {
    const values = localValueSuggestions(operator)
    for (const { id } of values) {
      const raw = `-${operator}:${id}`
      const completion = searchCompletion(raw, {}, true, true)
      assert.deepEqual(completion, { kind: 'value', operator, value: id, start: 0, end: raw.length, negated: true })
      assert.equal(parseSearchTokens(raw, {}, true, true)[0].value, id)
      assert.equal(splitSearchChips(raw, true, {}, true, true, true).text, raw)
      assert.equal(splitSearchChips(raw, false, {}, true, true, true).chips[0].operator, operator)
      assert.equal(splitSearchChips(`${raw} `, true, {}, true, true, true).chips[0].operator, operator)
    }
  }
})

test('logic disabled preserves plain text and hides the new completions', () => {
  const raw = 'priority:high type:comment "exact phrase" -word'
  assert.deepEqual(parseSearchTokens(raw, {}, true), [])
  assert.deepEqual(splitSearchChips(raw, false, {}, true, true), { chips: [], text: raw })
  for (const operator of LOGIC_OPERATORS) {
    assert.deepEqual(operatorSuggestions(operator, true), [])
    assert.equal(searchCompletion(`${operator}:`, {}, true), null)
    assert.equal(searchCompletion(`${operator}:high`, {}, true), null)
    assert.equal(searchCompletion(operator.slice(0, 3), {}, true, true).operator, operator)
  }
})

test('plain words, exact phrases, exclusions and unknown operators never become coloured tokens', () => {
  for (const raw of ['hello world', 'priority type high comment', 'priority high', 'type ticket', 'from', 'in', 'label', 'status', '"exact phrase"', '"priority:high type:comment"', '-word', '-"exact phrase"', 'unknown:value', 'prototype:ticket', 'type:', 'priority:']) {
    assert.deepEqual(parseSearchTokens(raw, {}, true, true), [], raw)
    assert.deepEqual(splitSearchChips(raw, false, {}, true, true, true).chips, [], raw)
    const completion = searchCompletion(raw, {}, true, true)
    if (!raw.endsWith(':')) assert.notEqual(completion?.kind, 'value', raw)
  }
  const raw = '"exact phrase" -word priority:high'
  const split = splitSearchChips(raw, false, {}, true, true, true)
  assert.equal(split.text, '"exact phrase" -word')
  assert.deepEqual(split.chips.map(({ operator }) => operator), ['priority'])
})

test('four new tips describe operators and plain text without inventing phrase operators', () => {
  assert.deepEqual(Object.keys(SEARCH_TIPS).filter((key) => !SEARCH_OPERATORS.includes(key)), ['priority', 'type', 'phrase', 'exclude'])
  assert.equal(SEARCH_TIPS.priority.example, 'priority:high')
  assert.equal(SEARCH_TIPS.type.example, 'type:ticket')
  for (const tip of ['phrase', 'exclude']) {
    assert.deepEqual(parseSearchTokens(SEARCH_TIPS[tip].example, {}, true, true), [])
  }
  assert.deepEqual(operatorSuggestions('phrase', true, true), [])
  assert.deepEqual(operatorSuggestions('exclude', true, true), [])
})

test('ticket bugfix flag defaults to Everyone and also requires the original logic gate', () => {
  const flag = jiti(path.join(root, 'src/lib/flags/definitions/htpr-7387-search-operator-colours.ts'))
  assert.equal(flag.key, 'htpr-7387-search-operator-colours')
  assert.equal(flag.kind, 'bugfix')
  assert.equal(flag.defaultMode, 'EVERYONE')
  assert.ok(flag.related.includes('htpr-6368-search-operator-logic'))
  assert.equal(flag.releaseRisk.risk, 'small')
})

test('existing input keeps autocomplete on across all four logic/colour flag combinations and accepts priority/type suggestions', async () => {
  const React = require('react')
  const { JSDOM } = require('jsdom')
  const { createJiti } = require('jiti')
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/search' })
  const previous = ['window', 'document', 'HTMLElement', 'navigator', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'].map((name) => [name, Object.getOwnPropertyDescriptor(global, name)])
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  dom.window.HTMLElement.prototype.attachEvent = () => {}
  dom.window.HTMLElement.prototype.detachEvent = () => {}
  const stubs = []
  const stub = (file, exports) => {
    const filename = path.join(root, file)
    stubs.push([filename, require.cache[filename]])
    require.cache[filename] = { id: filename, filename, loaded: true, exports }
  }
  const flags = new Set()
  const requests = []
  const runs = []
  global.fetch = async (url) => {
    requests.push(String(url))
    return { ok: true, json: async () => ({ candidates: [] }) }
  }
  let reactRoot
  try {
    stub('src/hooks/useFlag.tsx', { useFlag: (key) => flags.has(key) })
    stub('src/lib/contexts/mobileContext.tsx', { MobileViewContext: React.createContext(false) })
    stub('src/components/Common/UserAvatar.tsx', { default: () => null })
    stub('src/components/AI_CHAT/MentionListComp.tsx', { MentionListRows: () => null })
    const Component = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })(path.join(root, 'src/app/search/SearchChipsInput.tsx')).default
    const Harness = ({ initial }) => {
      const [value, setValue] = React.useState(initial)
      return React.createElement(Component, { value, onChange: setValue, onRun: (query) => runs.push(query), boardId: 7, layoutEnabled: true, inputRef: React.useRef(null) })
    }
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'))
    let sequence = 0
    const render = async (initial = '') => {
      await React.act(async () => reactRoot.render(React.createElement(Harness, { key: sequence++, initial })))
      const input = document.querySelector('[aria-label="Search tasks"]')
      await React.act(async () => input.focus())
      return input
    }
    const type = async (input, value) => React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    for (const [logic, colours] of [[false, false], [false, true], [true, false], [true, true]]) {
      for (const [key, enabled] of [['htpr-6368-search-operator-logic', logic], ['htpr-7387-search-operator-colours', colours]]) {
        if (enabled) flags.add(key)
        else flags.delete(key)
      }
      const enabled = logic && colours
      for (const operator of LOGIC_OPERATORS) {
        const value = localValueSuggestions(operator)[0].id
        const input = await render(`${operator}:${value}`)
        const chip = document.querySelector(`[aria-label="Remove ${operator}:${value} filter"]`)
        assert.equal(Boolean(chip), enabled, `${operator}: logic=${logic}, colours=${colours}`)
        if (chip) assert.ok(chip.classList.contains(`bg-search-filter-${families[operator]}`))
        else assert.equal(input.value, `${operator}:${value}`)
      }
      await render()
      const options = [...document.querySelectorAll('[role="option"]')]
      assert.equal(options.length, SEARCH_OPERATORS.length + (enabled ? 4 : 0))
      for (const key of ['priority', 'type', 'phrase', 'exclude']) {
        assert.equal(options.some((row) => row.textContent.includes(SEARCH_TIPS[key].example)), enabled, key)
      }
    }
    for (const tip of ['phrase', 'exclude']) {
      const input = await render()
      const option = [...document.querySelectorAll('[role="option"]')].find((row) => row.textContent.includes(SEARCH_TIPS[tip].example))
      await React.act(async () => option.click())
      assert.equal(input.value, SEARCH_TIPS[tip].example)
      assert.equal(document.querySelector('[data-search-filter-frame]'), null)
      assert.equal(document.querySelector('[aria-label^="Remove"]'), null)
    }
    for (const operator of LOGIC_OPERATORS) {
      const input = await render()
      await type(input, `${operator}:`)
      const frame = document.querySelector('[data-search-filter-frame]')
      assert.ok(frame.classList.contains(`bg-search-filter-${families[operator]}`))
      const options = [...document.querySelectorAll('[role="option"]')].filter((row) => !row.textContent.startsWith('Ask AI'))
      assert.deepEqual(options.map((row) => row.textContent), localValueSuggestions(operator).map(({ name }) => name))
      await React.act(async () => options[0].click())
      const value = localValueSuggestions(operator)[0].id
      assert.equal(runs.at(-1), `${operator}:${value}`)
      assert.ok(document.querySelector(`[aria-label="Remove ${operator}:${value} filter"]`).classList.contains(`bg-search-filter-${families[operator]}`))
    }
    assert.ok(requests.every((url) => !/operator=(priority|type)/.test(url)))
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount())
    for (const [filename, prior] of stubs.reverse()) {
      if (prior === undefined) delete require.cache[filename]
      else require.cache[filename] = prior
    }
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor)
      else delete global[name]
    }
    dom.window.close()
  }
})
