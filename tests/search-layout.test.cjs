const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const React = require('react')
const { JSDOM } = require('jsdom')
const { createJiti } = require('jiti')
const root = path.resolve(__dirname, '..')

async function withSearch(t, config, check) {
  const dom = new JSDOM('<div id="root"></div>', { url: config.url ?? 'https://example.test/search' })
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
  const flags = {}
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
    source('src/hooks/useFlag.tsx', { useFlagLoaded: () => true, useFlagReady: () => config.flagsReady?.() ?? true, useFlag: (key) => (config.flagsBeforeReady && !(config.flagsReady?.() ?? true) ? config.flagsBeforeReady[key] : flags[key]) ?? false })
    source('src/lib/contexts/deviceContext.tsx', { useDeviceContext: () => false })
    const allProjects = [{ id: 7, title: 'Product Board' }]
    source('src/hooks/MultiPages/useGetAllProjectsMinimal.ts', { useGetAllProjectsMinimal: () => ({ data: config.projects?.() ?? allProjects, refetch: () => config.refetch?.() ?? Promise.resolve({ data: allProjects }) }) })
    source('src/hooks/RecoilRoot/useHypertasksRecoilStates.ts', { default: () => ({ toggleShowCommands() {} }) })
    const SearchTaskIndexAtom = {}
    source('src/lib/state.tsx', {
      useRecoilState: (atom) => [atom === SearchTaskIndexAtom ? 0 : { show: false }, () => {}],
      useSetRecoilState: () => (prompt) => prompts.push(prompt), useRecoilValue: () => false,
    })
    source('src/lib/contexts/mobileContext.tsx', { MobileViewContext: React.createContext(config.mobile ?? false) })
    source('src/components/ProviderGlobal/useGlobalUIState.ts', { useGlobalUIState: () => ({ openAIChatInterface() { aiOpened++ } }) })
    source('src/components/commands.tsx', { default: () => null })
    source('src/components/PageComponents/Kanban/HeaderComponents/AppShellRail.tsx', { default: () => null })
    source('src/styles/search.module.scss', { default: { links_modal: 'links_modal', list_container: 'list_container', list_container_pane: 'list_container_pane', links_list: 'links_list' } })
    source('src/app/search/search-autocomplete.css', {})
    source('src/store/index.ts', { inViewObjectAtom: {}, SearchTaskIndexAtom, showCommandsAtom: {}, tasksPlayListAtom: {}, aiChatPendingPromptAtom: {}, appShellRailAtom: {} })
    source('src/hooks/Search/useSearchCache.ts', { useGetSearchCache: () => ({ data: cache }) })
    source('src/lib/constants/index.ts', { default: { multipleKeys: {}, gThenKeyDelay: 500 } })
    source('src/lib/constants/APIRouteConstants.ts', { searchDocumentsRoute: '/api/search/document' })
    source('src/lib/constants/keyboard-handler.ts', { KeyCodes: { ARROW_DOWN: 40, ARROW_UP: 38, ENTER: 13, ESCAPE: 27, J: 74, K: 75, TAB: 9, FORWARD_SLASH: 191 } })
    const post = (_url, body) => new Promise((resolve) => requests.push({ body, resolve }))
    stub(require.resolve('axios'), { default: { post }, post })
    stub(require.resolve('next/navigation'), { useSearchParams: () => new URLSearchParams(dom.window.location.search), useRouter: () => ({ replace(url) { navigations.push(url) }, push(url) { navigations.push(url); if (config.browserHistory) dom.window.history.pushState(null, '', url) }, back() { navigations.push('back') } }) })
    stub(require.resolve('@tanstack/react-query'), { useQueryClient: () => ({ invalidateQueries() {}, setQueryData(_key, data) { cache.history = data.history } }) })
    const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })
    const { useSearch } = jiti(path.join(root, 'src/hooks/Search/useSearch.ts'))
    source('src/hooks/Search/useSearch.ts', { useSearch: (...args) => { state = useSearch(...args); return state } })
    const SearchComp = jiti(path.join(root, 'src/app/search/SearchComp.tsx')).default
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'))
    let counter = 0
    const render = async (query = config.query ?? '', reset = false) => React.act(async () => {
      if (reset) counter++
      reactRoot.render(React.createElement(SearchComp, { key: counter, _searchTerm: query, _includeArchived: false, currentUser: {}, askAiFullscreenEnabled: config.askAiFullscreenEnabled, serverStartedSearch: config.serverStartedSearch, searchOnce: config.searchOnce }))
    })
    await render()
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const input = () => document.getElementById('search-input')
    const type = async (value) => React.act(async () => {
      input().focus()
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input(), value)
      input().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const press = async (key, extra = {}) => React.act(async () => input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })))
    const tick = async (ms = 1000) => React.act(async () => t.mock.timers.tick(ms))
    const complete = async (request = requests.at(-1), tasks = [{ taskId: 1, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 1, taskTitle: 'Result', highlight: {} }], split = ['All']) => {
      const processedData = Array.isArray(split) ? Object.fromEntries(split.map((tab) => [tab, tab === 'All' ? tasks : tasks.filter((task) => task.projectTitle === tab)])) : split
      return React.act(async () => request.resolve({ status: 200, data: { processedData, tabs: Object.keys(processedData) } }))
    }
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

test('result Tab cycles board splits in both directions outside the input and never traps it', async (t) => {
  await withSearch(t, {}, async ({ input, type, press, complete, state, navigations, requests, dom }) => {
    await type('login')
    await press('Enter')
    const tasks = [
      { taskId: 1, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 1, taskTitle: 'Product result', highlight: {} },
      { taskId: 2, projectId: 8, projectTitle: 'Other Board', uniqueIndex: 2, taskTitle: 'Other result', highlight: {} },
    ]
    const splits = { All: tasks, 'Product Board': [tasks[0]], 'Other Board': [tasks[1]] }
    await complete(undefined, tasks, splits)
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    assert.equal(document.querySelector('[data-search-ghost]'), null)
    await React.act(async () => input().focus())
    const inside = new dom.window.KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true, cancelable: true })
    await React.act(async () => input().dispatchEvent(inside))
    assert.equal(inside.defaultPrevented, false, 'Tab inside the search box keeps normal focus movement')
    assert.equal(state().activeSplit, 0)
    for (const focused of [false]) {
      await React.act(async () => input().blur())
      for (const keyCode of [0, 9]) {
        for (const [shiftKey, indices] of [[false, [1, 2, 0]], [true, [2, 1, 0]]]) {
          for (const index of indices) {
            const event = new dom.window.KeyboardEvent('keydown', { key: 'Tab', keyCode, shiftKey, bubbles: true, cancelable: true })
            await React.act(async () => document.activeElement.dispatchEvent(event))
            assert.equal(event.defaultPrevented, true)
            assert.equal(state().activeSplit, index)
            assert.deepEqual(state().typedTasks, Object.values(splits)[index])
            assert.equal(state().selectedIndex, 0)
            assert.equal(new URL(navigations.at(-1), dom.window.location).searchParams.get('index'), String(index))
            assert.equal(document.activeElement, focused ? input() : document.body)
          }
        }
      }
    }
    assert.equal(requests.length, 1, 'cycling reuses the existing results')
  })
})

