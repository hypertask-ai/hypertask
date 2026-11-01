const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false, interopDefault: true })
const flag = jiti(path.join(root, 'src/lib/flags/definitions/htpr-6371-mobile-search.ts'))
const { mobileSearchPickerBounds, isMobileSearchSubmit } = jiti(path.join(root, 'src/lib/search/mobile.ts'))
const { searchCompletion, localValueSuggestions } = jiti(path.join(root, 'src/lib/search/autocomplete.ts'))
const { candidateQuery, splitSearchChips, chipQuery } = jiti(path.join(root, 'src/lib/search/chips.ts'))
const { SEARCH_OPERATORS, parseSearchQuery } = jiti(path.join(root, 'src/lib/search/operators.ts'))

test('phone search is a new Owner + QA feature with a release risk', () => {
  assert.equal(flag.key, 'htpr-6371-mobile-search')
  assert.equal(flag.kind, 'feature')
  assert.equal(flag.defaultMode, 'OWNER_AND_QA')
  assert.equal(flag.releaseRisk.risk, 'small')
  assert.ok(flag.releaseRisk.reason.length > 20)
})

test('input events and composition completion handle soft-keyboard @ and # without keydown', () => {
  for (const [text, operator, value] of [['@', 'from', ''], ['@Browser', 'from', 'Browser'], ['fix @Browser', 'from', 'Browser'], ['#', 'in', ''], ['#Board', 'in', 'Board'], ['fix #Board', 'in', 'Board']]) {
    const completion = searchCompletion(text, {}, true)
    assert.equal(completion.kind, 'value')
    assert.equal(completion.operator, operator)
    assert.equal(completion.value, value)
    const selected = candidateQuery(operator, 'Long fixture name', 985)
    const next = chipQuery([], [text.slice(0, completion.start).trim(), selected].filter(Boolean).join(' '))
    assert.equal(splitSearchChips(next, false, {}, true, true).chips[0].operator, operator)
  }
})

test('the phone Search key runs a search rather than the preselected autocomplete', () => {
  for (const type of ['insertLineBreak', 'insertParagraph']) {
    assert.equal(isMobileSearchSubmit(type, false), true)
    assert.equal(isMobileSearchSubmit(type, true), false)
  }
  for (const type of ['insertText', 'insertCompositionText', 'insertReplacementText', 'deleteContentBackward', '']) assert.equal(isMobileSearchSubmit(type, false), false)
})

test('picker geometry clears the keyboard and dock in portrait, landscape and panned viewports', () => {
  for (const [top, height, inputBottom, dockTop] of [[0, 506.4, 120], [0, 400, 92], [180, 320, 240], [0, 844, 120, 779], [0, 230, 170]]) {
    const bounds = mobileSearchPickerBounds(top, height, inputBottom, dockTop)
    assert.ok(bounds.top >= top)
    assert.ok(bounds.height >= 44)
    assert.equal(bounds.top + bounds.height, bounds.summaryTop)
    assert.ok(bounds.summaryTop + 44 <= Math.min(top + height, dockTop ?? Infinity))
  }
  assert.deepEqual(mobileSearchPickerBounds(0, 506.4, 120), { top: 136, height: 326.4, summaryTop: 462.4 })
  assert.equal(mobileSearchPickerBounds(0, 40, 90).height, 0)
})

test('mobile reuses every desktop operator and URL serialization', () => {
  assert.deepEqual(SEARCH_OPERATORS, ['from', 'commenter', 'assignee', 'in', 'board', 'label', 'is', 'before', 'after', 'on', 'has'])
  for (const operator of SEARCH_OPERATORS) {
    const completion = searchCompletion(`${operator}:`, {}, true)
    assert.equal(completion.operator, operator)
    const local = localValueSuggestions(operator, '', new Date('2026-10-11T00:00:00Z'))
    const value = local?.[0] ?? { id: 985, name: 'Fixture' }
    const query = candidateQuery(operator, value.name, value.id)
    const url = new URL('http://localhost/search')
    url.searchParams.set('searchTerm', query)
    assert.deepEqual(parseSearchQuery(url.searchParams.get('searchTerm'), {}, true), parseSearchQuery(query, {}, true))
    assert.equal(splitSearchChips(query, false, {}, true, true).chips.length, 1)
  }
})

