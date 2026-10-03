const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const React = require('react')
const { JSDOM } = require('jsdom')
const { createJiti } = require('jiti')
const root = path.resolve(__dirname, '..')
const escFlag = 'htpr-6879-search-esc-back'
const commenterFlag = 'htpr-6880-search-commenter'
const labelFlag = 'htpr-6878-search-label-scope'
const layoutFlag = 'htpr-6865-search-layout'
const prerequisites = ['htpr-6369-search-operators', 'htpr-6370-search-chips', 'htpr-6688-search-autocomplete']

async function withSearch(t, config, check) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/search' })
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'localStorage', 'sessionStorage', 'IS_REACT_ACT_ENVIRONMENT', 'fetch']
    .map((key) => [key, Object.getOwnPropertyDescriptor(global, key)])
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
  dom.window.HTMLElement.prototype.attachEvent = () => {}
  dom.window.HTMLElement.prototype.detachEvent = () => {}
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const cached = new Map(Object.entries(require.cache))
  const stub = (filename, exports) => { require.cache[filename] = { id: filename, filename, loaded: true, exports } }
  const source = (file, exports) => stub(path.join(root, file), exports)
  if (config.storedHistory !== undefined) sessionStorage.setItem('htpr-6879-search-history', config.storedHistory)
  const flags = Object.fromEntries([...prerequisites, layoutFlag, escFlag].map((key) => [key, true]))
  Object.assign(flags, config.flags)
  const requests = []
  const lookups = []
  const prompts = []
  const navigations = []
  let aiOpened = 0
  let state
  let reactRoot
  const cache = { history: config.history ?? [] }
  const people = config.people ?? [{ id: 77, name: 'Malcolm Stern', email: 'malstern@aol.com' }, { id: 78, name: 'Amal Smith', email: 'amal@example.test' }]
  global.fetch = async (url) => {
    const params = new URL(url, 'https://example.test').searchParams
    lookups.push(params)
    const operator = params.get('operator')
    const value = params.get('value').toLowerCase()
    let candidates = operator === 'from' || operator === 'commenter' || operator === 'assignee' ? people
      : operator === 'label' ? [{ id: 'bug', name: 'Bug', count: 3 }]
      : [{ id: 7, name: 'inne' }]
    candidates = candidates.filter((row) => row.name.toLowerCase().includes(value) || String(row.id) === value)
    const resolved = params.has('resolve') ? candidates.find((row) => String(row.id) === value)?.name : undefined
    return { ok: true, json: async () => ({ candidates, ...(resolved ? { resolved } : {}) }) }
  }
  try {
    source('src/utils/index.ts', { taskBaseUri: '/detail/' })
    source('src/utils/undoActions/helperFuncs.ts', { cn: (...values) => require('tailwind-merge').twMerge(require('clsx').clsx(values)) })
    source('src/hooks/useFlag.tsx', { useFlag: (key) => flags[key] ?? false })
    source('src/lib/contexts/deviceContext.tsx', { useDeviceContext: () => false })
    const allProjects = [{ id: 7, title: 'Product Board' }]
    source('src/hooks/MultiPages/useGetAllProjectsMinimal.ts', { useGetAllProjectsMinimal: () => ({ data: allProjects }) })
    source('src/hooks/RecoilRoot/useHypertasksRecoilStates.ts', { default: () => ({ toggleShowCommands() {} }) })
    const SearchTaskIndexAtom = {}
    source('src/lib/state.tsx', {
      useRecoilState: (atom) => [atom === SearchTaskIndexAtom ? 0 : { show: false }, () => {}],
      useSetRecoilState: () => (prompt) => prompts.push(prompt), useRecoilValue: () => false,
    })
    source('src/lib/contexts/mobileContext.tsx', { MobileViewContext: React.createContext(false) })
    source('src/components/ProviderGlobal/useGlobalUIState.ts', { useGlobalUIState: () => ({ openAIChatInterface() { aiOpened++ } }) })
    source('src/components/commands.tsx', { default: () => null })
    source('src/components/PageComponents/Kanban/HeaderComponents/AppShellRail.tsx', { default: () => null })
    source('src/styles/search.module.scss', { default: { links_modal: 'links_modal', list_container: 'list_container', links_list: 'links_list' } })
    source('src/app/search/search-autocomplete.css', {})
    source('src/store/index.ts', { inViewObjectAtom: {}, SearchTaskIndexAtom, showCommandsAtom: {}, tasksPlayListAtom: {}, aiChatPendingPromptAtom: {}, appShellRailAtom: {} })
    source('src/hooks/Search/useSearchCache.ts', { useGetSearchCache: () => ({ data: cache }) })
    source('src/lib/constants/index.ts', { default: { multipleKeys: {}, gThenKeyDelay: 500 } })
    source('src/lib/constants/APIRouteConstants.ts', { searchDocumentsRoute: '/api/search/document' })
    source('src/lib/constants/keyboard-handler.ts', { KeyCodes: { ARROW_DOWN: 40, ARROW_UP: 38, ENTER: 13, ESCAPE: 27, J: 74, K: 75, TAB: 9 } })
    const post = (_url, body) => new Promise((resolve) => requests.push({ body, resolve }))
    stub(require.resolve('axios'), { default: { post }, post })
    stub(require.resolve('next/navigation'), { useRouter: () => ({ replace(url) { navigations.push(url) }, push() {}, back() { navigations.push('back') } }) })
    stub(require.resolve('@tanstack/react-query'), { useQueryClient: () => ({ invalidateQueries() {}, setQueryData(_key, data) { cache.history = data.history } }) })
    const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })
    const baseline = config.baseline && process.env.SEARCH_ESC_BASELINE_DIR
    if (baseline) stub(path.join(baseline, 'search-autocomplete.css'), {})
    const { useSearch } = jiti(baseline ? path.join(baseline, 'useSearch.ts') : path.join(root, 'src/hooks/Search/useSearch.ts'))
    source('src/hooks/Search/useSearch.ts', { useSearch: (...args) => { state = useSearch(...args); return state } })
    const SearchComp = jiti(baseline ? path.join(baseline, 'SearchComp.tsx') : path.join(root, 'src/app/search/SearchComp.tsx')).default
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'))
    let counter = 0
    const render = async (query = config.query ?? '', reset = false) => React.act(async () => {
      if (reset) counter++
      reactRoot.render(React.createElement(SearchComp, { key: counter, _searchTerm: query, _includeArchived: false, currentUser: {} }))
    })
    await render()
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const input = () => document.getElementById('search-input')
    const type = async (value) => React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input(), value)
      input().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const press = async (key, extra = {}) => React.act(async () => input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, keyCode: key === 'Escape' ? 27 : 0, bubbles: true, cancelable: true, ...extra })))
    const tick = async (ms = 1000) => React.act(async () => t.mock.timers.tick(ms))
    const complete = async (request = requests.at(-1), tasks = [{ taskId: 1, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 1, taskTitle: 'Result', highlight: {} }]) => React.act(async () => request.resolve({ status: 200, data: { processedData: { All: tasks }, tabs: ['All'] } }))
    const capture = (name) => {
      if (process.env.SEARCH_ESC_EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.SEARCH_ESC_EVIDENCE_DIR, `${name}.html`), document.getElementById('root').innerHTML)
    }
    const options = () => [...document.querySelectorAll('[role="option"]')]
    const selected = () => document.querySelector('[role="option"][aria-selected="true"]')
    await check({ input, type, press, tick, complete, options, selected, requests, lookups, prompts, navigations, flags, render, capture, state: () => state, aiOpened: () => aiOpened, dom })
  } finally {
    t.mock.timers.reset()
    if (reactRoot) await React.act(async () => reactRoot.unmount())
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key]
    for (const [key, value] of cached) require.cache[key] = value
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(global, key, descriptor)
      else delete global[key]
    }
    dom.window.close()
  }
}