test('result Tab keeps current split state when two tabs share the same task list', async (t) => {
  await withSearch(t, { query: 'login' }, async ({ complete, state, dom }) => {
    const tasks = [{ taskId: 1, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 1, taskTitle: 'Result', highlight: {} }]
    await complete(undefined, tasks, { All: tasks, 'Product Board': tasks })
    await React.act(async () => document.activeElement.blur())
    for (const index of [1, 0, 1, 0]) {
      await React.act(async () => document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true, cancelable: true })))
      assert.equal(state().activeSplit, index)
    }
  })
})

test('result Tab leaves modifiers, composition and other text fields alone; draft suggestions retain Tab', async (t) => {
  await withSearch(t, { query: 'login' }, async ({ input, type, tick, press, complete, state, selected, dom }) => {
    const tasks = [{ taskId: 1, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 1, taskTitle: 'Result', highlight: {} }]
    await complete(undefined, tasks, { All: tasks, 'Product Board': tasks })
    for (const focused of [true, false]) {
      await React.act(async () => focused ? input().focus() : input().blur())
      for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
        const event = new dom.window.KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true, cancelable: true, ...extra })
        await React.act(async () => document.activeElement.dispatchEvent(event))
        assert.equal(event.defaultPrevented, false)
        assert.equal(state().activeSplit, 0)
      }
    }
    const otherInput = document.createElement('input')
    document.body.append(otherInput)
    otherInput.focus()
    const event = new dom.window.KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true, cancelable: true })
    await React.act(async () => otherInput.dispatchEvent(event))
    assert.equal(event.defaultPrevented, false)
    assert.equal(state().activeSplit, 0)
    await React.act(async () => input().focus())
    await type('from:mal')
    await tick(180)
    assert.match(selected().textContent, /Malcolm Stern/)
    assert.equal(document.querySelector('[data-search-ghost]').textContent, 'colm Stern')
    await press('Tab', { keyCode: 9, shiftKey: true })
    assert.equal(input().value, 'from:mal')
    await press('Tab', { keyCode: 9 })
    assert.ok(document.querySelector('[aria-label="Remove from:Malcolm Stern filter"]'))
    assert.equal(state().activeSplit, 0, 'acceptance does not cycle the old splits')
  })
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
    assert.equal(tipsHeading.nextElementSibling.children.length, 11)
    assert.match(tipsHeading.nextElementSibling.className, /grid-cols-1.*@md:grid-cols-2/)
    assert.ok(tipsHeading.nextElementSibling.lastElementChild.textContent.includes('Has an attachment'))
    assert.ok(options().slice(2).every((row) => row.querySelector('strong')))
    assert.equal(options()[0].getAttribute('aria-selected'), 'true')
    capture('empty')
  })
})

test('empty tips keep j/k typing native while arrows, Tab/Enter, Escape and first-row selection still work', async (t) => {
  await withSearch(t, {}, async ({ input, press, selected, requests, dom }) => {
    assert.match(selected().textContent, /^from:/)
    for (const [key, keyCode] of [['j', 74], ['k', 75]]) {
      let accepted
      await React.act(async () => { accepted = input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true })) })
      assert.equal(accepted, true, `${key} keeps its native typing behavior`)
      assert.match(selected().textContent, /^from:/)
      assert.equal(document.activeElement, input())
    }
    await press('ArrowDown')
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

test('layout suggestions and selected row survive input/window blur, return focus and pointer leave', async (t) => {
  await withSearch(t, {}, async ({ input, type, tick, press, selected, options, lookups, dom }) => {
    for (const query of ['', 'board:', 'from:mal']) {
      await type(query)
      await tick(180)
      await press(query === 'board:' ? 'ArrowUp' : 'ArrowDown')
      const list = document.querySelector('[data-search-layout]')
      const html = list.outerHTML
      const active = input().getAttribute('aria-activedescendant')
      const before = lookups.length
      await React.act(async () => {
        selected().dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: null }))
        input().blur()
        dom.window.dispatchEvent(new dom.window.Event('blur'))
      })
      await tick(200)
      assert.equal(input().getAttribute('aria-expanded'), 'true')
      assert.equal(document.querySelector('[data-search-layout]'), list)
      assert.equal(list.outerHTML, html)
      assert.equal(input().getAttribute('aria-activedescendant'), active)
      await React.act(async () => {
        dom.window.dispatchEvent(new dom.window.Event('focus'))
        input().focus()
      })
      assert.equal(list.outerHTML, html)
      assert.equal(input().getAttribute('aria-activedescendant'), active)
      assert.equal(lookups.length, before, 'blur and refocus must not restart candidate lookup')
      assert.ok(options().includes(selected()))
      const otherInput = document.createElement('input')
      document.body.append(otherInput)
      await React.act(async () => otherInput.focus())
      assert.equal(list.outerHTML, html, 'keyboard focus elsewhere on the page must retain suggestions')
      assert.equal(input().getAttribute('aria-activedescendant'), active)
      await React.act(async () => input().focus())
      assert.equal(list.outerHTML, html)
      otherInput.remove()
    }
  })
})

test('layout outside clicks dismiss suggestions, inside clicks retain them and refocus reopens them', async (t) => {
  await withSearch(t, {}, async ({ input, type, tick, selected, dom }) => {
    await type('board:')
    await tick(180)
    const list = document.querySelector('[data-search-layout]')
    await React.act(async () => list.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })))
    assert.equal(input().getAttribute('aria-expanded'), 'true')
    await React.act(async () => document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })))
    assert.equal(document.querySelector('[data-search-layout]'), null)
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    await React.act(async () => { input().blur(); input().focus() })
    await tick(180)
    assert.match(selected().textContent, /Product Board/)
  })
})

test('layout explicit Escape, value acceptance and search submission still dismiss suggestions', async (t) => {
  await withSearch(t, {}, async ({ input, type, tick, press, requests }) => {
    await type('board:')
    await tick(180)
    await press('Escape')
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    assert.equal(requests.length, 0)
    await React.act(async () => input().click())
    await tick(180)
    await press('Tab')
    assert.equal(document.querySelector('[data-search-layout]'), null)
    assert.equal(requests.at(-1).body.searchQuery, 'board:7')
    await type('plain search')
    await press('Enter')
    assert.equal(document.querySelector('[data-search-layout]'), null)
    assert.equal(requests.at(-1).body.searchQuery, 'board:7 plain search')
  })
})

