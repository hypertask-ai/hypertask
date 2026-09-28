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
  const stubs = []
  const stub = (file, exports) => {
    const filename = path.join(root, file)
    stubs.push([filename, require.cache[filename]])
    require.cache[filename] = { id: filename, filename, loaded: true, exports }
  }
  let enabled = false
  const posts = []
  let reactRoot
  try {
    stub('src/lib/configs/search.config.ts', { searchConfig: { responseMessages: { default: '', fail: 'No results', error: 'Error' } } })
    stub('src/lib/flags/keys.ts', { HTPR_6369_SEARCH_OPERATORS_FLAG: 'htpr-6369-search-operators' })
    stub('src/hooks/useFlag.tsx', { useFlag: () => enabled })
    stub('src/lib/contexts/deviceContext.tsx', { useDeviceContext: () => false })
    const allProjects = [{ id: 7, title: 'Visible' }]
    stub('src/hooks/MultiPages/useGetAllProjectsMinimal.ts', { useGetAllProjectsMinimal: () => ({ data: allProjects }) })
    stub('src/hooks/RecoilRoot/useHypertasksRecoilStates.ts', { default: () => ({ toggleShowCommands: () => {} }) })
    stub('src/lib/state.tsx', { useRecoilState: () => [{ show: false }, () => {}] })
    stub('src/store/index.ts', { inViewObjectAtom: {}, SearchTaskIndexAtom: {}, showCommandsAtom: {}, tasksPlayListAtom: {} })
    stub('src/hooks/Search/useSearchCache.ts', { useGetSearchCache: () => ({ data: { history: [] } }) })
    stub('src/lib/constants/index.ts', { default: { multipleKeys: {}, gThenKeyDelay: 500 } })
    stub('src/lib/constants/APIRouteConstants.ts', { searchDocumentsRoute: '/api/search/document' })
    stub('src/lib/constants/keyboard-handler.ts', { KeyCodes: {} })
    stub('node_modules/axios/dist/node/axios.cjs', { default: { post: async (_url, body) => { posts.push(body); return { status: 204 } } }, post: async (_url, body) => { posts.push(body); return { status: 204 } } })
    stub('node_modules/next/navigation.js', { useRouter: () => ({ replace() {}, push() {} }) })
    stub('node_modules/@tanstack/react-query/build/modern/index.cjs', { useQueryClient: () => ({ invalidateQueries() {} }) })
    const { useSearch } = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true })(path.join(root, 'src/hooks/Search/useSearch.ts'))
    const Search = ({ term }) => { useSearch(term); return null }
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
    }
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
