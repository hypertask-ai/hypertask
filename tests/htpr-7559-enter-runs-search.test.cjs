const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const flagKey = 'htpr-7559-enter-runs-search'

test('Enter search bugfix defaults to Everyone and is exported through the generated registry', () => {
  const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false, interopDefault: true })
  const flag = jiti(path.join(root, `src/lib/flags/definitions/${flagKey}.ts`))
  const keys = jiti(path.join(root, 'src/lib/flags/keys.ts'))
  const { FEATURE_FLAG_DEFINITIONS } = jiti(path.join(root, 'src/lib/flags/definitions.ts'))
  assert.equal(flag.key, flagKey)
  assert.equal(flag.kind, 'bugfix')
  assert.equal(flag.defaultMode, 'EVERYONE')
  assert.equal(flag.shippedOn, '2026-10-22')
  assert.equal(flag.releaseRisk.risk, 'small')
  assert.ok(flag.releaseRisk.reason)
  assert.equal(keys.HTPR_7559_ENTER_RUNS_SEARCH_FLAG, flagKey)
  assert.deepEqual(FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === flagKey), flag.default ?? flag)
  assert.equal(require('../e2e/smoke/production-flag-modes.json').modes[flagKey], 'EVERYONE')
})

test('desktop Enter submits plain text unless a suggestion is explicitly selected', async (t) => {
  const React = require('react')
  const { JSDOM } = require('jsdom')
  const { createJiti } = require('jiti')
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/search' })
  const previous = ['window', 'document', 'HTMLElement', 'navigator', 'fetch', 'getComputedStyle', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'].map((name) => [name, Object.getOwnPropertyDescriptor(global, name)])
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, getComputedStyle: dom.window.getComputedStyle, ResizeObserver: class { observe() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true })
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
  const flags = new Set(['htpr-6371-mobile-search', flagKey])
  const lookups = []
  global.fetch = async (url) => {
    const params = new URL(url, 'https://example.test').searchParams
    lookups.push(params)
    return { ok: true, json: async () => ({ candidates: params.get('operator') === 'from' ? [{ id: 77, name: 'Valentin Yeo' }] : [] }) }
  }
  const runs = []
  const questions = []
  let reactRoot
  try {
    const MobileViewContext = React.createContext(false)
    stub('src/hooks/useFlag.tsx', { useFlag: (key) => flags.has(key) })
    stub('src/lib/contexts/mobileContext.tsx', { MobileViewContext })
    stub('src/components/Common/UserAvatar.tsx', { default: () => null })
    stub('src/components/AI_CHAT/MentionListComp.tsx', { MentionListRows: () => null })
    const Component = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })(path.join(root, 'src/app/search/SearchChipsInput.tsx')).default
    const Harness = ({ initial, mobile }) => {
      const [value, onChange] = React.useState(initial)
      return React.createElement(MobileViewContext.Provider, { value: mobile }, React.createElement(Component, { value, onChange, onRun: (query) => runs.push(query), onAskAi: (question) => questions.push(question), boardId: 7, layoutEnabled: true, inputRef: React.useRef(null) }))
    }
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'))
    let input
    let sequence = 0
    const reset = async ({ initial = '', enabled = true, mobile = false } = {}) => {
      if (enabled) flags.add(flagKey)
      else flags.delete(flagKey)
      runs.length = 0
      questions.length = 0
      lookups.length = 0
      await React.act(async () => reactRoot.render(React.createElement(Harness, { key: sequence++, initial, mobile })))
      input = document.querySelector('[aria-label="Search tasks"]')
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
    const noSelection = () => {
      assert.equal(selected(), null)
      assert.equal(input.hasAttribute('aria-activedescendant'), false)
      assert.equal(document.querySelector('[data-search-ghost]')?.textContent ?? '', '')
    }
    const question = 'Which tasks still need attention before our next meeting with the team'

    await t.test('plain question Enter preserves every word despite last-word guesses', async () => {
      await reset()
      await type(question)
      noSelection()
      await settle()
      assert.ok(lookups.some((params) => params.get('value') === 'team'))
      assert.ok(options().length > 1, 'last-word guesses are available but not selected')
      noSelection()
      assert.match(document.body.textContent, /Tab to accept · Enter to search/)
      await press('Enter')
      assert.deepEqual(runs, [question])
      assert.deepEqual(questions, [])
      assert.equal(input.value, question)
      assert.equal(document.querySelector('[aria-label^="Remove "]'), null)
    })

    await t.test('initial text and punctuation-only questions also start without selection', async () => {
      await reset({ initial: question })
      await settle()
      noSelection()
      await press('Enter')
      assert.deepEqual(runs, [question])
      await reset()
      await type(`${question}?`)
      assert.equal(options().length, 1)
      noSelection()
      await press('Enter')
      assert.deepEqual(runs, [`${question}?`])
      assert.deepEqual(questions, [])
    })

    await t.test('enabling the flag clears an existing plain-text selection without a lookup', async () => {
      await reset({ initial: `${question}?`, enabled: false })
      assert.equal(selected(), options()[0])
      flags.add(flagKey)
      await React.act(async () => reactRoot.render(React.createElement(Harness, { key: sequence - 1, initial: `${question}?`, mobile: false })))
      noSelection()
      await press('Enter')
      assert.deepEqual(runs, [`${question}?`])
      assert.deepEqual(questions, [])
    })

    await t.test('Down selects Ask AI, further arrows reach guesses, and Up clears selection', async () => {
      await reset()
      await type(question)
      await press('ArrowDown')
      assert.equal(selected(), options()[0])
      assert.equal(input.getAttribute('aria-activedescendant'), 'mention-button-0')
      await settle()
      assert.equal(selected(), options()[0], 'lookup completion does not replace the explicit AI selection')
      await press('ArrowDown')
      assert.equal(selected(), options()[1])
      await press('ArrowUp')
      assert.equal(selected(), options()[0])
      await press('ArrowUp')
      noSelection()
      await press('ArrowDown')
      await press('Enter')
      assert.deepEqual(questions, [question])
      assert.deepEqual(runs, [])
      await reset()
      await type(question)
      await React.act(async () => options()[0].click())
      assert.deepEqual(questions, [question], 'keyboard AI handoff matches clicking')
    })

    await t.test('Down then Enter asks AI even when there are no completion rows', async () => {
      await reset()
      await type(`${question}?`)
      await press('ArrowDown')
      assert.equal(selected(), options()[0])
      await press('Enter')
      assert.deepEqual(questions, [`${question}?`])
      assert.deepEqual(runs, [])
    })

    await t.test('explicit person values remain preselected and accept with Enter or Tab', async () => {
      for (const key of ['Enter', 'Tab']) {
        await reset()
        await type('from:va')
        await settle()
        assert.match(selected().textContent, /Valentin Yeo/)
        assert.equal(input.getAttribute('aria-activedescendant'), 'mention-button-1')
        assert.equal(document.querySelector('[data-search-ghost]').textContent, 'lentin Yeo')
        await press(key)
        assert.deepEqual(runs, ['from:77'])
        assert.ok(document.querySelector('[aria-label="Remove from:Valentin Yeo filter"]'))
        assert.deepEqual(questions, [])
      }
    })

    await t.test('operator prefixes are not preselected: Enter searches the word, Tab completes the operator', async () => {
      await reset()
      await type('fr')
      noSelection()
      await press('Enter')
      assert.deepEqual(runs, ['fr'])
      assert.equal(input.value, 'fr')
      await reset()
      await type('fr')
      await press('Tab')
      assert.equal(input.value, 'from:')
      assert.deepEqual(runs, [])
    })

    await t.test('words the parser reads as filters without a colon still search as typed', async () => {
      for (const words of ['which tasks are due on this', 'tickets created by va']) {
        await reset()
        await type(words)
        await settle()
        noSelection()
        await press('Enter')
        assert.deepEqual(runs, [words])
        assert.equal(input.value, words)
        assert.equal(document.querySelector('[aria-label^="Remove "]'), null)
        assert.deepEqual(questions, [])
      }
    })

    await t.test('Tab still accepts the first last-word guess without requiring arrows', async () => {
      await reset()
      await type('valentin')
      await settle()
      noSelection()
      await press('Tab', { shiftKey: true })
      noSelection()
      assert.equal(input.value, 'valentin')
      await press('Tab')
      assert.deepEqual(runs, ['from:77'])
      assert.ok(document.querySelector('[aria-label="Remove from:Valentin Yeo filter"]'))
      assert.deepEqual(questions, [])
    })

    await t.test('flag Off retains the first-guess highlight and Enter chip acceptance', async () => {
      await reset({ enabled: false })
      await type(question)
      await settle()
      assert.equal(selected(), options()[1])
      assert.equal(input.getAttribute('aria-activedescendant'), 'mention-button-1')
      assert.match(document.body.textContent, /Tab \/ Enter to accept/)
      await press('Enter')
      assert.deepEqual(runs, ['Which tasks still need attention before our next meeting with the from:77'])
      assert.ok(document.querySelector('[aria-label="Remove from:Valentin Yeo filter"]'))
      assert.deepEqual(questions, [])
      await reset({ enabled: false })
      await type(`${question}?`)
      await press('ArrowUp')
      await press('Enter')
      assert.deepEqual(runs, [`${question}?`], 'a lone AI row retains its old regular-search Enter behavior')
      assert.deepEqual(questions, [])
    })

    await t.test('mobile Enter still runs the typed operator rather than accepting a suggestion', async () => {
      await reset({ mobile: true })
      await type('from:va')
      await settle()
      assert.match(selected().textContent, /Valentin Yeo/)
      await press('Enter')
      assert.deepEqual(runs, ['from:va'])
      assert.deepEqual(questions, [])
    })
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
