const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const React = require('react')
const { JSDOM } = require('jsdom')
const root = path.resolve(__dirname, '..')

test('suggestions retain writing focus; result arrows leave it so Enter opens the selection', async () => {
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
  let autocomplete = false
  let chipsEnabled = true
  let operatorsEnabled = true
  let state
  let reactRoot
  const requests = []
  const opened = []
  try {
    source('src/utils/index.ts', { taskBaseUri: '/detail/' })
    source('src/utils/undoActions/helperFuncs.ts', { cn: (...values) => values.filter(Boolean).join(' ') })
    source('src/hooks/useFlag.tsx', { useFlag: (key) => key === 'htpr-6865-search-layout' ? false : key === 'htpr-6688-search-autocomplete' ? autocomplete : key === 'htpr-6370-search-chips' ? chipsEnabled : key === 'htpr-6369-search-operators' ? operatorsEnabled : true })
    source('src/lib/contexts/deviceContext.tsx', { useDeviceContext: () => false })
    const allProjects = [{ id: 7, title: 'Visible' }]
    source('src/hooks/MultiPages/useGetAllProjectsMinimal.ts', { useGetAllProjectsMinimal: () => ({ data: allProjects }) })
    source('src/hooks/RecoilRoot/useHypertasksRecoilStates.ts', { default: () => ({ toggleShowCommands() {} }) })
    const SearchTaskIndexAtom = {}
    source('src/lib/state.tsx', { useRecoilState: (atom) => [atom === SearchTaskIndexAtom ? 0 : { show: false }, () => {}], useSetRecoilState: () => () => {}, useRecoilValue: () => false })
    source('src/lib/contexts/mobileContext.tsx', { MobileViewContext: React.createContext(false) })
    source('src/components/ProviderGlobal/useGlobalUIState.ts', { useGlobalUIState: () => ({ openAIChatInterface() {} }) })
    source('src/components/commands.tsx', { default: () => null })
    source('src/components/PageComponents/Kanban/HeaderComponents/AppShellRail.tsx', { default: () => null })
    source('src/styles/search.module.scss', {})
    source('src/app/search/search-autocomplete.css', {})
    source('src/store/index.ts', { inViewObjectAtom: {}, SearchTaskIndexAtom, showCommandsAtom: {}, tasksPlayListAtom: {} })
    const cache = { history: [] }
    source('src/hooks/Search/useSearchCache.ts', { useGetSearchCache: () => ({ data: cache }) })
    source('src/lib/constants/index.ts', { default: { multipleKeys: {}, gThenKeyDelay: 500 } })
    source('src/lib/constants/APIRouteConstants.ts', { searchDocumentsRoute: '/api/search/document' })
    source('src/lib/constants/keyboard-handler.ts', { KeyCodes: { ARROW_DOWN: 40, ARROW_UP: 38, ENTER: 13, ESCAPE: 27, J: 74, K: 75 } })
    const post = async (_url, body) => {
      requests.push(body)
      return { status: 200, data: { processedData: { All: [
        { taskId: 1, projectId: 7, uniqueIndex: 1, taskTitle: 'One', highlight: {} },
        { taskId: 2, projectId: 7, uniqueIndex: 2, taskTitle: 'Two', highlight: {} },
      ] }, tabs: ['All'] } }
    }
    stub(require.resolve('axios'), { default: { post }, post })
    stub(require.resolve('next/navigation'), { useRouter: () => ({ replace() {}, push(url) { opened.push(url) }, back() {} }) })
    stub(require.resolve('@tanstack/react-query'), { useQueryClient: () => ({ invalidateQueries() {}, setQueryData() {} }) })
    const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })
    const { useSearch } = jiti(path.join(root, 'src/hooks/Search/useSearch.ts'))
    const SearchChipsInput = jiti(path.join(root, 'src/app/search/SearchChipsInput.tsx')).default
    const Harness = () => {
      state = useSearch('')
      return React.createElement(SearchChipsInput, { value: state.inputValue, onChange: state.setInputValue, onRun: state.updateSearchHistory, boardId: null, inputRef: state.tasksInputRef, autocompleteEnabled: autocomplete })
    }
    // The app-shell listener runs first and prevents body arrows from scrolling.
    const preventArrowScroll = (event) => {
      if (autocomplete && document.activeElement.tagName !== 'INPUT' && ['ArrowDown', 'ArrowUp'].includes(event.key)) event.preventDefault()
    }
    document.addEventListener('keydown', preventArrowScroll)
    const press = async (key, keyCode) => React.act(async () => {
      document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }))
    })
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'))
    for (const enabled of [false, true]) {
      autocomplete = enabled
      await React.act(async () => reactRoot.render(React.createElement(Harness, { key: String(enabled) })))
      const input = document.getElementById('search-input')
      await React.act(async () => state.setInputValue('login'))
      await React.act(async () => input.focus())
      await press('Enter', 13)
      assert.equal(requests.at(-1).searchQuery, 'login')
      assert.equal(state.typedTasks.length, 2)
      assert.equal(document.activeElement === input, enabled)
      await press('ArrowDown', 40)
      assert.notEqual(document.activeElement, input)
      assert.equal(state.selectedIndex, 1)
      let before = requests.length
      await press('Enter', 13)
      assert.equal(opened.at(-1), '/detail/project-7/2')
      assert.equal(requests.length, before, 'Enter opens the selected result instead of rerunning search')
      if (enabled) {
        await React.act(async () => input.focus())
        await press('ArrowUp', 38)
        assert.notEqual(document.activeElement, input)
        assert.equal(state.selectedIndex, 0)
        await press('Enter', 13)
        assert.equal(opened.at(-1), '/detail/project-7/1')
        await React.act(async () => input.focus())
        await press('ArrowUp', 38)
        assert.notEqual(document.activeElement, input, 'navigation leaves writing mode even at the first row')
        await press('Enter', 13)
        assert.equal(opened.at(-1), '/detail/project-7/1')

        await React.act(async () => input.focus())
        await React.act(async () => {
          Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'is:o')
          input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
        })
        before = requests.length
        await press('ArrowDown', 40)
        assert.equal(document.activeElement, input, 'suggestion arrows do not enter result navigation')
        await press('Enter', 13)
        assert.equal(requests.length, before + 1)
        assert.equal(requests.at(-1).searchQuery, 'is:open')
        assert.equal(document.activeElement, input, 'focus stays after accepting a suggestion and its search completes')
        assert.equal(input.getAttribute('aria-expanded'), 'false')
        await press('ArrowDown', 40)
        assert.notEqual(document.activeElement, input)
        before = requests.length
        await press('Enter', 13)
        assert.equal(opened.at(-1), '/detail/project-7/2')
        assert.equal(requests.length, before)
      }
    }
    autocomplete = true
    source('src/hooks/Search/useSearch.ts', { useSearch: (...args) => { state = useSearch(...args); return state } })
    const SearchComp = jiti(path.join(root, 'src/app/search/SearchComp.tsx')).default
    await React.act(async () => reactRoot.render(React.createElement(SearchComp, { _searchTerm: 'login is:open', _includeArchived: false, currentUser: {} })))
    assert.equal(state.typedTasks.length, 2, 'URL search has loaded its real result rows')
    const input = document.getElementById('search-input')
    await React.act(async () => { input.focus(); input.click() })
    assert.equal(state.selectedIndex, null, 'the real search container clears selection on input click')
    const before = requests.length
    await press('ArrowDown', 40)
    assert.notEqual(document.activeElement, input, 'first arrow leaves writing mode after a click')
    assert.equal(state.selectedIndex, 0)
    await press('ArrowDown', 40)
    assert.equal(state.selectedIndex, 1)
    await press('k', 75)
    assert.equal(state.selectedIndex, 0, 'k selects the previous result outside writing mode')
    await press('j', 74)
    assert.equal(state.selectedIndex, 1, 'j selects the next result outside writing mode')
    await press('Enter', 13)
    assert.equal(opened.at(-1), '/detail/project-7/2')
    assert.equal(requests.length, before, 'clicked-input arrows then Enter open a ticket, not another search')
    await React.act(async () => document.querySelector('.search-input').click())
    assert.equal(state.selectedIndex, null)
    await press('ArrowUp', 38)
    assert.equal(state.selectedIndex, state.typedTasks.length - 1, 'ArrowUp starts at the last result after blank-space deselection')
    cache.history = ['login']
    await React.act(async () => state.setInputValue(''))
    await React.act(async () => input.focus())
    assert.ok(document.querySelector('#search-chip-options [role="option"]').textContent.includes('Recent: login'), 'the actual search page passes saved history into Tips')
    for (const [chips, operators] of [[false, true], [true, false]]) {
      chipsEnabled = chips
      operatorsEnabled = operators
      await React.act(async () => reactRoot.render(React.createElement(SearchComp, { key: `${chips}-${operators}`, _searchTerm: '', _includeArchived: false, currentUser: {} })))
      assert.equal(document.querySelector('.search-autocomplete'), null, 'the page and hook agree when a prerequisite flag is disabled')
      assert.equal(document.querySelector('#search-chip-options'), null)
    }
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
