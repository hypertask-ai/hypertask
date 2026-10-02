const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const React = require('react')
const { JSDOM } = require('jsdom')
const { createJiti } = require('jiti')
const root = path.resolve(__dirname, '..')

test('real search input and reused list work keyboard-only, with an unchanged flag-off path', async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/search' })
  const previous = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)])
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
  dom.window.HTMLElement.prototype.attachEvent = () => {}
  dom.window.HTMLElement.prototype.detachEvent = () => {}
  const scrolled = []
  dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.id) }
  const stubs = []
  const stub = (file, exports) => {
    const filename = path.join(root, file)
    stubs.push([filename, require.cache[filename]])
    require.cache[filename] = { id: filename, filename, loaded: true, exports }
  }
  const requests = []
  global.fetch = async (url) => {
    const params = new URL(url, 'https://example.test').searchParams
    requests.push(params)
    const operator = params.get('operator')
    assert.ok(['from', 'assignee', 'in', 'board', 'label'].includes(operator), 'no new server value API is needed')
    return { ok: true, json: async () => ({ candidates: [{ id: operator === 'label' ? 'label-id' : 7, name: operator === 'label' ? 'Bug' : 'Kamil' }] }) }
  }
  let reactRoot
  try {
    stub('src/lib/configs/search.config.ts', { searchConfig: { elementIds: { input: { id: 'search-input', placeholder: 'Search' } } } })
    stub('src/utils/undoActions/helperFuncs.ts', { cn: (...values) => values.filter(Boolean).join(' ') })
    const SearchChipsInput = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, jsx: true })(path.join(root, 'src/app/search/SearchChipsInput.tsx')).default
    const runs = []
    const Harness = ({ enabled }) => {
      const [value, onChange] = React.useState('')
      return React.createElement(SearchChipsInput, { value, onChange, onRun: (query) => runs.push(query), boardId: 7, inputRef: React.useRef(null), autocompleteEnabled: enabled })
    }
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'))
    let input
    let counter = 0
    const reset = async (enabled = true) => {
      await React.act(async () => reactRoot.render(React.createElement(Harness, { key: ++counter, enabled })))
      input = document.getElementById('search-input')
      await React.act(async () => input.focus())
    }
    const type = async (value) => React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const press = async (key, extra = {}) => React.act(async () => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })))
    const settle = async () => React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 230)) })
    const options = () => [...document.querySelectorAll('[role="option"]')]
    const selected = () => document.querySelector('[role="option"][aria-selected="true"]')

    await t.test('focused empty input offers every tip, with examples and plain meanings; clicking inserts only the operator', async () => {
      await reset()
      assert.match(document.body.textContent, /Search tips/)
      assert.equal(options().length, 10)
      assert.ok(options().every((option) => option.textContent.includes(' — ')))
      for (let i = 0; i < 9; i++) await press('ArrowDown')
      assert.ok(selected().textContent.startsWith('has:'))
      assert.equal(scrolled.at(-1), 'mention-button-9', 'keyboard selection scrolls hidden tips into view')
      await React.act(async () => options().find((option) => option.textContent.startsWith('is:')).click())
      assert.equal(input.value, 'is:')
      assert.deepEqual(options().map((option) => option.textContent), ['open', 'done', 'archived'])
      assert.ok(document.querySelector('[data-search-filter-frame]'))
    })
    await t.test('prefix ghost, arrows, Tab and Enter accept an operator then its value without losing focus', async () => {
      await reset()
      await type('a')
      assert.equal(document.querySelector('[data-search-ghost]').textContent, 'ssignee:')
      await press('ArrowDown')
      assert.equal(selected().textContent, 'after:')
      assert.equal(document.querySelector('[data-search-ghost]').textContent, 'fter:')
      await press('ArrowUp')
      assert.equal(selected().textContent, 'assignee:')
      await press('ArrowDown')
      const before = runs.length
      await press('Tab')
      assert.equal(input.value, 'after:')
      assert.equal(runs.length, before, 'accepting an operator does not run an incomplete filter')
      assert.ok(document.querySelector('[data-search-filter-frame]'))
      await press('ArrowDown')
      assert.match(selected().textContent, /Yesterday/)
      await press('Enter')
      assert.match(runs.at(-1), /^after:\d{4}-\d{2}-\d{2}$/)
      assert.equal(input.value, '')
      assert.equal(document.activeElement, input)
      assert.match(document.querySelector('[aria-label^="Remove after:"]').className, /bg-search-filter-date/)
      await press('Backspace')
      assert.equal(runs.at(-1), '')
    })
    await t.test('Escape closes only the operator/value/tips list, leaving the query and focus intact', async () => {
      let escaped = 0
      const listener = (event) => { if (event.key === 'Escape') escaped++ }
      document.addEventListener('keydown', listener)
      try {
        for (const value of ['', 'fr', 'is:o', 'after:yest']) {
          await reset()
          await type(value)
          assert.equal(input.getAttribute('aria-expanded'), 'true')
          await press('Escape')
          assert.equal(input.value, value)
          assert.equal(input.getAttribute('aria-expanded'), 'false')
          assert.equal(document.activeElement, input)
          const previousEscapes = escaped
          await press('Escape')
          assert.equal(escaped, previousEscapes + 1, 'second Escape reaches page navigation')
        }
      } finally { document.removeEventListener('keydown', listener) }
    })
    await t.test('refocusing every new value type reopens its dismissed suggestions', async () => {
      const outside = document.createElement('button')
      document.body.append(outside)
      try {
        for (const value of ['is:o', 'has:comm', 'after:yest', 'before:today', 'on:2024-02-29']) {
          await reset()
          await type(value)
          await press('Escape')
          await React.act(async () => outside.focus())
          input.setSelectionRange(value.length, value.length)
          await React.act(async () => input.focus())
          assert.equal(input.getAttribute('aria-expanded'), 'true', value)
        }
      } finally { outside.remove() }
    })
    await t.test('every static operator accepts values and keeps typed complete values framed until Tab', async () => {
      for (const [operator, value] of [['is', 'done'], ['has', 'due-date'], ['after', '2024-02-29'], ['before', '2024-02-29'], ['on', '2024-02-29']]) {
        await reset()
        await type(`${operator}:${value}`)
        assert.ok(document.querySelector('[data-search-filter-frame]'))
        assert.ok(selected())
        assert.equal(document.querySelector('[aria-label^="Remove"]'), null)
        await press('Tab')
        assert.equal(runs.at(-1), `${operator}:${value}`)
        assert.ok(document.querySelector(`[aria-label="Remove ${operator}:${value} filter"]`))
      }
      await reset()
      await type('on:2026-02-30')
      assert.equal(options().length, 0, 'invalid dates are never suggested')
      await press('Tab')
      assert.equal(input.value, 'on:2026-02-30')
    })
    await t.test('people, board and label values reuse authorized API; negative filters and existing text survive acceptance', async () => {
      for (const operator of ['from', 'assignee', 'in', 'board', 'label']) {
        await reset()
        await type(`login -${operator}:ka`)
        await settle()
        assert.equal(requests.at(-1).get('operator'), operator)
        assert.equal(requests.at(-1).get('boardId'), '7')
        await press('Enter')
        assert.equal(runs.at(-1), `login -${operator}:${operator === 'label' ? 'label-id' : 7}`)
        assert.equal(input.value, 'login')
      }
    })
    await t.test('committed is:open stays a chip after deleting login one Backspace at a time', async () => {
      await reset()
      await type('is:')
      await press('Enter')
      const chip = () => document.querySelector('[aria-label="Remove is:open filter"]')
      assert.ok(chip())
      await type('login')
      for (let remaining = 4; remaining >= 0; remaining--) {
        input.setSelectionRange(input.value.length, input.value.length)
        await press('Backspace')
        await type(input.value.slice(0, -1))
        assert.ok(chip(), 'deleting free text must not turn a committed filter into a draft')
        assert.equal(input.value, 'login'.slice(0, remaining))
        if (remaining === 0) assert.equal(input.getAttribute('aria-expanded'), 'false')
      }
      await press('Backspace')
      assert.equal(chip(), null, 'Backspace on an empty draft still removes the last chip')
      assert.equal(runs.at(-1), '')
    })
    await t.test('flag off has no operator list, ghost, tips, new frame or colour, and retains old value selection', async () => {
      await reset(false)
      assert.equal(input.getAttribute('aria-expanded'), 'false')
      assert.doesNotMatch(document.body.textContent, /Search tips/)
      await type('fr')
      assert.equal(options().length, 0)
      assert.equal(document.querySelector('[data-search-ghost]'), null)
      await type('is:o')
      assert.equal(options().length, 0)
      assert.equal(document.querySelector('[data-search-filter-frame]'), null)
      await type('from:ka')
      await settle()
      await press('Tab')
      assert.equal(runs.at(-1), 'from:7')
      const chip = document.querySelector('[aria-label="Remove from:Kamil filter"]')
      assert.match(chip.className, /text-mention-highlight/)
      assert.doesNotMatch(chip.className, /search-filter-/)
    })
    await t.test('IME Enter and Shift+Tab do not accidentally accept suggestions', async () => {
      await reset()
      await type('fr')
      await press('Enter', { isComposing: true })
      assert.equal(input.value, 'fr')
      await press('Tab', { shiftKey: true })
      assert.equal(input.value, 'fr')
    })
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount())
    for (const [filename, prior] of stubs.reverse()) {
      if (prior === undefined) delete require.cache[filename]
      else require.cache[filename] = prior
    }
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor)
      else delete global[key]
    }
    dom.window.close()
  }
})