const headings = () => [...document.querySelectorAll('[data-search-layout] h2')].map((node) => node.textContent)

test('Escape restores previous submitted search, URL, input, chips and results, not global recents', async (t) => {
  await withSearch(t, { history: ['other tab search'] }, async ({ type, press, complete, requests, navigations, input, state, render }) => {
    await type('board:#inne first')
    await press('Escape')
    await press('Enter')
    await complete()
    await render('board:#inne first')
    await React.act(async () => document.querySelector('[aria-label="Remove board:#inne filter"]').click())
    await type('second')
    await press('Enter')
    await complete()
    await render('second')
    await type('third')
    await press('Enter')
    await complete()
    await render('third')
    await press('Escape')
    assert.equal(state().inputValue, 'second')
    assert.equal(input().value, 'second')
    assert.equal(new URL(navigations.at(-1), 'https://example.test').searchParams.get('searchTerm'), 'second')
    assert.equal(requests.at(-1).body.searchQuery, 'second')
    assert.equal(document.getElementById('task_1'), null, 'previous result rows must not remain while restoring another search')
    await complete()
    await render('second')
    await press('Escape')
    assert.equal(state().inputValue, 'board:#inne first')
    assert.equal(input().value, 'first')
    assert.equal(document.querySelector('[aria-label="Remove board:#inne filter"] span').textContent, 'board:inne')
    assert.equal(new URL(navigations.at(-1), 'https://example.test').searchParams.get('searchTerm'), 'board:#inne first')
    assert.equal(requests.at(-1).body.searchQuery, 'board:#inne first')
    await complete()
    await render('board:#inne first')
    assert.ok(document.getElementById('task_1'))
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    assert.ok(!navigations.includes('back'))
    await press('Escape')
    assert.equal(state().inputValue, '')
    assert.deepEqual(headings(), ['Recent searches', 'Tips'])
    assert.equal(document.getElementById('task_1'), null)
    assert.equal(sessionStorage.getItem('htpr-6879-search-history'), '[]')
  })
})

