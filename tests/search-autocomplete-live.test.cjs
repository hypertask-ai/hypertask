const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const React = require('react')
const { JSDOM } = require('jsdom')
const root = path.resolve(__dirname, '..')

test('flagged search debounces typing, rejects stale results, and exposes submitted history in Tips', async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/search' })
  const previous = ['window', 'document', 'navigator', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)])
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
  dom.window.HTMLElement.prototype.attachEvent = () => {}
  dom.window.HTMLElement.prototype.detachEvent = () => {}
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const stubs = []
  const stub = (filename, exports) => {
    stubs.push([filename, require.cache[filename]])
    require.cache[filename] = { id: filename, filename, loaded: true, exports }
  }
  const source = (file, exports) => stub(path.join(root, file), exports)
  const requests = []
  const navigations = []
  let enabled = true
  let state
  let updateCache
  let history = []
  let reactRoot
  try {
    source('src/utils/index.ts', { taskBaseUri: '/detail/' })
    source('src/utils/undoActions/helperFuncs.ts', { cn: (...values) => values.filter(Boolean).join(' ') })
    source('src/hooks/useFlag.tsx', { useFlag: (key) => key === 'htpr-6865-search-layout' ? false : key === 'htpr-6688-search-autocomplete' ? enabled : true })
    source('src/lib/contexts/deviceContext.tsx', { useDeviceContext: () => false })
    const allProjects = [{ id: 7, title: 'Visible' }]
    source('src/hooks/MultiPages/useGetAllProjectsMinimal.ts', { useGetAllProjectsMinimal: () => ({ data: allProjects }) })
    source('src/hooks/RecoilRoot/useHypertasksRecoilStates.ts', { default: () => ({ toggleShowCommands() {} }) })
    const SearchTaskIndexAtom = {}
    source('src/lib/state.tsx', { useRecoilState: (atom) => [atom === SearchTaskIndexAtom ? 0 : { show: false }, () => {}] })
    source('src/store/index.ts', { inViewObjectAtom: {}, SearchTaskIndexAtom, showCommandsAtom: {}, tasksPlayListAtom: {} })
    source('src/hooks/Search/useSearchCache.ts', { useGetSearchCache: () => {
      const [data, setData] = React.useState({ history })
      updateCache = setData
      return { data }
    } })
    source('src/lib/constants/index.ts', { default: { multipleKeys: {}, gThenKeyDelay: 500 } })
    source('src/lib/constants/APIRouteConstants.ts', { searchDocumentsRoute: '/api/search/document' })
    source('src/lib/constants/keyboard-handler.ts', { KeyCodes: { ARROW_DOWN: 40, ARROW_UP: 38, ENTER: 13, ESCAPE: 27 } })
    const post = (_url, body) => new Promise((resolve) => requests.push({ body, resolve }))
    stub(require.resolve('axios'), { default: { post }, post })
    stub(require.resolve('next/navigation'), { useRouter: () => ({ replace(url) { navigations.push(url) }, push() {}, back() {} }) })
    stub(require.resolve('@tanstack/react-query'), { useQueryClient: () => ({ invalidateQueries() {}, setQueryData(_key, data) { history = data.history; updateCache(data) } }) })
    const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })
    const { useSearch } = jiti(path.join(root, 'src/hooks/Search/useSearch.ts'))
    const SearchChipsInput = jiti(path.join(root, 'src/app/search/SearchChipsInput.tsx')).default
    const Harness = () => {
      state = useSearch('')
      return React.createElement(SearchChipsInput, { value: state.inputValue, onChange: state.setInputValue, onRun: state.updateSearchHistory, recentSearches: state.searchCache.history, boardId: null, inputRef: state.tasksInputRef, autocompleteEnabled: enabled })
    }
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'))
    await React.act(async () => reactRoot.render(React.createElement(Harness)))
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const type = async (value) => React.act(async () => state.setInputValue(value))
    const tick = async (ms) => React.act(async () => t.mock.timers.tick(ms))
    const complete = async (request, title = request.body.searchQuery) => React.act(async () => request.resolve({ status: 200, data: { processedData: { All: [{ taskId: 1, projectId: 7, uniqueIndex: 1, taskTitle: title }] }, tabs: ['All'] } }))
    const press = async (key) => React.act(async () => document.getElementById('search-input').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))

    await type('lo')
    await tick(200)
    assert.equal(requests.length, 0)
    await type('login')
    await tick(299)
    assert.equal(requests.length, 0, 'typing resets the debounce')
    await tick(1)
    assert.equal(requests.length, 1, 'results are requested without Enter')
    assert.equal(requests[0].body.searchQuery, 'login')
    await complete(requests[0])
    assert.equal(state.typedTasks[0].taskTitle, 'login')
    assert.deepEqual(history, [], 'draft searches do not fill recent history with partial words')
    assert.deepEqual(navigations, [], 'draft searches cannot replace newer typing via delayed URL navigation')
    await tick(1000)
    assert.equal(requests.length, 1, 'result and cache renders do not repeat the search')

    await type('older')
    await tick(300)
    const older = requests.at(-1)
    await type('newer')
    await complete(older)
    assert.notEqual(state.typedTasks[0]?.taskTitle, 'older', 'a changed draft invalidates responses before the next debounce fires')
    await tick(300)
    const newer = requests.at(-1)
    await complete(newer)
    assert.equal(state.typedTasks[0].taskTitle, 'newer')
    await type('pending')
    await tick(300)
    const firstPending = requests.at(-1)
    await type('pendin')
    await type('pending')
    await complete(firstPending)
    await tick(300)
    const pending = requests.at(-1)
    assert.notEqual(pending, firstPending, 'restoring an invalidated in-flight query schedules a fresh request')
    await type('')
    assert.equal(state.typedTasks.length, 0, 'clearing the draft clears old results immediately')
    await complete(pending)
    assert.equal(state.typedTasks.length, 0, 'cleared queries cannot resurrect stale rows')

    await type('login')
    await press('Enter')
    const submitted = requests.at(-1)
    await tick(300)
    assert.equal(requests.at(-1), submitted, 'Enter cancels the duplicate live request')
    await complete(submitted)
    assert.deepEqual(history, ['login'])
    assert.deepEqual(JSON.parse(localStorage.getItem('searchCache')).history, ['login'])
    await type('')
    await React.act(async () => document.getElementById('search-input').focus())
    const recent = [...document.querySelectorAll('[role="option"]')].find((option) => option.textContent.includes('Recent: login'))
    assert.ok(recent, 'the submitted query is visible inside Tips, not behind it')
    await press('Enter')
    assert.equal(state.inputValue, 'login', 'accepting a recent row restores the full query, not a filter name')
    assert.equal(requests.at(-1).body.searchQuery, 'login')
    await complete(requests.at(-1))
    await tick(300)

    enabled = false
    await React.act(async () => reactRoot.render(React.createElement(Harness, { key: 'off' })))
    const before = requests.length
    await type('login')
    await tick(1000)
    assert.equal(requests.length, before, 'flag-off search still waits for Enter')
    await press('Enter')
    assert.equal(requests.length, before + 1)
    await complete(requests.at(-1))
    await type('')
    await React.act(async () => document.getElementById('search-input').focus())
    assert.equal(document.querySelector('[role="option"]'), null, 'flag-off search has no Tips or recent overlay')
  } finally {
    t.mock.timers.reset()
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
