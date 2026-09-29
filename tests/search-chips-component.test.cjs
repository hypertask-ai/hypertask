const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const React = require('react')
const { readFileSync } = require('node:fs')
test('client chip graph does not import the Prisma-backed server parser', () => {
  const component = readFileSync(path.join(root, 'src/app/search/SearchChipsInput.tsx'), 'utf8')
  const chips = readFileSync(path.join(root, 'src/lib/search/chips.ts'), 'utf8')
  assert.doesNotMatch(component + chips, /(?:from ['"]@\/lib\/search\/operators['"]|from ['"]\.\/operators['"])/)
})
test('remove icon uses the dense secondary icon token', () => {
  assert.match(readFileSync(path.join(root, 'src/app/search/SearchChipsInput.tsx'), 'utf8'), /<X size=\{14\} strokeWidth=\{1\.5\}/)
})
const { JSDOM } = require('jsdom')
const { createJiti } = require('jiti')
const root = path.resolve(__dirname, '..')

test('chip picker opens, selects with keyboard, runs, and removes on Backspace', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/search' })
  const globals = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', 'fetch']
  const previous = globals.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)])
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })
  const stubs = []
  const stub = (file, exports) => {
    const filename = path.join(root, file)
    stubs.push([filename, require.cache[filename]])
    require.cache[filename] = { id: filename, filename, loaded: true, exports }
  }
  const calls = []
  let fail = false
  let resolveLookup
  global.fetch = async (url) => {
    calls.push(String(url))
    const params = new URL(String(url), 'https://example.test').searchParams
    if (fail) return { ok: false }
    if (String(url).includes('operator=label')) await new Promise((resolve) => { resolveLookup = resolve })
    const candidates = String(url).includes('operator=in')
      ? [{ id: 7, name: 'Product Board' }]
      : String(url).includes('value=Kamil')
        ? [{ id: 1, name: 'Kamil Grzegorzewicz' }]
        : [{ id: 1, name: 'Kamil' }, { id: 2, name: 'Karla' }]
    if (params.get('value') === 'ka') candidates.splice(0, candidates.length, { id: 3, name: 'Ka' }, { id: 1, name: 'Kamil' })
    if (params.has('resolve')) candidates.splice(0, candidates.length, ...Array.from({ length: 10 }, (_, i) => ({ id: i, name: `Kamil ${i}` })))
    return { ok: true, json: async () => ({ candidates, ...(params.has('resolve') ? { resolved: 'Kamil Grzegorzewicz' } : {}) }) }
  }
  let reactRoot
  try {
    stub('src/lib/configs/search.config.ts', { searchConfig: { elementIds: { input: { id: 'search-input', placeholder: 'Search' } } } })
    stub('src/components/AI_CHAT/MentionListComp.tsx', {
      MentionListRows: ({ id, items, selectedIndex, selectItem, optionIdPrefix, isLoading, loadingLabel }) => React.createElement('div', { id, role: 'listbox' },
        isLoading ? loadingLabel : items.map((item, index) => React.createElement('button', {
          key: index, id: `${optionIdPrefix}-${index}`, role: 'option',
          'aria-selected': index === selectedIndex, onClick: () => selectItem(index),
        }, item.name))),
    })
    const SearchChipsInput = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, jsx: true })(path.join(root, 'src/app/search/SearchChipsInput.tsx')).default
    const runs = []
    const Harness = ({ initial }) => {
      const [value, setValue] = React.useState(initial)
      return React.createElement(SearchChipsInput, { value, onChange: setValue, onRun: (query) => runs.push(query), boardId: 7, inputRef: React.useRef(null) })
    }
    const { createRoot } = require('react-dom/client')
    reactRoot = createRoot(document.getElementById('root'))
    await React.act(async () => reactRoot.render(React.createElement(Harness, { initial: '' })))
    let input = document.querySelector('#search-input')
    const type = async (value) => React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const settle = async () => React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 230)) })
    const press = async (key) => React.act(async () => {
      input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }))
    })
    await type('@ka')
    await settle()
    assert.equal(input.getAttribute('aria-expanded'), 'true')
    assert.ok(calls.at(-1).includes('operator=from'))
    assert.equal(document.querySelector('[role="option"][aria-selected="true"]').textContent, 'Ka')
    await press('ArrowDown')
    assert.equal(document.querySelector('[role="option"][aria-selected="true"]').textContent, 'Kamil')
    await press('Tab')
    assert.equal(runs.at(-1), 'from:1')
    assert.match(document.querySelector('[aria-label="Remove from:Kamil filter"]').textContent, /from:Kamil/)
    await press('Backspace')
    assert.equal(runs.at(-1), '')
    assert.equal(document.querySelector('[aria-label^="Remove"]'), null)
    await type('#pro')
    await settle()
    assert.ok(calls.at(-1).includes('operator=in'))
    await press('Escape')
    assert.equal(input.value, '#pro')
    assert.equal(input.getAttribute('aria-expanded'), 'false')
    await type('#prod')
    await settle()
    await press('Enter')
    assert.equal(runs.at(-1), 'in:7')
    assert.ok(document.querySelector('[aria-label^="Remove in:Product Board"]'))
    await type('login')
    input.setSelectionRange(0, 0)
    await press('Backspace')
    assert.equal(runs.at(-1), 'login')
    assert.equal(document.querySelector('[aria-label^="Remove"]'), null)
    await type('label:bu')
    await settle()
    assert.match(document.body.textContent, /Loading suggestions/)
    await React.act(async () => { resolveLookup() })
    assert.match(document.body.textContent, /No results found|Kamil/)
    fail = true
    await type('label:bug')
    await settle()
    assert.match(document.querySelector('[role="alert"]').textContent, /Could not load suggestions/)
    fail = false
    const beforeDebounce = calls.length
    await type('from:k')
    await type('from:ka anthropic')
    assert.equal(calls.length, beforeDebounce, 'typing does not fetch every keystroke')
    assert.equal(input.value, 'from:ka anthropic')
    assert.equal(input.getAttribute('aria-expanded'), 'true')
    await settle()
    assert.equal(calls.length, beforeDebounce + 1)
    assert.equal(new URL(calls.at(-1), 'https://example.test').searchParams.get('value'), 'ka')
    assert.equal(input.value, 'from:ka anthropic', 'Ka does not auto-chip while Kamil also matches')
    await press('ArrowDown')
    await press('Enter')
    assert.equal(runs.at(-1), 'from:1 anthropic')
    await type('-from:ka')
    await settle()
    await press('Enter')
    assert.equal(runs.at(-1), 'from:1 -from:3', 'autocomplete keeps exclusion semantics')
    await React.act(async () => reactRoot.render(React.createElement(Harness, { key: 'filter-only', initial: 'from:1' })))
    await settle()
    assert.ok(calls.some((url) => new URL(url, 'https://example.test').searchParams.get('resolve') === '1'))
    assert.ok(document.querySelector('[aria-label="Remove from:Kamil Grzegorzewicz filter"]'))
    input = document.querySelector('#search-input')
    await type(' login')
    assert.ok(document.querySelector('[aria-label="Remove from:Kamil Grzegorzewicz filter"]'), 'editing retains hydrated terminal ID chip')
    await React.act(async () => reactRoot.render(React.createElement(Harness, { key: 'shared-link', initial: 'from:Kamil Grzegorzewicz login' })))
    assert.ok(document.querySelector('[aria-label="Remove from:Kamil Grzegorzewicz filter"]'))
    input = document.querySelector('#search-input')
    assert.equal(input.value, 'login')
    await type('login from:x')
    await settle()
    assert.equal(new URL(calls.at(-1), 'https://example.test').searchParams.get('value'), 'x')
    assert.ok(document.querySelector('[aria-label="Remove from:Kamil Grzegorzewicz filter"]'), 'suggestions preserve hydrated chip names')
    assert.equal(input.value, 'login from:x')
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