test('direct results with no tab history Escape to recents and tips, even after blur or another Escape', async (t) => {
  await withSearch(t, { query: 'login', history: ['not from this tab'] }, async ({ press, complete, input, navigations, render, state }) => {
    await complete()
    await press('Escape')
    assert.equal(state().inputValue, '')
    assert.equal(input().value, '')
    assert.equal(new URL(navigations.at(-1), 'https://example.test').searchParams.get('searchTerm'), '')
    assert.deepEqual(headings(), ['Recent searches', 'Tips'])
    await render('')
    await press('Escape')
    assert.deepEqual(headings(), ['Recent searches', 'Tips'])
    await React.act(async () => input().blur())
    assert.deepEqual(headings(), ['Recent searches', 'Tips'])
    assert.equal(document.querySelector('#history-list'), null)
    assert.equal(document.getElementById('task_1'), null)
  })
})

test('clearing or submitting an empty draft never hides the in-flow recent searches and tips', async (t) => {
  await withSearch(t, {}, async ({ type, press, complete, state }) => {
    await type('login')
    await press('Enter')
    await complete()
    await type('')
    assert.deepEqual(headings(), ['Recent searches', 'Tips'])
    await press('Escape')
    assert.deepEqual(headings(), ['Recent searches', 'Tips'])
    await React.act(async () => state().updateSearchHistory(''))
    assert.deepEqual(headings(), ['Recent searches', 'Tips'])
    await type('   ')
    assert.deepEqual(headings(), ['Recent searches', 'Tips'])
    assert.equal(document.getElementById('task_1'), null)
  })
})

test('Escape over typed draft suggestions only dismisses the list and preserves draft and history', async (t) => {
  await withSearch(t, { query: 'first' }, async ({ type, press, complete, navigations, requests, state, input }) => {
    await complete()
    await type('board:inn')
    assert.equal(input().getAttribute('aria-expanded'), 'true')
    const before = sessionStorage.getItem('htpr-6879-search-history')
    await press('Escape')
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    assert.equal(input().value, 'board:inn')
    assert.equal(state().inputValue, 'board:inn')
    assert.equal(navigations.length, 0)
    assert.equal(requests.length, 1)
    assert.equal(sessionStorage.getItem('htpr-6879-search-history'), before)
  })
})