test('result pointer leave retains layout row focus and selection', async (t) => {
  await withSearch(t, { query: 'login' }, async ({ complete, state, tick, dom }) => {
    await complete()
    const row = document.getElementById('task_1')
    row.tabIndex = -1
    await React.act(async () => {
      row.focus()
      row.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }))
      row.dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: null }))
    })
    const index = state().selectedIndex
    await tick(100)
    assert.equal(document.activeElement === row, true)
    assert.equal(state().selectedIndex, index)
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

test('Ask AI fullscreen flag sends click and keyboard selections to /chat and Back restores the draft query', async (t) => {
  const flag = 'htpr-6936-ask-ai-fullscreen'
  for (const keyboard of [false, true]) {
    await withSearch(t, { flags: { [flag]: true }, askAiFullscreenEnabled: true, browserHistory: true, url: 'https://example.test/search?fromProject=7&includeArchived=1&index=2#results' }, async ({ type, press, options, prompts, aiOpened, requests, navigations, dom, render, input, complete, state }) => {
      const question = 'Where is A&B? 日本語 #work'
      await type(question)
      if (keyboard) {
        await press('ArrowUp')
        await press('Tab')
      } else {
        await React.act(async () => options()[0].click())
      }
      assert.deepEqual(prompts, [{ query: question, fullScreen: true }])
      assert.equal(aiOpened(), 0)
      assert.equal(requests.length, 0, 'Ask AI does not submit task search')
      const chatUrl = new URL(navigations.at(-1), dom.window.location)
      assert.equal(chatUrl.pathname, '/chat')
      const returnUrl = new URL(chatUrl.searchParams.get('return_to'), dom.window.location)
      assert.equal(returnUrl.searchParams.get('searchTerm'), question)
      assert.equal(returnUrl.searchParams.get('fromProject'), '7')
      assert.equal(returnUrl.searchParams.get('includeArchived'), '1')
      assert.equal(returnUrl.searchParams.get('index'), '2')
      assert.equal(returnUrl.hash, '#results')
      t.mock.timers.reset()
      await new Promise((resolve) => {
        dom.window.addEventListener('popstate', resolve, { once: true })
        dom.window.history.back()
      })
      assert.equal(dom.window.location.href, returnUrl.href)
      await render('', true)
      assert.equal(input().value, question)
      assert.equal(requests.length, 1)
      assert.equal(requests[0].body.searchQuery, question)
      await complete()
      assert.equal(state().isSearchDraft, false)
      assert.equal(document.getElementById('task_1').textContent.includes('Result'), true)
    })
  }
})

test('Ask AI fullscreen requires both the server gate and client flag; off retains the exact string/panel handoff', async (t) => {
  const flag = 'htpr-6936-ask-ai-fullscreen'
  for (const [client, server] of [[false, false], [false, true], [true, false]]) {
    await withSearch(t, { flags: { [flag]: client }, askAiFullscreenEnabled: server }, async ({ type, options, prompts, aiOpened, navigations, requests, dom }) => {
      await type('help me find work')
      await React.act(async () => options()[0].click())
      assert.deepEqual(prompts, ['help me find work'])
      assert.equal(aiOpened(), 1)
      assert.equal(navigations.length, 0)
      assert.equal(requests.length, 0)
      assert.equal(dom.window.location.href, 'https://example.test/search')
    })
  }
})

test('fullscreen restoration requires both gates; off keeps the production server-prop search query', async (t) => {
  const flag = 'htpr-6936-ask-ai-fullscreen'
  for (const [client, server] of [[false, false], [false, true], [true, false]]) {
    await withSearch(t, { flags: { [flag]: client }, askAiFullscreenEnabled: server, url: 'https://example.test/search?searchTerm=URL+question', query: 'Production query' }, async ({ input, requests, complete, render, state }) => {
      assert.equal(input().value, 'Production query')
      assert.equal(requests[0].body.searchQuery, 'Production query')
      await complete()
      assert.equal(state().isSearchDraft, false)
      await render('', true)
      assert.equal(input().value, '')
      assert.equal(requests.length, 1, 'flag off does not restore from client URL params')
    })
  }
})

test('ordinary Enter still submits task search with the fullscreen flag on or off', async (t) => {
  const flag = 'htpr-6936-ask-ai-fullscreen'
  for (const enabled of [true, false]) {
    await withSearch(t, { flags: { [flag]: enabled }, askAiFullscreenEnabled: enabled }, async ({ type, press, prompts, aiOpened, requests, navigations }) => {
      await type('find my work')
      await press('Enter')
      assert.equal(requests.at(-1).body.searchQuery, 'find my work')
      assert.deepEqual(prompts, [])
      assert.equal(aiOpened(), 0)
      assert.ok(navigations.every((url) => url.startsWith('/search?')))
    })
  }
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

test('Enter blurs immediately, j/k and arrows select results, Enter opens, and slash or click restores editing', async (t) => {
  await withSearch(t, {}, async ({ input, type, press, requests, complete, state, navigations, dom }) => {
    assert.equal(document.activeElement, input(), 'empty search starts focused')
    await type('label:bug login')
    await press('Enter', { keyCode: 13 })
    assert.equal(requests.length, 1)
    assert.equal(document.activeElement, document.body, 'submission blurs before results arrive')
    const tasks = [1, 2, 3].map((id) => ({ taskId: id, projectId: 7, uniqueIndex: id, projectTitle: 'Product Board', taskTitle: `Login ${id}`, highlight: {} }))
    await complete(requests[0], tasks)
    const resultKey = async (key, keyCode) => React.act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true })))
    const query = state().inputValue
    const start = state().selectedIndex
    await resultKey('j', 74)
    assert.equal(state().selectedIndex, start + 1)
    await resultKey('j', 74)
    assert.equal(state().selectedIndex, 2)
    await resultKey('k', 75)
    assert.equal(state().selectedIndex, 1)
    await resultKey('ArrowUp', 38)
    assert.equal(state().selectedIndex, 0)
    await resultKey('ArrowDown', 40)
    assert.equal(state().selectedIndex, 1)
    assert.equal(state().inputValue, query)
    await resultKey('Enter', 13)
    assert.equal(navigations.at(-1), '/detail/project-7/2')
    const chip = document.querySelector('[aria-label="Remove label:Bug filter"]')
    assert.ok(chip)
    input().setSelectionRange(0, 0)
    await resultKey('/', 191)
    assert.equal(document.activeElement, input())
    assert.equal(input().selectionStart, input().value.length)
    assert.equal(input().selectionEnd, input().value.length)
    assert.equal(document.querySelector('[aria-label="Remove label:Bug filter"]'), chip)
    for (const [key, keyCode] of [['j', 74], ['k', 75]]) {
      let accepted
      await React.act(async () => { accepted = input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true })) })
      assert.equal(accepted, true, `${key} keeps its native typing behavior`)
      assert.equal(document.activeElement, input())
      assert.equal(state().selectedIndex, null)
    }
    await type(`${input().value}jk`)
    assert.equal(state().inputValue, 'label:bug loginjk')
    await press('Enter', { keyCode: 13 })
    await React.act(async () => input().parentElement.parentElement.click())
    assert.equal(document.activeElement, input())
    assert.ok(document.querySelector('[aria-label="Remove label:Bug filter"]'))
    await complete(requests.at(-1), tasks)
    assert.equal(document.activeElement, input(), 'delayed results do not steal restored editing focus')
  })
})

