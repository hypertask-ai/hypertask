const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const React = require('react')
const { JSDOM } = require('jsdom')
const { createJiti } = require('jiti')
const root = path.resolve(__dirname, '..')

test('Find in view Enter blurs without clearing the filter or bubbling into board shortcuts', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/project' })
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']
    .map((key) => [key, Object.getOwnPropertyDescriptor(global, key)])
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
  dom.window.HTMLElement.prototype.attachEvent = () => {}
  dom.window.HTMLElement.prototype.detachEvent = () => {}
  const cached = new Map(Object.entries(require.cache))
  const stub = (file, exports) => {
    const filename = path.join(root, file)
    require.cache[filename] = { id: filename, filename, loaded: true, exports }
  }
  let reactRoot
  let boardSearch = { open: true, keyword: 'test', projectId: 7 }
  let toggled = false
  let bubbled = 0
  try {
    stub('src/store/index.ts', { boardSearchAtom: {} })
    stub('src/lib/state.tsx', { useRecoilState: () => [boardSearch, (next) => { boardSearch = typeof next === 'function' ? next(boardSearch) : next }] })
    const SearchFilter = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })(path.join(root, 'src/components/PageComponents/Kanban/HeaderComponents/SearchFilter.tsx')).default
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'))
    await React.act(async () => reactRoot.render(React.createElement(SearchFilter, { project: { id: 7 }, toggleFilter: () => { toggled = true } })))
    const input = document.getElementById('search-tasks-filter-input')
    document.addEventListener('keydown', () => { bubbled++ })
    await React.act(async () => input.focus())
    const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    await React.act(async () => input.dispatchEvent(enter))
    assert.ok(document.activeElement === document.body, 'Enter releases Find in view input focus')
    assert.equal(enter.defaultPrevented, true)
    assert.equal(bubbled, 0)
    assert.equal(input.value, 'test')
    assert.deepEqual(boardSearch, { open: true, keyword: 'test', projectId: 7 })
    assert.equal(toggled, false)
    await React.act(async () => input.focus())
    assert.ok(document.activeElement === input, 'click/focus restores editing')
    await React.act(async () => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    assert.deepEqual(boardSearch, { open: false, keyword: '', projectId: null })
    assert.equal(toggled, true)
    assert.equal(bubbled, 0)
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount())
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key]
    for (const [key, value] of cached) require.cache[key] = value
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(global, key, descriptor)
      else delete global[key]
    }
    dom.window.close()
  }
})