test('Escape from draft C restores submitted B without popping it, then A, then recents and tips', async (t) => {
  await withSearch(t, { query: 'search A' }, async ({ type, press, complete, render, input, state, requests, navigations }) => {
    await complete()
    await type('search B')
    await press('Enter')
    await complete()
    await render('search B')
    await type('draft C')
    assert.equal(input().getAttribute('aria-expanded'), 'true')
    const requestCount = requests.length
    const navigationCount = navigations.length
    await press('Escape')
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    assert.equal(state().inputValue, 'draft C')
    assert.equal(requests.length, requestCount)
    assert.equal(navigations.length, navigationCount)
    assert.deepEqual(JSON.parse(sessionStorage.getItem('htpr-6879-search-history')), ['search A', 'search B'])

    for (const [query, history] of [['search B', ['search A', 'search B']], ['search A', ['search A']]]) {
      await press('Escape')
      assert.equal(state().inputValue, query)
      assert.equal(input().value, query)
      assert.equal(requests.at(-1).body.searchQuery, query)
      assert.equal(new URL(navigations.at(-1), 'https://example.test').searchParams.get('searchTerm'), query)
      assert.deepEqual(JSON.parse(sessionStorage.getItem('htpr-6879-search-history')), history)
      await complete()
      await render(query)
      assert.equal(state().isSearchDraft, false)
      assert.ok(document.getElementById('task_1'))
    }
    await press('Escape')
    assert.equal(state().inputValue, '')
    assert.equal(input().value, '')
    assert.equal(new URL(navigations.at(-1), 'https://example.test').searchParams.get('searchTerm'), '')
    assert.deepEqual(JSON.parse(sessionStorage.getItem('htpr-6879-search-history')), [])
    assert.deepEqual(headings(), ['Recent searches', 'Tips'])
    assert.equal(document.getElementById('task_1'), null)
    assert.ok(!navigations.includes('back'))
  })
})

for (const lateHydration of [false, true]) {
  test(`empty-route remount restores persisted tab history before Escape (late flag hydration: ${lateHydration})`, async (t) => {
    await withSearch(t, { storedHistory: '["search A","search B"]', history: ['other tab search'], flags: { [escFlag]: !lateHydration } }, async ({ type, press, complete, render, input, state, requests, navigations, flags }) => {
      await render('', true)
      if (lateHydration) {
        flags[escFlag] = true
        await render('')
      }
      assert.equal(requests.length, 0)
      await type('draft C')
      assert.equal(input().getAttribute('aria-expanded'), 'true')
      await press('Escape')
      assert.equal(state().inputValue, 'draft C')
      assert.equal(requests.length, 0)
      assert.equal(sessionStorage.getItem('htpr-6879-search-history'), '["search A","search B"]')
      for (const [query, history] of [['search B', ['search A', 'search B']], ['search A', ['search A']]]) {
        await press('Escape')
        assert.equal(state().inputValue, query)
        assert.equal(input().value, query)
        assert.equal(requests.at(-1).body.searchQuery, query)
        assert.equal(new URL(navigations.at(-1), 'https://example.test').searchParams.get('searchTerm'), query)
        assert.deepEqual(JSON.parse(sessionStorage.getItem('htpr-6879-search-history')), history)
        await complete()
        await render(query)
      }
      await press('Escape')
      assert.equal(input().value, '')
      assert.equal(sessionStorage.getItem('htpr-6879-search-history'), '[]')
      assert.deepEqual(headings(), ['Recent searches', 'Tips'])
      await render('')
      await press('Escape')
      assert.equal(requests.length, 2, 'exhausted history must not reload stale persisted searches')
    })
  })
}

