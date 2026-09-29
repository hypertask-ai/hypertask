const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const React = require('react')
const { createRoot } = require('react-dom/client')
const { JSDOM } = require('jsdom')
const { createJiti } = require('jiti')
const root = path.resolve(__dirname, '..')

test('URL searches retry the full operator query when flags load after projects', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.hypertask.ai/search?searchTerm=is:open' })
  const globals = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = globals.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)])
  global.window = dom.window
  global.document = dom.window.document
  global.HTMLElement = dom.window.HTMLElement
  global.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.HTMLElement.prototype.attachEvent = () => {}
  dom.window.HTMLElement.prototype.detachEvent = () => {}
  const stubs = []
  const stub = (file, exports) => {
    const filename = path.join(root, file)
    stubs.push([filename, require.cache[filename]])
    require.cache[filename] = { id: filename, filename, loaded: true, exports }
  }
  let enabled = false
  let chipsEnabled = false
  let chipUI = false
  let resultMode = false
  let pickerOpen = false
  let searchState
  const posts = []
  let reactRoot
  try {
    stub('src/lib/configs/search.config.ts', { searchConfig: { responseMessages: { default: '', fail: 'No results', error: 'Error' }, elementIds: { input: { id: 'search-input' }, history: { id: 'search-history' } }, handleKeyDown: { classNamesToReturnFrom: [] } } })
    stub('src/lib/flags/keys.ts', { HTPR_6369_SEARCH_OPERATORS_FLAG: 'htpr-6369-search-operators', HTPR_6370_SEARCH_CHIPS_FLAG: 'htpr-6370-search-chips' })
    stub('src/hooks/useFlag.tsx', { useFlag: (key) => key === 'htpr-6369-search-operators' ? enabled : chipsEnabled })
    stub('src/lib/contexts/deviceContext.tsx', { useDeviceContext: () => false })
    const allProjects = [{ id: 7, title: 'Visible' }]
    stub('src/hooks/MultiPages/useGetAllProjectsMinimal.ts', { useGetAllProjectsMinimal: () => ({ data: allProjects }) })
    stub('src/hooks/RecoilRoot/useHypertasksRecoilStates.ts', { default: () => ({ toggleShowCommands: () => {} }) })
    stub('src/lib/state.tsx', { useRecoilState: () => [{ show: false }, () => {}] })
    stub('src/store/index.ts', { inViewObjectAtom: {}, SearchTaskIndexAtom: {}, showCommandsAtom: {}, tasksPlayListAtom: {} })
    stub('src/hooks/Search/useSearchCache.ts', { useGetSearchCache: () => ({ data: { history: [] } }) })
    stub('src/lib/constants/index.ts', { default: { multipleKeys: {}, gThenKeyDelay: 500 } })
    stub('src/lib/constants/APIRouteConstants.ts', { searchDocumentsRoute: '/api/search/document' })
    stub('src/lib/constants/keyboard-handler.ts', { KeyCodes: { ARROW_DOWN: 40, ARROW_UP: 38, ESCAPE: 27 } })
    const axiosPath = require.resolve('axios')
    stubs.push([axiosPath, require.cache[axiosPath]])
    const post = async (_url, body) => {
      posts.push(body)
      return resultMode ? { status: 200, data: { processedData: { All: [
        { taskId: 1, projectId: 7, taskTitle: 'One' }, { taskId: 2, projectId: 7, taskTitle: 'Two' },
      ] }, tabs: ['All'] } } : { status: 204 }
    }
    require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: { default: { post }, post } }
    const navigationPath = require.resolve('next/navigation')
    stubs.push([navigationPath, require.cache[navigationPath]])
    require.cache[navigationPath] = { id: navigationPath, filename: navigationPath, loaded: true, exports: { useRouter: () => ({ replace() {}, push() {} }) } }
    const queryPath = require.resolve('@tanstack/react-query')
    stubs.push([queryPath, require.cache[queryPath]])
    require.cache[queryPath] = { id: queryPath, filename: queryPath, loaded: true, exports: { useQueryClient: () => ({ invalidateQueries() {} }) } }
    const { useSearch } = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true })(path.join(root, 'src/hooks/Search/useSearch.ts'))
    const Search = ({ term }) => {
      searchState = useSearch(term)
      chipUI = searchState.searchChipsEnabled
      return React.createElement('input', { id: 'search-input', ref: searchState.tasksInputRef, 'aria-expanded': String(pickerOpen) })
    }
    reactRoot = createRoot(document.getElementById('root'))
    for (const term of ['is:open', 'Login is:open']) {
      enabled = false
      await React.act(async () => { reactRoot.render(React.createElement(Search, { term })) })
      const count = posts.length
      assert.equal(posts.at(-1).searchQuery, term === 'is:open' ? '' : 'login')
      enabled = true
      await React.act(async () => { reactRoot.render(React.createElement(Search, { term })) })
      assert.equal(posts.length, count + 1)
      assert.equal(posts.at(-1).searchQuery, term)
      await React.act(async () => { reactRoot.render(React.createElement(Search, { term })) })
      assert.equal(posts.length, count + 1)
      assert.equal(chipUI, false)
      chipsEnabled = true
      await React.act(async () => { reactRoot.render(React.createElement(Search, { term })) })
      assert.equal(chipUI, true)
      chipsEnabled = false
    }
    chipsEnabled = true
    resultMode = true
    await React.act(async () => { reactRoot.render(React.createElement(Search, { term: 'login' })) })
    assert.equal(searchState.typedTasks.length, 2)
    assert.equal(searchState.selectedIndex, 0)
    const input = document.getElementById('search-input')
    const down = () => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }))
    input.focus()
    await React.act(async () => { down() })
    assert.equal(searchState.selectedIndex, 1, 'closed picker lets ArrowDown navigate results')
    pickerOpen = true
    await React.act(async () => { reactRoot.render(React.createElement(Search, { term: 'login' })) })
    await React.act(async () => { searchState.setSelectedIndex(0) })
    await React.act(async () => { down() })
    assert.equal(searchState.selectedIndex, 0, 'open picker owns ArrowDown')
  } finally {
    if (reactRoot) await React.act(async () => { reactRoot.unmount() })
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