for (const [key, keyCode] of [['Enter', 13], ['Tab', 9]]) {
  test(`${key} suggestion acceptance keeps focus for operators, values and recents`, async (t) => {
    await withSearch(t, {}, async ({ input, type, tick, press, requests, complete }) => {
      await type('fr')
      await press(key, { keyCode })
      assert.equal(input().value, 'from:')
      assert.equal(requests.length, 0)
      assert.equal(document.activeElement, input())
      await type('from:mal')
      await tick(180)
      await press(key, { keyCode })
      assert.equal(requests.at(-1).body.searchQuery, 'from:77')
      assert.ok(document.activeElement === input(), 'accepting a value keeps writing focus')
      await complete()
      assert.ok(document.activeElement === input(), 'accepted value results do not steal focus')
    })
    await withSearch(t, { history: ['login'] }, async ({ input, press, requests, complete }) => {
      await press(key, { keyCode })
      assert.equal(input().value, 'login')
      assert.equal(requests.at(-1).body.searchQuery, 'login')
      assert.ok(document.activeElement === input(), 'accepting a recent search keeps writing focus')
      await complete()
      assert.ok(document.activeElement === input(), 'recent search results do not steal focus')
    })
  })
}

for (const operator of ['commenter', 'assignee', 'label']) {
  for (const [freeText, acceptKey] of [['', 'Enter'], ['', 'Tab'], ['qzxw6913', 'Enter'], ['qzxw6913', 'Tab']]) {
    test(`chip Enter submits and releases focus: ${operator}, text ${Boolean(freeText)}, accepted with ${acceptKey}`, async (t) => {
      await withSearch(t, {}, async ({ input, type, tick, press, selected, options, requests, prompts, aiOpened, complete, state, dom }) => {
        await type(`${operator}:${operator === 'commenter' ? '@' : ''}`)
        await tick(180)
        assert.match(selected().textContent, operator === 'label' ? /Bug/ : /Malcolm Stern/)
        await press(acceptKey, { keyCode: acceptKey === 'Enter' ? 13 : 9 })
        const chip = document.querySelector('[aria-label^="Remove "]')
        assert.ok(chip, 'highlighted value is accepted as a chip')
        assert.equal(input().value, '')
        assert.ok(document.activeElement === input(), 'accepting a highlighted suggestion keeps writing focus')
        const chipQuery = `${operator}:${operator === 'label' ? 'bug' : '77'}`
        assert.equal(requests.at(-1).body.searchQuery, chipQuery)
        await complete()
        assert.ok(document.activeElement === input(), 'accepted suggestion results do not steal focus')
        if (freeText) {
          await type(freeText)
          await tick(180)
          assert.equal(options().length, 1, 'completed query has only Ask AI, not a completion')
          await press('ArrowUp')
          assert.match(selected().textContent, /^Ask AI/)
        }
        const before = requests.length
        await press('Enter', { keyCode: 13 })
        const query = [chipQuery, freeText].filter(Boolean).join(' ')
        assert.equal(requests.length, before + 1, 'Enter submits instead of handing a complete query to AI')
        assert.equal(requests.at(-1).body.searchQuery, query)
        assert.ok(document.activeElement === document.body, 'Enter releases search input focus')
        assert.equal(input().getAttribute('aria-expanded'), 'false')
        assert.deepEqual(prompts, [])
        assert.equal(aiOpened(), 0)
        assert.ok(document.querySelector('[aria-label^="Remove "]') === chip, 'submission retains the committed chip')
        await complete(undefined, [1, 2, 3].map((taskId) => ({ taskId, projectId: 7, uniqueIndex: taskId, projectTitle: 'Product Board', taskTitle: 'Result', highlight: {} })))
        const resultKey = async (key, keyCode) => React.act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true })))
        for (const [key, code, index] of [['j', 74, 1], ['j', 74, 2], ['k', 75, 1]]) {
          await resultKey(key, code)
          assert.equal(state().selectedIndex, index)
          assert.equal(state().inputValue, query)
          assert.equal(input().value, freeText)
        }
        await resultKey('/', 191)
        assert.ok(document.activeElement === input(), 'refocus restores editing')
        await React.act(async () => input().blur())
        await React.act(async () => input().parentElement.parentElement.click())
        assert.ok(document.activeElement === input(), 'refocus restores editing')
      })
    })
  }
}

test('lone Ask AI Enter submits plain text even when the row is explicitly highlighted; clicking still asks AI', async (t) => {
  await withSearch(t, {}, async ({ type, tick, press, options, requests, input, prompts }) => {
    await type('qzxw6913')
    await tick(180)
    assert.equal(options().length, 1)
    await press('ArrowUp')
    await press('Enter', { keyCode: 13 })
    assert.equal(requests.at(-1)?.body.searchQuery, 'qzxw6913')
    assert.ok(document.activeElement === document.body, 'Enter releases search input focus')
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    assert.deepEqual(prompts, [])
    await type('another complete query')
    await React.act(async () => options()[0].click())
    assert.deepEqual(prompts, ['another complete query'])
  })
})

