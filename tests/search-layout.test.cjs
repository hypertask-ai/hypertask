const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const React = require('react')
const { JSDOM } = require('jsdom')
const { createJiti } = require('jiti')
const root = path.resolve(__dirname, '..')
const layoutFlag = 'htpr-6865-search-layout'
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
  const flags = Object.fromEntries([...prerequisites, layoutFlag].map((key) => [key, true]))
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
      : operator === 'label' ? [{ id: 'bug', name: 'Bug' }]
      : [{ id: 7, name: 'Product Board' }]
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
    stub(require.resolve('next/navigation'), { useRouter: () => ({ replace(url) { navigations.push(url) }, push(url) { navigations.push(url) }, back() {} }) })
    stub(require.resolve('@tanstack/react-query'), { useQueryClient: () => ({ invalidateQueries() {}, setQueryData(_key, data) { cache.history = data.history } }) })
    const baseline = config.baseline && process.env.SEARCH_LAYOUT_BASELINE_DIR
    const jiti = createJiti(__filename, { alias: { ...(baseline ? { '@/lib/search': path.join(baseline, 'search') } : {}), '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })
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
    const press = async (key, extra = {}) => React.act(async () => input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })))
    const tick = async (ms = 1000) => React.act(async () => t.mock.timers.tick(ms))
    const complete = async (request = requests.at(-1), tasks = [{ taskId: 1, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 1, taskTitle: 'Result', highlight: {} }]) => React.act(async () => request.resolve({ status: 200, data: { processedData: { All: tasks }, tabs: ['All'] } }))
    const capture = (name) => {
      if (process.env.SEARCH_LAYOUT_EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.SEARCH_LAYOUT_EVIDENCE_DIR, `${name}.html`), document.getElementById('root').innerHTML)
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