test('real input, composition and native beforeinput events complete phone chips and submit without keydown', async (t) => {
  const React = require('react')
  const { JSDOM } = require('jsdom')
  const { createJiti } = require('jiti')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/search' })
  const previous = ['window', 'document', 'HTMLElement', 'navigator', 'fetch', 'getComputedStyle', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)])
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, getComputedStyle: dom.window.getComputedStyle, ResizeObserver: class { observe() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
  dom.window.HTMLElement.prototype.attachEvent = () => {}
  dom.window.HTMLElement.prototype.detachEvent = () => {}
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const stubs = []
  const stub = (file, exports) => {
    const filename = path.join(root, file)
    stubs.push([filename, require.cache[filename]])
    require.cache[filename] = { id: filename, filename, loaded: true, exports }
  }
  let reactRoot
  const requests = []
  const runs = []
  global.fetch = async (url) => {
    const operator = new URL(url, 'http://localhost').searchParams.get('operator')
    requests.push(operator)
    return { ok: true, json: async () => ({ candidates: [{ id: operator === 'in' ? 7 : 985, name: operator === 'in' ? 'Fixture board' : 'Fixture person' }] }) }
  }
  try {
    stub('src/hooks/useFlag.tsx', { useFlag: () => true })
    stub('src/lib/contexts/mobileContext.tsx', { MobileViewContext: React.createContext(true) })
    stub('src/components/Common/UserAvatar.tsx', { default: () => null })
    const Component = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })(path.join(root, 'src/app/search/SearchChipsInput.tsx')).default
    const Harness = () => {
      const [value, setValue] = React.useState('')
      return React.createElement(Component, { value, onChange: setValue, onRun: (query) => runs.push(query), boardId: 7, layoutEnabled: true, inputRef: React.useRef(null) })
    }
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'))
    await React.act(async () => reactRoot.render(React.createElement(Harness)))
    const field = document.querySelector('#search-input')
    await React.act(async () => field.focus())
    const type = async (text) => React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(field, text)
      field.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }))
    })
    const settle = async () => React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 230)) })
    for (const [trigger, operator] of [['@', 'from'], ['#', 'in']]) {
      await type(trigger)
      await settle()
      assert.equal(requests.at(-1), operator)
      assert.equal(document.querySelector('#search-chip-options').style.position, 'fixed')
      const selected = document.querySelector('[role="option"][aria-selected="true"]')
      await React.act(async () => selected.click())
      const chip = document.querySelector('button[aria-label^="Remove "]')
      assert.ok(chip.className.includes('min-h-[44px]'))
      assert.match(runs.at(-1), new RegExp(`^${operator}:`))
      await React.act(async () => chip.click())
    }
    await React.act(async () => field.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true })))
    await type('@Fixture')
    assert.equal(field.getAttribute('aria-expanded'), 'false', 'composition does not show premature suggestions')
    await React.act(async () => field.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true, data: '@Fixture' })))
    await settle()
    assert.equal(field.getAttribute('aria-expanded'), 'true')
    await type('fixture')
    const before = runs.length
    await React.act(async () => field.dispatchEvent(new dom.window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertParagraph' })))
    assert.equal(runs.length, before + 1)
    assert.equal(runs.at(-1), 'fixture')
    assert.equal(document.activeElement, field)
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount())
    for (const [filename, entry] of stubs) { if (entry) require.cache[filename] = entry; else delete require.cache[filename] }
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key] }
    dom.window.close()
  }
})
