const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const React = require('react')
const { JSDOM } = require('jsdom')
const { createJiti } = require('jiti')
const root = path.resolve(__dirname, '..')
const layoutFlag = 'htpr-6865-search-layout'
const labelFlag = 'htpr-6878-search-label-scope'
const prerequisites = ['htpr-6369-search-operators', 'htpr-6370-search-chips', 'htpr-6688-search-autocomplete']

async function withSearch(t, config, check) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/search' })
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT', 'fetch']
    .map((key) => [key, Object.getOwnPropertyDescriptor(global, key)])
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
  dom.window.HTMLElement.prototype.attachEvent = () => {}
  dom.window.HTMLElement.prototype.detachEvent = () => {}
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const cached = new Map(Object.entries(require.cache))
  const stub = (filename, exports) => { require.cache[filename] = { id: filename, filename, loaded: true, exports } }
  const source = (file, exports) => stub(path.join(root, file), exports)
  const flags = Object.fromEntries([...prerequisites, layoutFlag, labelFlag].map((key) => [key, true]))
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
    let candidates = operator === 'from' || operator === 'assignee' ? people
      : operator === 'label' ? config.labels ?? [{ id: 'bug', name: 'Bug', count: 3 }]
      : [{ id: 7, name: 'Product Board' }, { id: 8, name: 'Other Board' }]
    candidates = candidates.filter((row) => row.name.toLowerCase().includes(value) || String(row.id) === value)
    const resolved = params.has('resolve') ? candidates.find((row) => String(row.id) === value)?.name : undefined
    return { ok: true, json: async () => ({ candidates, ...(resolved ? { resolved } : {}) }) }
  }
  try {
    source('src/utils/index.ts', { taskBaseUri: '/detail/' })
    source('src/utils/undoActions/helperFuncs.ts', { cn: (...values) => require('tailwind-merge').twMerge(require('clsx').clsx(values)) })
    source('src/hooks/useFlag.tsx', { useFlag: (key) => flags[key] ?? false })
    source('src/lib/contexts/deviceContext.tsx', { useDeviceContext: () => false })
    const allProjects = [{ id: 7, title: 'Product Board' }, { id: 8, title: 'Other Board' }]
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
    stub(require.resolve('next/navigation'), { useSearchParams: () => new URLSearchParams(dom.window.location.search), useRouter: () => ({ replace(url) { navigations.push(url) }, push() {}, back() {} }) })
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
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input(), value)
      input().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const press = async (key, extra = {}) => React.act(async () => input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })))
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