test('layout flag registry uses Owner + QA defaults', () => {
  const jiti = createJiti(__filename, { interopDefault: true })
  const keys = jiti(path.join(root, 'src/lib/flags/keys.ts'))
  assert.equal(keys.HTPR_6865_SEARCH_LAYOUT_FLAG, layoutFlag)
  const registry = fs.readFileSync(path.join(root, 'src/lib/flags.ts'), 'utf8')
  assert.match(registry, /key: HTPR_6865_SEARCH_LAYOUT_FLAG/)
  assert.match(registry, /DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA"/)
})

test('flag off retains the floating popover, duplicate legacy history, Ask AI and live search', async (t) => {
  await withSearch(t, { flags: { [layoutFlag]: false }, history: ['login'], baseline: true }, async ({ input, type, tick, complete, requests, capture }) => {
    const list = document.getElementById('search-chip-options')
    assert.match(list.className, /w-\[18rem\].*max-h-\[14rem\]/)
    assert.match(list.parentElement.className, /absolute left-4 top-full/)
    assert.ok(document.getElementById('history-list'))
    assert.match(document.body.textContent, /Recent: login/)
    assert.equal(document.querySelector('[data-search-layout]'), null)
    capture('off-empty')
    await type('fr')
    capture('off-prefix')
    await type('from:mal')
    await tick(180)
    capture('off-value')
    await type('login')
    assert.equal(input().value, 'login')
    assert.equal(document.querySelectorAll('#ask-ai-row').length, 1)
    await tick(299)
    assert.equal(requests.length, 0)
    await tick(1)
    assert.equal(requests.length, 1)
    await complete()
    assert.ok(document.getElementById('task_1'))
    capture('off-results')
  })
})

test('layout requires every autocomplete prerequisite flag', async (t) => {
  for (const key of prerequisites) {
    await withSearch(t, { flags: { [key]: false } }, async ({ type, tick, requests }) => {
      assert.equal(document.querySelector('[data-search-layout]'), null)
      await type('login')
      await tick()
      assert.equal(requests.length, 0)
    })
  }
})

test('recents appear once with readable chips in-flow, tips follow in responsive columns', async (t) => {
  await withSearch(t, { history: ['label:Bug chat', 'from:77 ab test', 'label:Bug chat'] }, async ({ options, capture }) => {
    const list = document.querySelector('[data-search-layout]')
    assert.ok(list)
    assert.match(list.className, /w-full min-w-0/)
    assert.doesNotMatch(list.className, /absolute|max-h|overflow-hidden|overflow-y/)
    assert.equal(document.getElementById('history-list'), null)
    assert.doesNotMatch(list.textContent, /Recent:/)
    assert.equal(options().filter((row) => row.textContent.replace(/\s+/g, ' ').includes('label:Bug') && row.textContent.includes('chat')).length, 1)
    assert.match(options()[1].textContent, /from:@Malcolm Stern.*ab test/)
    assert.ok(options()[1].querySelector('.text-micro'))
    assert.deepEqual([...list.querySelectorAll('h2')].map((node) => node.textContent), ['Recent searches', 'Tips'])
    const tipsHeading = list.querySelectorAll('h2')[1]
    assert.ok(options().slice(0, 2).every((row) => row.compareDocumentPosition(tipsHeading) & 4))
    assert.equal(tipsHeading.nextElementSibling.children.length, 10)
    assert.match(tipsHeading.nextElementSibling.className, /grid-cols-1.*@md:grid-cols-2/)
    assert.ok(tipsHeading.nextElementSibling.lastElementChild.textContent.includes('Has an attachment'))
    assert.ok(options().slice(2).every((row) => row.querySelector('strong')))
    assert.equal(options()[0].getAttribute('aria-selected'), 'true')
    capture('empty')
  })
})

test('empty tips keyboard arrows, j/k, Tab/Enter, Escape and first-row selection still work', async (t) => {
  await withSearch(t, {}, async ({ input, press, selected, requests }) => {
    assert.match(selected().textContent, /^from:/)
    await press('j')
    assert.match(selected().textContent, /^assignee:/)
    await press('k')
    assert.match(selected().textContent, /^from:/)
    await press('ArrowDown')
    await press('ArrowDown')
    assert.match(selected().textContent, /^in:/)
    await press('ArrowUp')
    await press('Tab')
    assert.equal(input().value, 'assignee:')
    assert.equal(requests.length, 0, 'accepting an unfinished operator must not search')
    await press('Escape')
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    assert.equal(document.activeElement, input())
    assert.equal(input().value, 'assignee:')
  })
})

test('typing suggestions put Ask AI once before operators and values and bold substring matches', async (t) => {
  await withSearch(t, {}, async ({ type, tick, options, selected, input, requests }) => {
    await type('a')
    await tick(180)
    const rows = options()
    assert.equal(rows[0].textContent, 'Ask AIa')
    assert.equal(rows.filter((row) => row.textContent.startsWith('Ask AI')).length, 1)
    assert.equal(document.getElementById('ask-ai-row'), null)
    assert.equal(rows[1].textContent, 'assignee:')
    assert.equal(rows[2].textContent, 'after:')
    assert.match(rows[3].textContent, /Malcolm Stern.*malstern@aol.com/)
    assert.match(rows[3].className, /@md:grid-cols-2/)
    assert.ok(rows[3].querySelector('strong'))
    assert.equal(selected(), rows[1], 'best completion, not Ask AI, is initially selected')
    assert.equal(input().getAttribute('aria-activedescendant'), rows[1].id)
    assert.equal(requests.length, 0)
  })
})

test('Ask AI suggestion reuses the general chat handoff, not document search', async (t) => {
  await withSearch(t, {}, async ({ type, options, prompts, aiOpened, requests }) => {
    await type('help me find work')
    await React.act(async () => options()[0].click())
    assert.deepEqual(prompts, ['help me find work'])
    assert.equal(aiOpened(), 1)
    assert.equal(requests.length, 0)
  })
})

test('value ghost for from:mal uses the authorized people response; Tab accepts the selected chip and runs search', async (t) => {
  await withSearch(t, {}, async ({ type, tick, input, press, selected, options, requests, lookups, complete, capture }) => {
    await type('from:mal')
    await tick(180)
    assert.equal(lookups.at(-1).get('operator'), 'from')
    assert.equal(lookups.at(-1).get('value'), 'mal')
    assert.equal(document.querySelector('[data-search-ghost]').textContent, 'colm Stern')
    assert.match(selected().textContent, /Malcolm Stern.*malstern@aol.com/)
    assert.equal(selected().querySelector('strong').textContent, 'Mal')
    assert.ok(selected().querySelector('[aria-hidden="true"]'), 'the existing avatar is reused')
    assert.equal(options()[0].textContent, 'Ask AIfrom:mal')
    capture('value')
    await React.act(async () => { input().setSelectionRange(2, 2); input().dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    assert.equal(document.querySelector('[data-search-ghost]').textContent, '', 'caret away from end hides ghost')
    await React.act(async () => { input().setSelectionRange(input().value.length, input().value.length); input().dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    await press('Tab')
    assert.equal(input().value, '')
    assert.ok(document.querySelector('[aria-label="Remove from:Malcolm Stern filter"]'))
    assert.equal(requests.at(-1).body.searchQuery, 'from:77')
    await complete()
    assert.equal(document.querySelector('[data-search-layout]'), null)
    assert.ok(document.getElementById('task_1'))
  })
})

test('value ghost is case-insensitive for each entity operator and never invents substring completion', async (t) => {
  await withSearch(t, {}, async ({ type, tick, press }) => {
    for (const [query, remainder] of [['from:MAL', 'colm Stern'], ['assignee:mal', 'colm Stern'], ['in:pro', 'duct Board'], ['board:pro', 'duct Board'], ['label:bu', 'g']]) {
      await type(query)
      await tick(180)
      assert.equal(document.querySelector('[data-search-ghost]').textContent, remainder, query)
    }
    await type('from:mal')
    await tick(180)
    await press('ArrowDown')
    assert.equal(document.querySelector('[data-search-ghost]').textContent, '', 'Amal matches inside the name but is not a prefix')
    await type('label:bu')
    await tick(180)
    await press('Enter')
    assert.ok(document.querySelector('[aria-label="Remove label:Bug filter"]'))
  })
})

test('typing makes no live search request; Enter runs search, draft changes hide stale results and messages', async (t) => {
  await withSearch(t, {}, async ({ type, tick, press, requests, complete, state, capture }) => {
    await type('login')
    await tick(1000)
    assert.equal(requests.length, 0)
    assert.ok(document.querySelector('[data-search-layout]'))
    capture('typing')
    assert.doesNotMatch(document.body.textContent, /No results found/)
    await press('Enter')
    assert.equal(requests.length, 1)
    await complete()
    assert.ok(document.getElementById('task_1'))
    await type('missing')
    assert.equal(document.getElementById('task_1'), null)
    assert.equal(state().typedTasks.length, 0)
    await tick(1000)
    assert.equal(requests.length, 1)
    await press('Enter')
    await complete(requests.at(-1), [])
    assert.match(document.body.textContent, /No results found/)
    const message = [...document.querySelectorAll('span')].find((node) => node.textContent === 'No results found')
    assert.match(message.parentElement.className, /px-4 @md:px-9/)
    capture('no-results')
    await type('new draft')
    assert.doesNotMatch(document.body.textContent, /No results found/)
    assert.ok(document.querySelector('[data-search-layout]'))
    await tick(1000)
    assert.equal(requests.length, 2)
    await press('Enter')
    const pending = requests.at(-1)
    await type('changed again')
    await complete(pending)
    assert.equal(document.getElementById('task_1'), null, 'old pending searches cannot reappear for drafts')
  })
})

test('recent acceptance and URL load run search, with results aligned to the input inset', async (t) => {
  await withSearch(t, { history: ['login'] }, async ({ press, requests, complete, input, capture }) => {
    await press('Enter')
    assert.equal(input().value, 'login')
    assert.equal(requests.at(-1).body.searchQuery, 'login')
    await complete()
    const list = document.getElementById('tasks-list')
    assert.match(list.className, /px-4 @md:px-9/)
    assert.doesNotMatch(list.querySelector('li').className, /sm:px-2|border-l-4/)
    assert.doesNotMatch(list.querySelector('li > div').className, /px-4/)
    capture('results')
  })
  await withSearch(t, { query: 'from:77' }, async ({ requests, complete, tick }) => {
    assert.equal(requests.length, 1)
    assert.equal(requests[0].body.searchQuery, 'from:77')
    await complete()
    await tick(1000)
    assert.equal(requests.length, 1)
    assert.ok(document.getElementById('task_1'))
    assert.equal(document.querySelector('[data-search-layout]'), null)
  })
})

test('URL search survives flags arriving after mount and results are not mistaken for a draft', async (t) => {
  await withSearch(t, { query: 'login', flags: { [layoutFlag]: false } }, async ({ flags, render, requests, complete, state }) => {
    assert.equal(requests.length, 1)
    flags[layoutFlag] = true
    await render('login')
    await complete()
    assert.equal(state().isSearchDraft, false)
    assert.ok(document.getElementById('task_1'))
    assert.equal(document.querySelector('[data-search-layout]'), null)
  })
})

test('generic value suggestions become the right entity chip without dropping preceding text', async (t) => {
  await withSearch(t, {}, async ({ type, tick, options, requests }) => {
    for (const [query, match, canonical] of [['login mal', 'Malcolm Stern', 'login from:77'], ['login bu', 'Bug', 'login label:bug'], ['login pro', 'Product Board', 'login in:7']]) {
      await type(query)
      await tick(180)
      const option = options().find((row) => row.textContent.includes(match))
      assert.ok(option, query)
      await React.act(async () => option.click())
      assert.equal(requests.at(-1).body.searchQuery, canonical)
      // Start a fresh draft without carrying the accepted filter into the next fixture.
      await React.act(async () => document.querySelector('[aria-label^="Remove"]').click())
    }
  })
})

test('suggestions keep IME, native Shift+Tab and quoted free text safe', async (t) => {
  await withSearch(t, {}, async ({ type, tick, input, press, requests, lookups }) => {
    await type('from:mal')
    await tick(180)
    await press('Enter', { isComposing: true })
    assert.equal(requests.length, 0)
    await press('Tab', { shiftKey: true })
    assert.equal(input().value, 'from:mal')
    await press('Escape')
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    const before = lookups.length
    await type('"a mal')
    await tick(180)
    assert.equal(lookups.length, before, 'quoted free text must not trigger entity completion')
    await press('Enter')
    assert.equal(requests.at(-1).body.searchQuery, '"a mal')
  })
})

test('long value suggestions and chips retain shrinkable phone-width rows', async (t) => {
  const name = 'a'.repeat(100)
  await withSearch(t, { people: [{ id: 77, name, email: `${'a'.repeat(100)}@example.test` }] }, async ({ type, tick, selected, press, capture }) => {
    await type('from:a')
    await tick(180)
    assert.match(selected().className, /min-w-0/)
    capture('long-value')
    await press('Tab')
    assert.match(document.querySelector('[aria-label^="Remove"]').className, /min-w-0 max-w-full/)
    capture('long-chip')
  })
})

test('typing after chip removal or archive changes remains a draft until Enter', async (t) => {
  await withSearch(t, {}, async ({ type, tick, press, complete, requests, state }) => {
    await type('label:bu')
    await tick(180)
    await press('Tab')
    await complete()
    const before = requests.length
    await React.act(async () => document.querySelector('[aria-label="Remove label:Bug filter"]').click())
    await tick(1000)
    assert.equal(requests.length, before, 'removing a chip does not submit the new draft')
    assert.equal(document.getElementById('task_1'), null)
    await type('login')
    await React.act(async () => state().setIncludeArchivedResults(true))
    await tick(1000)
    assert.equal(requests.length, before, 'archive scope changes do not submit unsearched text')
    assert.doesNotMatch(document.body.textContent, /Show results for:/)
    await press('Enter')
    assert.equal(requests.length, before + 1)
    assert.equal(requests.at(-1).body.searchQuery, 'login')
    assert.equal(requests.at(-1).body.archive, null)
  })
})

const matchFlag = 'htpr-6882-search-match-highlights'
const matchTask = { taskId: 1, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 1, ticketNumber: 'HTPR-1',
  taskTitle: 'Login <script>alert(1)</script>', descriptionText: 'Login needs login help', highlight: {},
  searchMatch: { people: ['Valentin Yeo'], labels: ['Bug'], board: 'Product Board' } }

test('match results reuse inbox mention and board label pills with safe title and snippet marks', async (t) => {
  await withSearch(t, { query: 'login from:6 label:bug in:7', flags: { [matchFlag]: true } }, async ({ complete, requests, capture }) => {
    await complete(requests[0], [matchTask])
    const row = document.getElementById('task_1')
    const matches = row.querySelector('[data-search-match-highlights]')
    assert.equal(matches.querySelector('.bg-mention-highlight.text-mention-highlight').textContent, '@Valentin Yeo')
    assert.deepEqual([...matches.querySelectorAll('.label-pill')].map((pill) => pill.textContent), ['Bug', 'Product Board'])
    assert.deepEqual([...row.querySelectorAll('mark')].map((mark) => mark.textContent.toLowerCase()), ['login', 'login', 'login'])
    assert.equal(row.querySelector('script'), null)
    assert.match(row.textContent, /<script>alert\(1\)<\/script>/)
    assert.match(matches.className, /min-w-0.*overflow-hidden/)
    assert.match(matches.lastElementChild.className, /truncate/)
    assert.match(row.firstElementChild.className, /flex-col.*@md:flex/)
    capture('match-results')
  })
})

test('comment result author is an inbox pill before the safely highlighted snippet, including late matches', async (t) => {
  await withSearch(t, { query: 'login', flags: { [matchFlag]: true } }, async ({ complete, requests }) => {
    await complete(requests[0], [{ ...matchTask, commentId: 44, commentText: `${'before '.repeat(80)}Login <img src=x onerror=alert(1)>`,
      searchMatch: { commentAuthor: 'Comment Writer' } }])
    const matches = document.querySelector('[data-search-match-highlights]')
    assert.equal(matches.firstElementChild.textContent, '@Comment Writer')
    assert.equal(matches.lastElementChild.querySelector('mark').textContent, 'Login')
    assert.match(matches.lastElementChild.textContent, /^\.\.\./)
    assert.equal(matches.querySelector('img'), null)
    assert.match(matches.textContent, /<img src=x onerror=alert\(1\)>/)
  })
})

test('commenter snippet and author pill use both flags without highlighting the operator or injecting HTML', async (t) => {
  for (const commenter of [false, true]) {
    for (const highlights of [false, true]) {
      await withSearch(t, { query: 'login commenter:77', flags: { [matchFlag]: highlights, 'htpr-6880-search-commenter': commenter } }, async ({ complete, requests }) => {
        const text = 'Login commenter:77 <img src=x onerror=alert(1)>'
        await complete(requests[0], [{ ...matchTask, commentId: 44,
          commentText: text,
          searchMatch: { commentAuthor: 'Malcolm Stern' } }])
        const row = document.getElementById('task_1')
        const matches = row.querySelector('[data-search-match-highlights]')
        assert.equal(Boolean(matches), highlights)
        assert.equal(row.querySelector('img'), null)
        assert.match(row.textContent, /<img src=x onerror=alert\(1\)>/)
        if (highlights) {
          assert.equal(matches.firstElementChild.textContent, '@Malcolm Stern')
          assert.deepEqual([...matches.querySelectorAll('mark')].map((mark) => mark.textContent), commenter ? ['Login'] : ['Login', 'commenter:77'])
        }
      })
    }
  }
})

test('match flag and layout prerequisites off retain byte-identical row HTML despite match metadata', async (t) => {
  for (const disabled of [matchFlag, layoutFlag, ...prerequisites]) {
    await withSearch(t, { query: 'login', flags: { [matchFlag]: true, [disabled]: false }, baseline: true }, async ({ complete, requests, render, capture }) => {
      const { searchMatch, ...legacy } = matchTask
      await complete(requests[0], [legacy])
      const before = document.getElementById('task_1').outerHTML
      await render('login', true)
      await complete(requests.at(-1), [matchTask])
      assert.equal(document.getElementById('task_1').outerHTML, before)
      assert.equal(document.querySelector('[data-search-match-highlights]'), null)
      capture(`match-off-${disabled}`)
    })
  }
})

test('commenter tip, people email, grey completion and exact person chip reuse the layout picker', async (t) => {
  await withSearch(t, { flags: { 'htpr-6880-search-commenter': true } }, async ({ input, type, press, tick, complete, options, requests, lookups, navigations }) => {
    await React.act(async () => input().focus())
    assert.ok(options().some((row) => row.textContent === 'commenter:@HichamCommented by this person'))
    await type('comm')
    assert.equal(document.querySelector('[data-search-ghost]').textContent, 'enter:')
    await press('Tab')
    assert.equal(input().value, 'commenter:')
    await type('commenter:mal')
    await tick(180)
    assert.equal(lookups.at(-1).get('operator'), 'commenter')
    assert.ok(options().some((row) => row.textContent.includes('malstern@aol.com')))
    assert.equal(document.querySelector('[data-search-ghost]').textContent, 'colm Stern')
    await press('Tab')
    assert.equal(requests.at(-1).body.searchQuery, 'commenter:77')
    const chip = document.querySelector('[aria-label="Remove commenter:Malcolm Stern filter"]')
    assert.match(chip.textContent, /commenter:@Malcolm Stern/)
    assert.ok(chip.querySelector('.lucide-user-round'))
    await complete(requests.at(-1), [{ taskId: 1, projectId: 7, uniqueIndex: 1, projectTitle: 'Product Board', taskTitle: 'Result', commentId: 42, commentText: 'The person’s comment', highlight: {} }])
    assert.match(document.getElementById('tasks-list').textContent, /The person’s comment/)
    await React.act(async () => document.getElementById('task_1').click())
    assert.equal(navigations.at(-1), '/detail/project-7/1?commentId=comment-42')
  })
})

test('commenter is literal text without its flag or without search layout; no tip, chip or people lookup', async (t) => {
  for (const flags of [{ 'htpr-6880-search-commenter': false }, { 'htpr-6880-search-commenter': true, [layoutFlag]: false }]) {
    await withSearch(t, { flags }, async ({ input, type, tick, options, lookups }) => {
      await React.act(async () => input().focus())
      assert.ok(!options().some((row) => row.textContent.includes('commenter:')))
      await type('comm')
      assert.ok(!options().some((row) => row.textContent === 'commenter:'))
      await type('commenter:mal')
      await tick(180)
      assert.equal(input().value, 'commenter:mal')
      assert.equal(document.querySelector('[aria-label^="Remove commenter:"]'), null)
      assert.ok(!lookups.some((params) => params.get('operator') === 'commenter'))
    })
  }
})


test('commenter flag off preserves the baseline rendered HTML byte for byte', async (t) => {
  const snapshots = []
  for (const baseline of [true, false]) {
    await withSearch(t, { baseline, flags: { 'htpr-6880-search-commenter': false }, history: ['from:77 login'] }, async ({ input, type, tick, lookups }) => {
      await React.act(async () => input().focus())
      const empty = document.getElementById('root').innerHTML
      await type('commenter:mal')
      await tick(180)
      snapshots.push([empty, document.getElementById('root').innerHTML, lookups.map((params) => params.toString())])
    })
  }
  assert.deepEqual(snapshots[1], snapshots[0])
})
