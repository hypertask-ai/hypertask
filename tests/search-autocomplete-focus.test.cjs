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
  let state
  let reactRoot
  const requests = []
  const opened = []
  try {
    source('src/lib/configs/search.config.ts', { searchConfig: { responseMessages: { default: '', fail: 'No results', error: 'Error' }, elementIds: { input: { id: 'search-input', placeholder: 'Search' }, history: { id: 'search-history' } }, handleKeyDown: { classNamesToReturnFrom: [] }, urls: { taskDetail: (projectId, index) => `/detail/project-${projectId}/${index}` } } })
    source('src/utils/undoActions/helperFuncs.ts', { cn: (...values) => values.filter(Boolean).join(' ') })
    source('src/hooks/useFlag.tsx', { useFlag: (key) => key === 'htpr-6688-search-autocomplete' ? autocomplete : true })
    source('src/lib/contexts/deviceContext.tsx', { useDeviceContext: () => false })
    const allProjects = [{ id: 7, title: 'Visible' }]
    source('src/hooks/MultiPages/useGetAllProjectsMinimal.ts', { useGetAllProjectsMinimal: () => ({ data: allProjects }) })
    source('src/hooks/RecoilRoot/useHypertasksRecoilStates.ts', { default: () => ({ toggleShowCommands() {} }) })
    const SearchTaskIndexAtom = {}
    source('src/lib/state.tsx', { useRecoilState: (atom) => [atom === SearchTaskIndexAtom ? 0 : { show: false }, () => {}] })
    source('src/store/index.ts', { inViewObjectAtom: {}, SearchTaskIndexAtom, showCommandsAtom: {}, tasksPlayListAtom: {} })
    source('src/hooks/Search/useSearchCache.ts', { useGetSearchCache: () => ({ data: { history: [] } }) })
    source('src/lib/constants/index.ts', { default: { multipleKeys: {}, gThenKeyDelay: 500 } })
    source('src/lib/constants/APIRouteConstants.ts', { searchDocumentsRoute: '/api/search/document' })
    source('src/lib/constants/keyboard-handler.ts', { KeyCodes: { ARROW_DOWN: 40, ARROW_UP: 38, ENTER: 13, ESCAPE: 27 } })
    const post = async (_url, body) => {
      requests.push(body)
      return { status: 200, data: { processedData: { All: [
        { taskId: 1, projectId: 7, uniqueIndex: 1, taskTitle: 'One' },
        { taskId: 2, projectId: 7, uniqueIndex: 2, taskTitle: 'Two' },
      ] }, tabs: ['All'] } }
    }
    stub(require.resolve('axios'), { default: { post }, post })
    stub(require.resolve('next/navigation'), { useRouter: () => ({ replace() {}, push(url) { opened.push(url) }, back() {} }) })
    stub(require.resolve('@tanstack/react-query'), { useQueryClient: () => ({ invalidateQueries() {}, setQueryData() {} }) })
    const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, jsx: true })
    const { useSearch } = jiti(path.join(root, 'src/hooks/Search/useSearch.ts'))
    const SearchChipsInput = jiti(path.join(root, 'src/app/search/SearchChipsInput.tsx')).default
    const Harness = () => {
      state = useSearch('')
      return React.createElement(SearchChipsInput, { value: state.inputValue, onChange: state.setInputValue, onRun: state.updateSearchHistory, boardId: null, inputRef: state.tasksInputRef, autocompleteEnabled: autocomplete })
    }
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