test('registry registers the label flag with Owner + QA defaults and documents it', () => {
  const jiti = createJiti(__filename, { interopDefault: true })
  assert.equal(jiti(path.join(root, 'src/lib/flags/keys.ts')).HTPR_6878_SEARCH_LABEL_SCOPE_FLAG, labelFlag)
  const registry = (fs.readFileSync(path.join(root, 'src/lib/flags.ts'), 'utf8') + fs.readFileSync(path.join(root, 'src/lib/flags/definitions.ts'), 'utf8'))
  assert.match(registry, /key: HTPR_6878_SEARCH_LABEL_SCOPE_FLAG/)
  assert.match(registry, /DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA"/)
  assert.ok(fs.readFileSync(path.join(root, '.claude/skills/verify-qa/reference/feature-map/search.md'), 'utf8').includes(labelFlag))
})

test('client passes positive numeric and named board chips, never negated ones or context', async (t) => {
  await withSearch(t, {}, async ({ type, tick, lookups, state, render }) => {
    assert.deepEqual(state().availableSearchBoards.map((board) => board.id), [7, 8])
    for (const [query, expected] of [
      ['board:7 label:bu', '7'], ['in:7 board:8 -in:999 label:bu', '7,8'],
      ['board:"Other Board" -board:7 label:bu', '8'], ['in:#Product Board label:bu', '7'],
      ['-in:7 -board:8 label:bu', null], ['label:bu', null],
    ]) {
      await render('', true)
      await type(query)
      await tick(180)
      assert.equal(lookups.filter((params) => params.get('operator') === 'label').at(-1).get('boards'), expected, query)
    }
  })
})

test('client refreshes the same label prefix when picked boards change', async (t) => {
  await withSearch(t, {}, async ({ type, tick, lookups }) => {
    await type('board:7 label:bu')
    await tick(180)
    const before = lookups.length
    await type('board:8 label:bu')
    await tick(180)
    assert.ok(lookups.length > before)
    assert.equal(lookups.at(-1).get('boards'), '8')
  })
})

test('client renders right-aligned muted counts and zero labels remain keyboard selectable by ID', async (t) => {
  await withSearch(t, { labels: [{ id: 'bug', name: 'Bug', count: 3 }, { id: 'unused', name: 'Bug unused', count: 0 }] }, async ({ type, tick, options, press, requests }) => {
    await type('board:7 label:bu')
    await tick(180)
    const rows = options().slice(1)
    assert.deepEqual(rows.map((row) => row.lastElementChild.lastElementChild.textContent), ['3', '0'])
    assert.match(rows[0].lastElementChild.lastElementChild.className, /ml-auto.*text-right.*text-text-light-gray/)
    assert.doesNotMatch(rows[0].className, /opacity-50/)
    assert.match(rows[1].className, /opacity-50/)
    assert.equal(rows[1].disabled, false)
    await press('ArrowDown')
    await press('Tab')
    assert.equal(requests.at(-1).body.searchQuery, 'board:7 label:unused')
    assert.ok(document.querySelector('[aria-label="Remove label:Bug unused filter"]'))
  })
})

test('dedupe client selects an unscoped label by exact readable name, quoting multiword names', async (t) => {
  await withSearch(t, { labels: [{ id: 'some-id', name: 'Needs design', count: 5, byName: true }] }, async ({ type, tick, press, requests }) => {
    await type('label:ne')
    await tick(180)
    await press('Tab')
    assert.equal(requests.at(-1).body.searchQuery, 'label:"Needs design"')
    assert.ok(document.querySelector('[aria-label="Remove label:Needs design filter"]'))
  })
})

test('client Ask AI uses the same readable chip summary and hands readable names to chat', async (t) => {
  await withSearch(t, { query: 'board:7 label:bug login' }, async ({ input, type, options, prompts, aiOpened }) => {
    await type('login updated')
    await React.act(async () => input().focus())
    assert.equal(options()[0].textContent, 'Ask AIboard:#Product Board label:Bug login updated')
    assert.doesNotMatch(options()[0].textContent, /board:7|label:bug/)
    await React.act(async () => options()[0].click())
    assert.deepEqual(prompts, ['board:#Product Board label:Bug login updated'])
    assert.equal(aiOpened(), 1)
  })
})

test('client flag off keeps raw Ask AI, ID selection, no counts and no boards parameter', async (t) => {
  await withSearch(t, { flags: { [labelFlag]: false } }, async ({ type, tick, options, press, lookups, requests, state }) => {
    assert.deepEqual(state().availableSearchBoards, [])
    await type('board:7 label:bu')
    await tick(180)
    assert.equal(options()[0].textContent, 'Ask AIboard:7 label:bu')
    assert.equal(options()[1].textContent, 'Bug')
    assert.equal(options()[1].querySelector('.ml-auto'), null)
    assert.ok(lookups.every((params) => !params.has('boards')))
    await press('Tab')
    assert.equal(requests.at(-1).body.searchQuery, 'board:7 label:bug')
  })
  await withSearch(t, { flags: { [layoutFlag]: false } }, async ({ type, tick, lookups, state }) => {
    assert.deepEqual(state().availableSearchBoards, [])
    await type('board:7 label:bu')
    await tick(180)
    assert.equal(document.querySelector('[data-search-layout]'), null)
    assert.equal(document.querySelector('.ml-auto'), null)
    assert.ok(lookups.every((params) => !params.has('boards')))
  })
})