test('board and in chips keep their icon, omit text hash and still accept hash picker and prefixed input', async (t) => {
  await withSearch(t, { history: ['in:#inne recent', 'board:#inne recent'] }, async ({ type, press, tick, input, requests, options, complete, render }) => {
    for (const row of options().slice(0, 2)) {
      assert.doesNotMatch(row.textContent, /#inne/)
      assert.match(row.textContent, /(?:in|board):inne/)
    }
    await type('#inn')
    await tick(180)
    assert.equal(input().getAttribute('aria-expanded'), 'true')
    assert.equal(options().at(-1).textContent, 'inne')
    await press('Tab')
    assert.equal(requests.at(-1).body.searchQuery, 'in:7')
    const chip = document.querySelector('[aria-label="Remove in:inne filter"]')
    assert.equal(chip.querySelector('span').textContent, 'in:inne')
    assert.ok(chip.querySelector('svg.lucide-hash'))
    await complete()
    await render('board:#inne typed')
    await complete()
    const typedChip = document.querySelector('[aria-label="Remove board:#inne filter"]')
    assert.equal(typedChip.querySelector('span').textContent, 'board:inne')
    assert.ok(typedChip.querySelector('svg.lucide-hash'))
    assert.equal(requests.at(-1).body.searchQuery, 'board:#inne typed')
  })
})

test('history survives search remounts, consecutive identical submissions do not add Escape steps', async (t) => {
  await withSearch(t, { query: 'first' }, async ({ type, press, complete, requests, render, state }) => {
    await complete()
    await type('second')
    await press('Enter')
    await complete()
    await render('second', true)
    await complete()
    await React.act(async () => state().updateSearchHistory('second'))
    await complete()
    assert.deepEqual(JSON.parse(sessionStorage.getItem('htpr-6879-search-history')), ['first', 'second'])
    await press('Escape')
    assert.equal(requests.at(-1).body.searchQuery, 'first')
    await complete()
    assert.equal(state().inputValue, 'first')
  })
})

test('malformed or unavailable session storage does not strand search on a blank view', async (t) => {
  await withSearch(t, { query: 'login', storedHistory: '{broken' }, async ({ complete, press, input, type, requests }) => {
    await complete()
    await press('Escape')
    assert.deepEqual(headings(), ['Recent searches', 'Tips'])
    assert.equal(input().value, '')
    const setItem = window.Storage.prototype.setItem
    t.mock.method(window.Storage.prototype, 'setItem', function (...args) {
      if (this === sessionStorage) throw new Error('Storage unavailable')
      return setItem.apply(this, args)
    })
    await type('first')
    await press('Enter')
    await complete()
    await type('second')
    await press('Enter')
    await complete()
    await press('Escape')
    assert.equal(requests.at(-1).body.searchQuery, 'first')
    await complete()
    assert.equal(input().value, 'first')
  })
})

test('late flag hydration records the current URL before Escape restores tab history', async (t) => {
  await withSearch(t, { query: 'current', flags: { [escFlag]: false }, storedHistory: '["previous"]' }, async ({ complete, flags, render, press, requests, state }) => {
    await complete()
    flags[escFlag] = true
    await render('current')
    await complete()
    assert.deepEqual(JSON.parse(sessionStorage.getItem('htpr-6879-search-history')), ['previous', 'current'])
    await press('Escape')
    assert.equal(requests.at(-1).body.searchQuery, 'previous')
    await complete()
    assert.equal(state().inputValue, 'previous')
  })
})

test('searches with no matches remain in tab history, and cleared search rejects delayed results', async (t) => {
  await withSearch(t, { query: 'missing' }, async ({ complete, type, press, requests, state }) => {
    await complete(requests.at(-1), [])
    await type('second')
    await press('Enter')
    const secondRequest = requests.at(-1)
    await press('Escape')
    assert.equal(state().inputValue, 'missing')
    const restoredRequest = requests.at(-1)
    await press('Escape')
    assert.equal(state().inputValue, '')
    await complete(secondRequest)
    await complete(restoredRequest)
    assert.equal(document.getElementById('task_1'), null)
    assert.deepEqual(headings(), ['Recent searches', 'Tips'])
  })
})

for (const labelEnabled of [false, true]) {
  for (const escEnabled of [false, true]) {
    test(`label scope ${labelEnabled}, Esc back ${escEnabled}: independent scopes, counts, readable AI and history`, async (t) => {
      await withSearch(t, { query: 'board:7 first', flags: { [labelFlag]: labelEnabled, [escFlag]: escEnabled } }, async ({ complete, type, tick, options, lookups, press, requests, state, prompts }) => {
        await complete()
        assert.equal(document.querySelector('[aria-label^="Remove board:"] span').textContent, escEnabled ? 'board:inne' : 'board:#inne')
        await type('label:bu')
        await tick(180)
        assert.equal(lookups.filter((params) => params.get('operator') === 'label').at(-1).get('boards'), labelEnabled ? '7' : null)
        assert.equal(options()[1].querySelector('.ml-auto')?.textContent ?? null, labelEnabled ? '3' : null)
        const aiQuery = labelEnabled ? `board:${escEnabled ? '' : '#'}inne label:bu` : 'board:7 label:bu'
        assert.equal(options()[0].textContent, `Ask AI${aiQuery}`)
        await React.act(async () => options()[0].click())
        assert.deepEqual(prompts, [aiQuery])
        await type('second')
        await press('Enter')
        await complete()
        await press('Escape')
        if (escEnabled) {
          assert.equal(state().inputValue, 'board:7 first')
          assert.equal(requests.at(-1).body.searchQuery, 'board:7 first')
          await complete()
          await press('Escape')
          assert.equal(state().inputValue, '')
          assert.deepEqual(headings(), ['Recent searches', 'Tips'])
        } else {
          assert.equal(state().inputValue, 'board:7 second')
          assert.equal(sessionStorage.getItem('htpr-6879-search-history'), null)
        }
      })
    })
  }
}

for (const commenterEnabled of [false, true]) {
  for (const escEnabled of [false, true]) {
    for (const labelEnabled of [false, true]) {
      test(`commenter ${commenterEnabled}, Esc back ${escEnabled}, label scope ${labelEnabled}: independent chips, picker and history`, async (t) => {
        const query = 'board:7 commenter:77 first'
        await withSearch(t, { query, flags: { [commenterFlag]: commenterEnabled, [escFlag]: escEnabled, [labelFlag]: labelEnabled } }, async ({ complete, type, tick, options, lookups, press, requests, state, navigations }) => {
          await complete()
          assert.equal(document.querySelector('[aria-label^="Remove board:"] span').textContent, escEnabled ? 'board:inne' : 'board:#inne')
          const chip = document.querySelector('[aria-label^="Remove commenter:"]')
          if (commenterEnabled) assert.match(chip.textContent, /commenter:@Malcolm Stern/)
          else assert.equal(chip, null)
          await type('commenter:mal')
          await tick(180)
          assert.equal(lookups.some((params) => params.get('operator') === 'commenter'), commenterEnabled)
          assert.equal(options().some((row) => row.textContent.includes('malstern@aol.com')), commenterEnabled)
          await type('second')
          await press('Escape')
          await press('Enter')
          assert.equal(requests.at(-1).body.searchQuery, `board:7 ${commenterEnabled ? 'commenter:77 ' : ''}second`)
          await complete()
          await press('Escape')
          if (escEnabled) {
            assert.equal(state().inputValue, query)
            assert.equal(requests.at(-1).body.searchQuery, query)
            await complete()
            assert.equal(document.querySelector('[aria-label^="Remove commenter:"]') !== null, commenterEnabled)
            await press('Escape')
            assert.equal(state().inputValue, '')
            assert.deepEqual(headings(), ['Recent searches', 'Tips'])
            assert.equal(options().some((row) => row.textContent.startsWith('commenter:@Hicham')), commenterEnabled)
            assert.equal(sessionStorage.getItem('htpr-6879-search-history'), '[]')
          } else {
            assert.equal(navigations.at(-1), 'back')
            assert.equal(sessionStorage.getItem('htpr-6879-search-history'), null)
          }
        })
      })
    }
  }
}

for (const disabled of [escFlag, layoutFlag]) {
  test(`${disabled} off preserves browser-back Escape, extra hash and dismissible empty suggestions`, async (t) => {
    await withSearch(t, { query: 'board:#inne login', flags: { [disabled]: false }, baseline: true }, async ({ complete, press, navigations, input, type, state, capture }) => {
      await complete()
      capture(`${disabled}-results`)
      assert.equal(document.querySelector('[aria-label="Remove board:#inne filter"] span').textContent, 'board:#inne')
      await press('Escape')
      assert.equal(navigations.at(-1), 'back')
      assert.equal(state().inputValue, 'board:#inne login')
      assert.equal(sessionStorage.getItem('htpr-6879-search-history'), null)
      await type('draft')
      capture(`${disabled}-draft`)
      await press('Escape')
      capture(`${disabled}-dismissed-draft`)
      await type('')
      capture(`${disabled}-empty`)
      await press('Escape')
      capture(`${disabled}-dismissed-empty`)
      assert.equal(input().getAttribute('aria-expanded'), 'false')
      assert.equal(document.querySelector('[data-search-layout]'), null)
    })
  })
}

