const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false, interopDefault: true })

const footerFlag = 'htpr-7563-search-esc-footer'
const leavesFlag = 'htpr-6994-search-esc-leaves'

test('ticket bugfix flag defaults to Everyone and is exported through the generated registry', () => {
  const flag = jiti(path.join(root, `src/lib/flags/definitions/${footerFlag}.ts`))
  const keys = jiti(path.join(root, 'src/lib/flags/keys.ts'))
  const { FEATURE_FLAG_DEFINITIONS } = jiti(path.join(root, 'src/lib/flags/definitions.ts'))
  assert.equal(flag.key, footerFlag)
  assert.equal(flag.kind, 'bugfix')
  assert.equal(flag.defaultMode, 'EVERYONE')
  assert.deepEqual(flag.related, [leavesFlag])
  assert.equal(flag.releaseRisk.risk, 'small')
  assert.ok(flag.releaseRisk.reason)
  assert.equal(keys.HTPR_7563_SEARCH_ESC_FOOTER_FLAG, footerFlag)
  assert.deepEqual(FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === footerFlag), flag)
})

test('existing suggestion and tips footers match Escape for all four flag combinations in both layouts', async () => {
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
  const setFlag = (key, enabled) => enabled ? flags.add(key) : flags.delete(key)
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [] }) })
  let reactRoot
  try {
    stub('src/hooks/useFlag.tsx', { useFlag: (key) => flags.has(key) })
    stub('src/lib/contexts/mobileContext.tsx', { MobileViewContext: React.createContext(false) })
    stub('src/components/Common/UserAvatar.tsx', { default: () => null })
    stub('src/components/AI_CHAT/MentionListComp.tsx', { MentionListRows: () => null })
    const Component = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })(path.join(root, 'src/app/search/SearchChipsInput.tsx')).default
    const Harness = ({ initial }) => {
      const [value, onChange] = React.useState(initial)
      return React.createElement(Component, { value, onChange, onRun: () => {}, boardId: 7, layoutEnabled: true, inputRef: React.useRef(null) })
    }
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'))
    let sequence = 0
    for (const layout of [false, true]) {
      setFlag('htpr-6865-search-layout', layout)
      for (const [footer, leaves] of [[false, false], [false, true], [true, false], [true, true]]) {
        setFlag(footerFlag, footer)
        setFlag(leavesFlag, leaves)
        for (const initial of ['', 'is:']) {
          const context = `layout=${layout}, footer=${footer}, leaves=${leaves}, query=${initial}`
          await React.act(async () => reactRoot.render(React.createElement(Harness, { key: sequence++, initial })))
          const input = document.querySelector('[aria-label="Search tasks"]')
          await React.act(async () => input.focus())
          assert.equal(input.getAttribute('aria-expanded'), 'true', context)
          const escapeText = footer && leaves ? 'Esc to go back' : 'Esc to close'
          const prefix = layout ? '↑ ↓' : initial ? 'Suggestions · ↑ ↓' : 'Search tips · ↑ ↓ or j/k'
          const expected = `${prefix} to move · Tab / Enter to accept · ${escapeText}`
          const footers = [...document.querySelectorAll('div')].filter((node) => node.textContent === expected && node.children.length === 0)
          assert.equal(footers.length, 1, context)
          assert.equal(document.body.textContent.includes(footer && leaves ? 'Esc to close' : 'Esc to go back'), false, context)
          const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
          await React.act(async () => input.dispatchEvent(event))
          assert.equal(event.defaultPrevented, !leaves, context)
          assert.equal(input.getAttribute('aria-expanded'), String(leaves), context)
          assert.equal(input.value, initial, context)
        }
      }
    }
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