test('URL results retain result navigation focus, and explicit Enter releases it', async (t) => {
  await withSearch(t, { query: 'login' }, async ({ input, complete }) => {
    await complete()
    assert.equal(document.activeElement, document.body)
  })
  await withSearch(t, {}, async ({ input }) => {
    assert.ok(document.activeElement === input(), 'refocus restores editing')
  })
  await withSearch(t, { query: 'login' }, async ({ input, complete }) => {
    assert.equal(document.activeElement, document.body, 'URL search starts in result navigation mode')
    await React.act(async () => input().focus())
    await complete()
    assert.equal(document.activeElement, input(), 'URL results do not steal restored editing focus')
  })
  await withSearch(t, {}, async ({ input, type, press, complete }) => {
    await type('login')
    await press('Enter', { keyCode: 13 })
    assert.ok(document.activeElement === document.body, 'Enter releases search input focus')
    await complete()
    assert.ok(document.activeElement === document.body, 'Enter releases search input focus')
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

test('URL search survives a rerender and results are not mistaken for a draft', async (t) => {
  await withSearch(t, { query: 'login' }, async ({ render, requests, complete, state }) => {
    assert.equal(requests.length, 1)
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
      await React.act(async () => document.querySelector('[aria-label^="Remove"]').click())
    }
  })
})

for (const [query, operator, leftover] of [
  ['from valentin', 'from', ''],
  ['by valentin', 'from', ''],
  ['created by valentin', 'from', ''],
  ['assigned to valentin', 'assignee', ''],
  ['assignee valentin', 'assignee', ''],
  ['commented by valentin', 'commenter', ''],
  ['commenter valentin', 'commenter', ''],
  ['bug from valentin', 'from', 'bug'],
  ['bug assigned to valentin', 'assignee', 'bug'],
  ['bug valentin', 'from', 'bug'],
  ['platform valentin', 'from', 'platform'],
  ['-from valentin', 'from', ''],
]) {
  test(`HTPR-6935 Enter absorbs only recognised operator phrases: ${query}`, async (t) => {
    await withSearch(t, { people: [{ id: 6, name: 'Valentin Yeo', email: 'valentin@example.test' }] }, async ({ type, tick, selected, press, input, requests }) => {
      await type(query)
      await tick(180)
      assert.match(selected().textContent, /Valentin Yeo/)
      await press('Enter')
      const canonical = `${query.startsWith('-') ? '-' : ''}${operator}:6`
      assert.equal(requests.at(-1).body.searchQuery, [leftover, canonical].filter(Boolean).join(' '))
      assert.equal(input().value, leftover)
      const chip = document.querySelector(`[aria-label="Remove ${operator}:Valentin Yeo filter"]`)
      assert.ok(chip)
      assert.equal(chip.textContent.startsWith('-'), query.startsWith('-'))
    })
  })
}

for (const [query, operator, canonical] of [['in pro', 'in', 'in:7'], ['board pro', 'board', 'board:7'], ['label bu', 'label', 'label:bug']]) {
  test(`HTPR-6935 Tab absorbs entity operator words: ${query}`, async (t) => {
    await withSearch(t, {}, async ({ type, tick, press, input, lookups, requests }) => {
      await type(query)
      await tick(180)
      assert.equal(lookups.at(-1).get('operator'), operator)
      await press('Tab')
      assert.equal(requests.at(-1).body.searchQuery, canonical)
      assert.equal(input().value, '')
    })
  })
}

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

const matchTask = { taskId: 1, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 1, ticketNumber: 'HTPR-1',
  taskTitle: 'Login <script>alert(1)</script>', descriptionText: 'Login needs login help', highlight: {},
  searchMatch: { people: ['Valentin Yeo'], labels: ['Bug'], board: 'Product Board' } }

test('match results reuse inbox mention and board label pills with safe title and snippet marks', async (t) => {
  await withSearch(t, { query: 'login from:6 label:bug in:7' }, async ({ complete, requests, capture }) => {
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
  await withSearch(t, { query: 'login' }, async ({ complete, requests }) => {
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

test('permanent commenter highlights omit the operator without injecting HTML', async (t) => {
  await withSearch(t, { query: 'login commenter:77' }, async ({ complete, requests }) => {
    const text = 'Login commenter:77 <img src=x onerror=alert(1)>'
    await complete(requests[0], [{ ...matchTask, commentId: 44,
      commentText: text,
      searchMatch: { commentAuthor: 'Malcolm Stern' } }])
    const row = document.getElementById('task_1')
    const matches = row.querySelector('[data-search-match-highlights]')
    assert.ok(matches)
    assert.equal(row.querySelector('img'), null)
    assert.match(row.textContent, /<img src=x onerror=alert\(1\)>/)
    assert.equal(matches.firstElementChild.textContent, '@Malcolm Stern')
    assert.deepEqual([...matches.querySelectorAll('mark')].map((mark) => mark.textContent), ['Login'])
  })
})

test('commenter tip, people email, grey completion and exact person chip reuse the layout picker', async (t) => {
  await withSearch(t, {}, async ({ input, type, press, tick, complete, options, requests, lookups, navigations }) => {
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

test('one-board results always hide the tab rows; two boards keep working tabs on desktop and phone', async (t) => {
  const tasks = [{ taskId: 1, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 1, taskTitle: 'Result', highlight: {} }]
  const both = [...tasks, { taskId: 2, projectId: 8, projectTitle: 'Other Board', uniqueIndex: 2, taskTitle: 'Second', highlight: {} }]
  for (const mobile of [false, true]) {
    await withSearch(t, { query: 'login', mobile }, async ({ complete, render }) => {
      for (const tabs of [['All'], ['All', 'Product Board']]) {
        await complete(undefined, tasks, tabs)
        assert.equal(document.querySelector('.footer_tags, .inbox_footer'), null)
        assert.ok(document.getElementById('task_1'))
        await render('login', true)
      }
      await complete(undefined, both, ['All', 'Product Board', 'Other Board'])
      const labels = [...document.querySelectorAll('span.footer_tags')]
      assert.deepEqual([...new Set(labels.map((node) => node.textContent))], ['All', 'Product Board', 'Other Board'])
      await React.act(async () => labels.find((node) => node.textContent === 'Other Board').parentElement.parentElement.click())
      assert.equal(document.getElementById('task_1'), null)
      assert.ok(document.getElementById('task_2'))
    })
  }
})

test('one-board results keep open and archived split tabs', async (t) => {
  await withSearch(t, { query: 'login' }, async ({ complete }) => {
    const tasks = [
      { taskId: 1, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 1, taskTitle: 'Open result', highlight: {}, status: 'Normal' },
      { taskId: 2, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 2, taskTitle: 'Archived result', highlight: {}, status: 'Archive' },
    ]
    await complete(undefined, tasks, { All: tasks, Open: [tasks[0]], Archived: [tasks[1]], 'Product Board': tasks })
    const labels = [...document.querySelectorAll('span.footer_tags')]
    assert.deepEqual([...new Set(labels.map((node) => node.textContent))], ['All', 'Open', 'Archived', 'Product Board'])
    await React.act(async () => labels.find((node) => node.textContent === 'Archived').parentElement.parentElement.click())
    assert.equal(document.getElementById('task_1'), null)
    assert.ok(document.getElementById('task_2'))
  })
})

test('Escape closes retained layout suggestions after focus moved elsewhere, keeping the query', async (t) => {
  await withSearch(t, {}, async ({ input, type, tick, dom }) => {
    await type('board:')
    await tick(180)
    assert.equal(input().getAttribute('aria-expanded'), 'true')
    const otherInput = document.createElement('input')
    document.body.append(otherInput)
    await React.act(async () => otherInput.focus())
    assert.equal(input().getAttribute('aria-expanded'), 'true')
    const escape = new dom.window.KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true })
    await React.act(async () => otherInput.dispatchEvent(escape))
    assert.equal(input().getAttribute('aria-expanded'), 'false')
    assert.equal(escape.defaultPrevented, true)
    assert.equal(input().value, 'board:', 'Escape closes the list without clearing the query')
    otherInput.remove()
  })
})

test('layout rows share the inbox highlight without changing content insets on desktop and phone', async (t) => {
  for (const mobile of [false, true]) {
    await withSearch(t, { mobile, history: ['login'] }, async ({ options, selected, type, tick, press, complete, capture, state }) => {
      const assertRow = (row) => {
        assert.ok(row.hasAttribute('data-search-layout-row'))
        assert.doesNotMatch(row.className, /rounded-sm|bg-active-elementBg|border-l-4/)
      }
      options().forEach(assertRow)
      assert.match(selected().textContent, /login/)
      assert.match(document.querySelector('[data-search-layout]').parentElement.className, /px-4 @md:px-9/)
      await press('ArrowDown')
      assert.match(selected().textContent, /^from:/)
      await press('ArrowDown')
      assert.match(selected().textContent, /^commenter:/)
      assert.ok(selected().parentElement.hasAttribute('data-search-layout-tips'))
      capture(mobile ? 'highlight-phone-tips' : 'highlight-desktop-tips')
      await type('from:mal')
      await tick(180)
      options().forEach(assertRow)
      assert.match(selected().textContent, /Malcolm Stern/)
      await press('ArrowUp')
      assert.match(selected().textContent, /^Ask AI/)
      capture(mobile ? 'highlight-phone-ai' : 'highlight-desktop-ai')
      await type('login')
      await press('Enter')
      await complete(undefined, [1, 2].map((taskId) => ({ taskId, projectId: 7, taskTitle: 'login', highlight: {} })))
      const rows = [...document.querySelectorAll('#tasks-list > li')]
      rows.forEach(assertRow)
      assert.equal(rows[0].dataset.selected, 'true')
      assert.equal(rows[1].dataset.selected, 'false')
      assert.match(rows[0].parentElement.className, /px-4 @md:px-9/)
      assert.doesNotMatch(rows[0].firstElementChild.className, /px-4/)
      const content = rows.map((row) => row.innerHTML)
      await React.act(async () => state().setSelectedIndex(1))
      assert.equal(rows[0].dataset.selected, 'false')
      assert.equal(rows[1].dataset.selected, 'true')
      assert.deepEqual(rows.map((row) => row.innerHTML), content)
      await React.act(async () => state().setSelectedIndex(null))
      assert.ok(rows.every((row) => row.dataset.selected === 'false'))
      await React.act(async () => state().setSelectedIndex(0))
      capture(mobile ? 'highlight-phone-results' : 'highlight-desktop-results')
    })
  }
})

test('shared highlight uses inbox theme tokens and extends behind both tip columns', () => {
  const css = require('postcss').parse(fs.readFileSync(path.join(root, 'src/app/search/search-autocomplete.css'), 'utf8'))
  const rule = (selector) => {
    let found
    css.walkRules(selector, (node) => { found = node })
    assert.ok(found, selector)
    return Object.fromEntries(found.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]))
  }
  const highlight = rule('[data-search-layout-row]:is([data-selected="true"], [aria-selected="true"])::before,\nbutton[data-search-layout-row]:hover::before')
  assert.equal(highlight.position, 'absolute')
  assert.equal(highlight['inset-block'], '0')
  assert.equal(highlight.left, 'var(--search-row-left, calc(-1 * var(--search-row-gutter)))')
  assert.equal(highlight.right, 'var(--search-row-right, calc(-1 * var(--search-row-gutter)))')
  assert.equal(highlight['background-color'], 'var(--active-elementBg)')
  assert.equal(highlight['border-left'], '4px solid var(--border-active)')
  assert.equal(highlight['pointer-events'], 'none')
  assert.equal(rule('[data-search-layout-row] > *')['z-index'], '1')
  const gutters = []
  css.walkDecls('--search-row-gutter', (node) => gutters.push([node.value, node.parent.parent.params]))
  const bootstrap = fs.readFileSync(require.resolve('bootstrap/dist/css/bootstrap.css'), 'utf8')
  assert.match(bootstrap, /\.px-4 \{\s*padding-right: 1\.5rem !important;\s*padding-left: 1\.5rem !important;/)
  assert.deepEqual(gutters, [['1.5rem', undefined]])
  assert.equal(rule('[data-search-layout-tips] > [data-search-layout-row]:nth-child(odd)')['--search-row-right'], 'calc(-100% - 1.5rem - var(--search-row-gutter))')
  assert.equal(rule('[data-search-layout-tips] > [data-search-layout-row]:nth-child(even)')['--search-row-left'], 'calc(-100% - 1.5rem - var(--search-row-gutter))')
  for (const theme of ['light', 'dark']) {
    const tokens = require('postcss').parse(fs.readFileSync(path.join(root, `src/styles/tailwindThemes/${theme}.css`), 'utf8'))
    for (const token of ['--active-elementBg', '--border-active']) {
      const values = []
      tokens.walkDecls(token, (node) => values.push(node.value))
      assert.ok(values.length && values.every(Boolean), `${theme} defines ${token}`)
    }
  }
})

test('phone layout keeps board tabs in scrollable flow under the search input and selecting a board filters results', async (t) => {
  await withSearch(t, {}, async ({ input, type, press, complete, state, dom }) => {
    Object.defineProperties(dom.window, { innerWidth: { value: 390 }, innerHeight: { value: 844 } })
    await type('login')
    await press('Enter')
    const tasks = [
      { taskId: 1, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 1, taskTitle: 'Result', highlight: {} },
      { taskId: 2, projectId: 8, projectTitle: 'Other Board', uniqueIndex: 2, taskTitle: 'Second', highlight: {} },
    ]
    await complete(undefined, tasks, ['All', 'Product Board', 'Other Board'])
    const labels = [...document.querySelectorAll('span.footer_tags')]
    assert.deepEqual(labels.map((node) => node.textContent), ['All', 'Product Board', 'Other Board'])
    const row = labels[0].parentElement.parentElement.parentElement
    const scroller = row.parentElement
    assert.ok(input().compareDocumentPosition(scroller) & 4, 'tabs follow the search input')
    assert.equal(scroller.nextElementSibling, document.getElementById('tasks-list'), 'tabs immediately precede results')
    assert.ok(scroller.classList.contains('overflow-x-auto'))
    assert.ok(!scroller.classList.contains('hidden'), 'phone row is visible')
    assert.equal(document.querySelector('.inbox_footer, .inbox_title'), null, 'tabs avoid fixed footer CSS')
    assert.ok(row.classList.contains('[flex-wrap:nowrap]'))
    assert.ok(!row.classList.contains('flex-wrap') && !row.classList.contains('flex-nowrap'))
    assert.ok(row.classList.contains('md:[flex-wrap:wrap]'), 'desktop wrapping is preserved')
    assert.ok(row.classList.contains('min-h-[44px]'), 'phone tabs retain a tappable height')
    await React.act(async () => labels[2].parentElement.parentElement.click())
    assert.equal(state().activeSplit, 2)
    assert.equal(document.getElementById('task_1'), null)
    assert.ok(document.getElementById('task_2'))
  })
})

const serverTasks = [
  { taskId: 1, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 1, taskTitle: 'Result', highlight: {}, status: 'Normal' },
  { taskId: 2, projectId: 7, projectTitle: 'Product Board', uniqueIndex: 2, taskTitle: 'Second result', highlight: {}, status: 'Normal' },
]
const serverSearch = (overrides = {}) => ({
  searchQuery: 'Result', includeArchived: false, fromProject: null, projectIds: [7], status: 200,
  data: { processedData: { All: serverTasks, 'Product Board': serverTasks }, tabs: ['All', 'Product Board'] }, ...overrides,
})
const flush = () => React.act(async () => { await new Promise((resolve) => setImmediate(resolve)) })

async function searchPageHtml(t, config, run) {
  let html
  await withSearch(t, { query: 'Result', ...config }, async (tools) => {
    await run(tools)
    html = document.getElementById('root').innerHTML
  })
  return html
}

test('HTPR-7501 a server-started search shows the same page as the page search, without a search request', async (t) => {
  const today = await searchPageHtml(t, {}, async ({ requests, complete }) => {
    assert.equal(requests.length, 1)
    assert.deepEqual(requests[0].body, { projectIds: [7], searchQuery: 'Result', archive: 'Normal', contextProjectId: null })
    await complete(requests[0], serverTasks, ['All', 'Product Board'])
  })
  let projects = []
  const started = await searchPageHtml(t, { projects: () => projects, serverStartedSearch: Promise.resolve(serverSearch()) }, async ({ requests, render }) => {
    await flush()
    assert.equal(requests.length, 0, 'no search request while the board list is still loading')
    projects = [{ id: 7, title: 'Product Board' }]
    await render('Result')
    await flush()
    assert.equal(requests.length, 0, 'the board list arriving does not search again')
  })
  assert.ok(today.includes('id="task_2"'), 'both results are on the page')
  assert.equal(started, today)
})

for (const [name, started] of [
  ['failed', Promise.resolve(null)],
  ['rejected by the API', Promise.resolve(serverSearch({ status: 403, data: { message: 'Project access denied' } }))],
  ['for another query', Promise.resolve(serverSearch({ searchQuery: 'Other' }))],
  ['for archived results', Promise.resolve(serverSearch({ includeArchived: true }))],
]) {
  test(`HTPR-7501 a server search that is ${name} falls back to the page search`, async (t) => {
    let projects = []
    await withSearch(t, { query: 'Result', projects: () => projects, serverStartedSearch: started }, async ({ render, requests, complete }) => {
      await flush()
      assert.equal(document.getElementById('task_2'), null)
      assert.equal(requests.length, 0)
      projects = [{ id: 7, title: 'Product Board' }]
      await render('Result')
      assert.equal(requests.length, 1)
      assert.deepEqual(requests[0].body, { projectIds: [7], searchQuery: 'Result', archive: 'Normal', contextProjectId: null })
      await complete(requests[0], serverTasks, ['All', 'Product Board'])
      assert.ok(document.getElementById('task_2'))
    })
  })
}

for (const [name, result, requestCount] of [['for the same boards', serverSearch(), 0], ['that failed', null, 1]]) {
  test(`HTPR-7501 the board list arriving before a server result ${name} waits for it once`, async (t) => {
    let resolveServer
    let projects = []
    await withSearch(t, { query: 'Result', projects: () => projects, serverStartedSearch: new Promise((resolve) => { resolveServer = resolve }) }, async ({ render, requests, complete }) => {
      await flush()
      projects = [{ id: 7, title: 'Product Board' }]
      await render('Result')
      assert.equal(requests.length, 0, 'no request while the server result is on its way')
      await React.act(async () => resolveServer(result))
      await flush()
      assert.equal(requests.length, requestCount)
      if (requestCount) await complete(requests[0], serverTasks, ['All', 'Product Board'])
      assert.ok(document.getElementById('task_2'))
    })
  })
}

test('HTPR-7501 with the board list already loaded, a server result for the same boards replaces the page request', async (t) => {
  const today = await searchPageHtml(t, {}, async ({ requests, complete }) => complete(requests[0], serverTasks, ['All', 'Product Board']))
  const started = await searchPageHtml(t, { serverStartedSearch: Promise.resolve(serverSearch()) }, async ({ requests }) => {
    await flush()
    assert.equal(requests.length, 0)
  })
  assert.equal(started, today)
})

for (const [name, config] of [
  ['for other boards', { serverStartedSearch: Promise.resolve(serverSearch({ projectIds: [7, 8] })) }],
]) {
  test(`HTPR-7501 with the board list already loaded, a server result ${name} keeps the page request`, async (t) => {
    await withSearch(t, { query: 'Result', ...config }, async ({ requests, complete }) => {
      await flush()
      assert.equal(requests.length, 1)
      assert.deepEqual(requests[0].body, { projectIds: [7], searchQuery: 'Result', archive: 'Normal', contextProjectId: null })
      await complete(requests[0], serverTasks, ['All', 'Product Board'])
      assert.ok(document.getElementById('task_2'))
    })
  })
}

for (const searchOnce of [false, true]) test(`HTPR-7501 a search the user starts while the server result is pending wins (HTPR-7502 ${searchOnce ? 'on' : 'off'})`, async (t) => {
  let resolveServer
  let resolveBoards
  let ready = false
  const projects = []
  const refetch = () => new Promise((resolve) => { resolveBoards = () => resolve({ data: [{ id: 7, title: 'Product Board' }] }) })
  await withSearch(t, { query: 'Result', projects: () => projects, refetch, flagsReady: () => ready, searchOnce, serverStartedSearch: new Promise((resolve) => { resolveServer = resolve }) }, async ({ type, press, tick, render, requests, complete }) => {
    await flush()
    await type('Other')
    await press('Enter')
    await tick()
    await flush()
    assert.equal(requests.length, 0, 'the user search waits for the board list')
    ready = true
    await render('Result')
    await React.act(async () => resolveServer(serverSearch()))
    await flush()
    assert.equal(document.getElementById('task_2'), null, 'the server result does not replace the user search')
    await React.act(async () => resolveBoards())
    await flush()
    assert.equal(requests.length, 1)
    assert.equal(requests[0].body.searchQuery, 'Other')
    await complete(requests[0], [serverTasks[0]], ['All'])
    assert.ok(document.getElementById('task_1'))
    assert.equal(document.getElementById('task_2'), null, 'the server result for the old query is not shown')
    assert.equal(requests.length, 1)
  })
})

async function freshTab(t, config, run) {
  let ready = false
  await withSearch(t, { query: 'Result', flagsBeforeReady: {}, flagsReady: () => ready, ...config }, async (tools) => {
    await flush()
    const before = tools.requests.length
    ready = true
    await tools.render('Result')
    await flush()
    await run({ ...tools, before })
  })
}

test('HTPR-7502 a fresh tab with the board list loaded shows the server result before feature settings load without a request', async (t) => {
  const today = await searchPageHtml(t, {}, async ({ requests, complete }) => complete(requests[0], serverTasks, ['All', 'Product Board']))
  let html
  await freshTab(t, { searchOnce: true, serverStartedSearch: Promise.resolve(serverSearch()) }, async ({ requests, before }) => {
    assert.equal(before, 0, 'no request before feature settings load')
    assert.equal(requests.length, 0, 'the server result is used')
    html = document.getElementById('root').innerHTML
  })
  assert.equal(html, today)
})

test('HTPR-7502 a fresh tab whose server result is for other boards sends the page search once', async (t) => {
  await freshTab(t, { searchOnce: true, serverStartedSearch: Promise.resolve(serverSearch({ projectIds: [7, 8] })) }, async ({ requests, before, complete }) => {
    assert.equal(before, 1, 'layout is available before feature settings load')
    assert.equal(requests.length, 1)
    assert.deepEqual(requests[0].body, { projectIds: [7], searchQuery: 'Result', archive: 'Normal', contextProjectId: null })
    await complete(requests[0], serverTasks, ['All', 'Product Board'])
    assert.ok(document.getElementById('task_2'))
  })
})

test('HTPR-7502 a fresh tab without a server result searches once', async (t) => {
  await freshTab(t, { searchOnce: true }, async ({ requests, before, complete }) => {
    assert.equal(before, 1, 'the page search does not wait for feature settings')
    assert.equal(requests.length, 1, 'feature settings loading does not resend it')
    await complete(requests[0], serverTasks, ['All', 'Product Board'])
    assert.ok(document.getElementById('task_2'))
  })
})

for (const [name, config, requestCount] of [['with a server result', { serverStartedSearch: Promise.resolve(serverSearch()) }, 0], ['without a server result', {}, 1]]) {
  test(`HTPR-7502 flag off: a fresh tab ${name} does not wait for layout hydration`, async (t) => {
    await freshTab(t, { searchOnce: false, ...config }, async ({ requests, complete }) => {
      assert.equal(requests.length, requestCount)
      if (requestCount) await complete(requests.at(-1), serverTasks, ['All', 'Product Board'])
      assert.ok(document.getElementById('task_2'))
    })
  })
}

for (const enabled of [true, false]) {
  for (const query of ['', 'a']) {
    test(`HTPR-7558 flag ${enabled ? 'on' : 'off'}: a short query ${JSON.stringify(query)} ${enabled ? 'keeps' : 'retains the legacy loss of'} initial writing focus`, async (t) => {
      let resolveServer
      let projects = []
      await withSearch(t, {
        query,
        flags: { 'htpr-7558-slash-search-focus': enabled },
        projects: () => projects,
        serverStartedSearch: new Promise((resolve) => { resolveServer = resolve }),
      }, async ({ input, dom, render, state, requests }) => {
        assert.equal(document.activeElement, enabled ? input() : document.body, 'focus is decided before the server promise settles')
        await React.act(async () => resolveServer(null))
        assert.equal(document.activeElement, enabled ? input() : document.body, 'a null server result must not take writing focus')
        projects = [{ id: 7, title: 'Product Board' }]
        await render(query)
        assert.equal(document.activeElement, enabled ? input() : document.body, 'loading the board list must not change focus')
        assert.equal(requests.length, 0, 'opening search does not submit an empty or one-character query')
        if (enabled) {
          await React.act(async () => {
            Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(document.activeElement, 'focusprobe')
            document.activeElement.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
          })
          assert.equal(input().value, 'focusprobe', 'typing goes into the search box without focus() or a click')
          assert.equal(state().inputValue, 'focusprobe')
        }
      })
    })
  }
}

test('HTPR-7558 keeps Enter result navigation and one-Escape exit after opening an empty search', async (t) => {
  let projects = []
  await withSearch(t, {
    flags: { 'htpr-7558-slash-search-focus': true, 'htpr-6994-search-esc-leaves': true },
    projects: () => projects,
    serverStartedSearch: Promise.resolve(null),
  }, async ({ input, render, dom, press, requests, complete, state, navigations }) => {
    assert.equal(document.activeElement, input())
    projects = [{ id: 7, title: 'Product Board' }]
    await render()
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(document.activeElement, 'qzxw7558')
      document.activeElement.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await press('Enter', { keyCode: 13 })
    assert.equal(requests.at(-1).body.searchQuery, 'qzxw7558')
    await complete(requests.at(-1), serverTasks)
    assert.equal(document.activeElement, document.body, 'Enter still leaves writing mode')
    const key = async (key, keyCode) => React.act(async () => {
      document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }))
    })
    await key('j', 74)
    assert.equal(state().selectedIndex, 1)
    await key('k', 75)
    assert.equal(state().selectedIndex, 0)
    await key('Escape', 27)
    assert.equal(navigations.at(-1), 'back')
    assert.equal(navigations.filter((url) => url === 'back').length, 1)
  })
})

test('HTPR-7558 still starts a populated URL search in result-navigation mode', async (t) => {
  const projects = []
  await withSearch(t, {
    query: 'Result',
    flags: { 'htpr-7558-slash-search-focus': true },
    projects: () => projects,
    serverStartedSearch: Promise.resolve(serverSearch()),
  }, async ({ state, requests }) => {
    await flush()
    assert.equal(document.activeElement, document.body)
    assert.equal(document.getElementById('task_2').textContent.includes('Second result'), true)
    assert.equal(state().selectedIndex, 0)
    assert.equal(requests.length, 0)
  })
})

test('HTPR-7618 result rows follow the search pane width only while the bugfix flag is on', async (t) => {
  for (const enabled of [true, false]) {
    await withSearch(t, { query: 'login', flags: { 'htpr-7618-search-rows-fit-pane': enabled } }, async ({ complete }) => {
      await complete()
      const grid = document.getElementById('task_1').firstElementChild
      assert.equal(grid.classList.contains('list_container_pane'), enabled)
      assert.equal(grid.classList.contains('list_container'), !enabled)
    })
  }
})

