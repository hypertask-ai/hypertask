const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const React = require('react')
const { JSDOM } = require('jsdom')
const { createJiti } = require('jiti')
const root = path.resolve(__dirname, '..')
const escFlag = 'htpr-6879-search-esc-back'
const leavesFlag = 'htpr-6994-search-esc-leaves'
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
  const flags = Object.fromEntries([...prerequisites, layoutFlag, escFlag, leavesFlag].map((key) => [key, true]))
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
    stub(require.resolve('next/navigation'), { useSearchParams: () => new URLSearchParams(dom.window.location.search), useRouter: () => ({ replace(url) { navigations.push(url) }, push() {}, back() { navigations.push('back') } }) })
    stub(require.resolve('@tanstack/react-query'), { useQueryClient: () => ({ invalidateQueries() {}, setQueryData(_key, data) { cache.history = data.history } }) })
    const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })
    const { useSearch } = jiti(path.join(root, 'src/hooks/Search/useSearch.ts'))
    source('src/hooks/Search/useSearch.ts', { useSearch: (...args) => { state = useSearch(...args); return state } })
    const SearchComp = jiti(path.join(root, 'src/app/search/SearchComp.tsx')).default
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
      input().focus()
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input(), value)
      input().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const press = async (key, extra = {}) => React.act(async () => input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, keyCode: key === 'Escape' ? 27 : 0, bubbles: true, cancelable: true, ...extra })))
    const tick = async (ms = 1000) => React.act(async () => t.mock.timers.tick(ms))
    const complete = async (request = requests.at(-1), tasks = [{ taskId: 1, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 1, taskTitle: 'Result', highlight: {} }]) => React.act(async () => request.resolve({ status: 200, data: { processedData: { All: tasks }, tabs: ['All'] } }))
    const options = () => [...document.querySelectorAll('[role="option"]')]
    const selected = () => document.querySelector('[role="option"][aria-selected="true"]')
    await check({ input, type, press, tick, complete, options, selected, requests, lookups, prompts, navigations, flags, render, state: () => state, aiOpened: () => aiOpened, dom })
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

test('6994 on: Escape from the empty box with tips leaves once without changing input or history', async (t) => {
  await withSearch(t, { history: ['recent search'], storedHistory: '["previous search"]' }, async ({ input, state, press, navigations, requests, options }) => {
    await React.act(async () => input().focus())
    assert.equal(input().value, '')
    assert.equal(state().inputValue, '')
    assert.equal(input().getAttribute('aria-expanded'), 'true')
    assert.ok(options().length > 0)
    assert.deepEqual([...document.querySelectorAll('[data-search-layout] h2')].map((node) => node.textContent), ['Recent searches', 'Tips'])
    const before = sessionStorage.getItem('htpr-6879-search-history')
    await press('Escape')
    assert.deepEqual(navigations, ['back'])
    assert.equal(input().value, '')
    assert.equal(state().inputValue, '')
    assert.equal(sessionStorage.getItem('htpr-6879-search-history'), before)
    assert.equal(requests.length, 0)
  })
})

test('6994 on, 6879 off: one Escape immediately after landing in the empty box leaves', async (t) => {
  await withSearch(t, { flags: { [escFlag]: false }, history: ['recent search'] }, async ({ input, state, press, navigations, requests, options }) => {
    assert.equal(document.activeElement, input())
    assert.equal(input().value, '')
    assert.equal(state().inputValue, '')
    assert.equal(input().getAttribute('aria-expanded'), 'true')
    assert.ok(options().length > 0)
    assert.equal(sessionStorage.getItem('htpr-6879-search-history'), null)
    await press('Escape')
    assert.deepEqual(navigations, ['back'])
    assert.equal(input().value, '')
    assert.equal(state().inputValue, '')
    assert.equal(sessionStorage.getItem('htpr-6879-search-history'), null)
    assert.equal(requests.length, 0)
  })
})

test('6994 on: one Escape over typed suggestions leaves without changing draft or history', async (t) => {
  await withSearch(t, { query: 'first' }, async ({ input, state, type, tick, press, complete, options, navigations, requests }) => {
    await complete()
    await type('board:inn')
    await tick(180)
    assert.equal(input().getAttribute('aria-expanded'), 'true')
    assert.ok(options().some((row) => row.textContent === 'inne'))
    const before = sessionStorage.getItem('htpr-6879-search-history')
    const requestCount = requests.length
    await press('Escape')
    assert.deepEqual(navigations, ['back'])
    assert.equal(input().value, 'board:inn')
    assert.equal(state().inputValue, 'board:inn')
    assert.equal(requests.length, requestCount)
    assert.equal(sessionStorage.getItem('htpr-6879-search-history'), before)
  })
})

test('6994 on: one Escape with suggestions open and the box blurred leaves', async (t) => {
  await withSearch(t, { query: 'first' }, async ({ input, type, tick, complete, navigations, dom }) => {
    await complete()
    await type('board:inn')
    await tick(180)
    assert.equal(input().getAttribute('aria-expanded'), 'true')
    await React.act(async () => input().blur())
    await React.act(async () => document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true })))
    assert.deepEqual(navigations, ['back'])
  })
})

test('6994 on: Escape after submitting a search leaves instead of restoring the previous search', async (t) => {
  await withSearch(t, { query: 'first' }, async ({ input, state, type, press, complete, render, navigations, requests }) => {
    await complete()
    await type('second')
    await press('Enter')
    await complete()
    await render('second')
    assert.equal(state().isSearchDraft, false)
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    assert.deepEqual(JSON.parse(sessionStorage.getItem('htpr-6879-search-history')), ['first', 'second'])
    const before = sessionStorage.getItem('htpr-6879-search-history')
    const priorNavigations = [...navigations]
    const requestCount = requests.length
    await press('Escape')
    assert.deepEqual(navigations, [...priorNavigations, 'back'])
    assert.equal(input().value, 'second')
    assert.equal(state().inputValue, 'second')
    assert.equal(requests.length, requestCount)
    assert.equal(requests.at(-1).body.searchQuery, 'second')
    assert.equal(sessionStorage.getItem('htpr-6879-search-history'), before)
  })
})

test('6994 off: Escape still restores the previous submitted search with 6879 and never leaves', async (t) => {
  await withSearch(t, { query: 'first', flags: { [leavesFlag]: false } }, async ({ input, state, type, press, complete, render, navigations, requests }) => {
    await complete()
    await type('second')
    await press('Enter')
    await complete()
    await render('second')
    assert.equal(state().isSearchDraft, false)
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    assert.deepEqual(JSON.parse(sessionStorage.getItem('htpr-6879-search-history')), ['first', 'second'])
    const priorNavigations = [...navigations]
    const requestCount = requests.length
    await press('Escape')
    assert.equal(navigations.length, priorNavigations.length + 1)
    assert.deepEqual(navigations.slice(0, -1), priorNavigations)
    assert.equal(new URL(navigations.at(-1), 'https://example.test').searchParams.get('searchTerm'), 'first')
    assert.ok(!navigations.includes('back'))
    assert.equal(input().value, 'first')
    assert.equal(state().inputValue, 'first')
    assert.equal(requests.length, requestCount + 1)
    assert.equal(requests.at(-1).body.searchQuery, 'first')
    assert.deepEqual(JSON.parse(sessionStorage.getItem('htpr-6879-search-history')), ['first'])
    await complete()
    await render('first')
    assert.equal(state().isSearchDraft, false)
    assert.ok(document.getElementById('task_1'))
  })
})
