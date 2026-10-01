const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const React = require('react')
const { JSDOM } = require('jsdom')
const root = path.resolve(__dirname, '..')

test('completed search keeps writing focus only with the autocomplete flag on', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/search' })
  const previous = ['window', 'document', 'navigator', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)])
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
  dom.window.HTMLElement.prototype.attachEvent = () => {}
  dom.window.HTMLElement.prototype.detachEvent = () => {}
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
  try {
    source('src/lib/configs/search.config.ts', { searchConfig: { responseMessages: { default: '', fail: 'No results', error: 'Error' }, elementIds: { input: { id: 'search-input' }, history: { id: 'search-history' } }, handleKeyDown: { classNamesToReturnFrom: [] } } })
    source('src/hooks/useFlag.tsx', { useFlag: (key) => key === 'htpr-6688-search-autocomplete' ? autocomplete : true })
    source('src/lib/contexts/deviceContext.tsx', { useDeviceContext: () => false })
    const allProjects = [{ id: 7, title: 'Visible' }]
    source('src/hooks/MultiPages/useGetAllProjectsMinimal.ts', { useGetAllProjectsMinimal: () => ({ data: allProjects }) })
    source('src/hooks/RecoilRoot/useHypertasksRecoilStates.ts', { default: () => ({ toggleShowCommands() {} }) })
    source('src/lib/state.tsx', { useRecoilState: () => [{ show: false }, () => {}] })
    source('src/store/index.ts', { inViewObjectAtom: {}, SearchTaskIndexAtom: {}, showCommandsAtom: {}, tasksPlayListAtom: {} })
    source('src/hooks/Search/useSearchCache.ts', { useGetSearchCache: () => ({ data: { history: [] } }) })
    source('src/lib/constants/index.ts', { default: { multipleKeys: {}, gThenKeyDelay: 500 } })
    source('src/lib/constants/APIRouteConstants.ts', { searchDocumentsRoute: '/api/search/document' })
    source('src/lib/constants/keyboard-handler.ts', { KeyCodes: { ARROW_DOWN: 40, ARROW_UP: 38, ESCAPE: 27 } })
    const post = async (_url, body) => {
      requests.push(body)
      return { status: 200, data: { processedData: { All: [{ taskId: 1, projectId: 7, taskTitle: 'One' }] }, tabs: ['All'] } }
    }
    stub(require.resolve('axios'), { default: { post }, post })
    stub(require.resolve('next/navigation'), { useRouter: () => ({ replace() {}, push() {}, back() {} }) })
    stub(require.resolve('@tanstack/react-query'), { useQueryClient: () => ({ invalidateQueries() {}, setQueryData() {} }) })
    const { useSearch } = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true })(path.join(root, 'src/hooks/Search/useSearch.ts'))
    const Harness = () => {
      state = useSearch('')
      return React.createElement('input', { id: 'search-input', ref: state.tasksInputRef })
    }
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'))
    for (const enabled of [false, true]) {
      autocomplete = enabled
      await React.act(async () => reactRoot.render(React.createElement(Harness, { key: String(enabled) })))
      const input = document.getElementById('search-input')
      await React.act(async () => input.focus())
      await React.act(async () => { state.updateSearchHistory('is:open') })
      assert.equal(requests.at(-1).searchQuery, 'is:open')
      assert.equal(state.typedTasks.length, 1)
      assert.equal(document.activeElement === input, enabled)
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
