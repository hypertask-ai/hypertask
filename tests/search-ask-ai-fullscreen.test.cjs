const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const React = require('react')
const { JSDOM } = require('jsdom')
const { createJiti } = require('jiti')
const root = path.resolve(__dirname, '..')
const flag = 'htpr-6936-ask-ai-fullscreen'

async function withRuntime(config, check) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/search' })
  const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)])
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const cached = new Map(Object.entries(require.cache))
  const stub = (filename, exports) => { require.cache[filename] = { id: filename, filename, loaded: true, exports } }
  const source = (file, exports) => stub(path.join(root, file), exports)
  let pathname = config.pathname ?? '/search'
  let fullscreenEnabled = config.fullscreenEnabled ?? true
  let pending = config.prompt
  let setter
  const sent = []
  let created = 0
  let context = {
    editor: null, editorEnabled: false, fileItems: [], sessions: [{ id: 'old' }],
    activeSession: 'old', currentSession: { id: 'old', messages: [{ role: 'human', content: 'Previous question' }] },
    chatHistoryReady: true, isByokBlocked: false, isTyping: false,
    layoutKeydown() {}, startNewSession: async () => { created++ },
    handleSendMessage: async (query, options) => { sent.push({ sessionId: context.currentSession.id, query, ...(options ? { options } : {}) }) },
    ...config.context,
  }
  let reactRoot
  try {
    source('src/hooks/MultiPages/AIChat/useAiChat.ts', { useAiChat: () => context })
    source('src/hooks/useFlag.tsx', { useFlag: (key) => { assert.equal(key, flag); return fullscreenEnabled } })
    source('src/lib/state.tsx', { useRecoilState: () => {
      const pair = React.useState(config.prompt)
      pending = pair[0]
      setter = pair[1]
      return pair
    } })
    source('src/store/index.ts', { aiChatPendingPromptAtom: {} })
    stub(require.resolve('next/navigation'), { usePathname: () => pathname })
    stub(require.resolve('next/dynamic'), { default: () => () => null })
    const { ChatRuntime } = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })(path.join(root, 'src/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context.tsx'))
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'))
    const render = async () => React.act(async () => reactRoot.render(React.createElement(config.strictMode ? React.StrictMode : React.Fragment, null, React.createElement(ChatRuntime, { onValue() {} }))))
    await render()
    await check({
      sent, created: () => created, pending: () => pending,
      update: async (patch, route = pathname) => { context = { ...context, ...patch }; pathname = route; await render() },
      handoff: async (prompt) => React.act(async () => setter(prompt)),
      setFlag: async (enabled) => { fullscreenEnabled = enabled; await render() },
    })
  } finally {
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

test('fullscreen handoff waits for /chat, history and a new session, then sends the first message once', async () => {
  const prompt = { query: 'Where is my work?', fullScreen: true }
  await withRuntime({ prompt, strictMode: true, context: { editor: { isEmpty: false }, fileItems: [{}] } }, async ({ update, sent, created, pending, handoff }) => {
    assert.equal(created(), 0, 'a warm docked runtime must not consume the fullscreen prompt')
    assert.deepEqual(sent, [])
    await update({ chatHistoryReady: false }, '/chat')
    assert.equal(created(), 0)
    await update({ chatHistoryReady: true })
    assert.equal(created(), 1)
    assert.deepEqual(sent, [], 'the previous conversation must not receive the question')
    await update({})
    assert.equal(created(), 1, 'rerenders do not create duplicate sessions')
    const newSession = { id: 'new', messages: [] }
    await update({ activeSession: 'new', currentSession: newSession, sessions: [newSession, { id: 'old' }] })
    assert.deepEqual(sent, [{ sessionId: 'new', query: prompt.query, options: { preserveComposer: true } }])
    assert.equal(pending(), null)
    await update({})
    assert.equal(sent.length, 1, 'StrictMode and rerenders must not resend')
    await handoff({ query: 'Another question', fullScreen: true })
    assert.equal(created(), 2, 'a second selection gets its own new conversation')
  })
})

test('fullscreen handoff is cancelled when the flag turns off before readiness or during session creation', async () => {
  for (const duringCreation of [false, true]) {
    const prompt = { query: 'Where is my work?', fullScreen: true }
    await withRuntime({ prompt, pathname: '/chat', context: { chatHistoryReady: duringCreation, editor: { isEmpty: false }, fileItems: [{}] } }, async ({ update, setFlag, sent, created, pending, handoff }) => {
      assert.equal(created(), duringCreation ? 1 : 0)
      await setFlag(false)
      assert.equal(pending(), null)
      const newSession = { id: 'new', messages: [] }
      await update({ chatHistoryReady: true, activeSession: 'new', currentSession: newSession, sessions: [newSession] })
      assert.deepEqual(sent, [])
      await setFlag(true)
      assert.deepEqual(sent, [], 'enabling the flag must not revive a cancelled handoff')
      await handoff(prompt)
      assert.equal(created(), duringCreation ? 2 : 1, 'cancellation resets the session latch')
    })
  }
})

test('failed session creation recovers the question without replacing a draft or retrying automatically', async () => {
  for (const delayedEditor of [false, true]) {
    const inserted = []
    const editor = { isEmpty: false, state: { doc: { content: { size: 12 } } }, commands: { insertContentAt: (...args) => inserted.push(args), focus() {} } }
    let attempts = 0
    const startNewSession = async () => { if (++attempts === 1) throw new Error('Session unavailable') }
    const prompt = { query: 'Recover my question', fullScreen: true }
    await withRuntime({ prompt, pathname: '/chat', strictMode: true, context: { startNewSession, editor: delayedEditor ? null : editor, fileItems: [{}] } }, async ({ update, sent, pending, handoff }) => {
      assert.equal(pending(), null)
      assert.equal(attempts, 1)
      await update({ editor })
      assert.deepEqual(inserted, [[12, { type: 'paragraph', content: [{ type: 'text', text: prompt.query }] }]])
      await update({})
      assert.equal(attempts, 1, 'no automatic retry loop')
      assert.deepEqual(sent, [])
      await handoff(prompt)
      assert.equal(attempts, 2, 'a later explicit attempt can create a session even with the same prompt')
      const newSession = { id: 'new', messages: [] }
      await update({ activeSession: 'new', currentSession: newSession, sessions: [newSession] })
      assert.deepEqual(sent, [{ sessionId: 'new', query: prompt.query, options: { preserveComposer: true } }])
      assert.equal(inserted.length, 1)
    })
  }
})

test('legacy prompt retains readiness guards and uses the existing conversation without starting a new one', async () => {
  await withRuntime({ prompt: 'Legacy question', fullscreenEnabled: false, context: { isByokBlocked: true } }, async ({ update, sent, created, pending }) => {
    assert.equal(pending(), 'Legacy question')
    await update({ isByokBlocked: false, isTyping: true })
    assert.deepEqual(sent, [])
    await update({ isTyping: false, sessions: [] })
    assert.deepEqual(sent, [])
    await update({ sessions: [{ id: 'old' }] })
    assert.deepEqual(sent, [{ sessionId: 'old', query: 'Legacy question' }])
    assert.equal(created(), 0)
    assert.equal(pending(), null)
  })
})

test('ordinary chat opens without a pending search prompt are unchanged', async () => {
  await withRuntime({ prompt: null, pathname: '/chat' }, async ({ update, sent, created }) => {
    await update({})
    assert.deepEqual(sent, [])
    assert.equal(created(), 0)
  })
})

test('legacy handoff does not wipe an unsent draft or send its attachments', async () => {
  for (const hasDraft of [true, false]) {
    const drafted = []
    const editor = { isEmpty: !hasDraft, commands: { setContent: (query) => drafted.push(query), focus() {} } }
    await withRuntime({ prompt: 'Legacy question', context: { editor, fileItems: [{}] } }, async ({ sent, created, pending }) => {
      assert.deepEqual(sent, [])
      assert.equal(created(), 0)
      assert.equal(pending(), null)
      assert.deepEqual(drafted, hasDraft ? [] : ['Legacy question'])
    })
  }
})

test('search server gate uses the authenticated identity, fails closed and passes the flag to the existing component', async () => {
  const cached = new Map(Object.entries(require.cache))
  const stub = (filename, exports) => { require.cache[filename] = { id: filename, filename, loaded: true, exports } }
  const source = (file, exports) => stub(path.join(root, file), exports)
  const calls = []
  let userId = 985
  let enabled = true
  try {
    stub(require.resolve('next/headers'), { cookies: async () => ({ get: () => ({ value: JSON.stringify({ id: 985 }) }) }), headers: async () => new Headers() })
    source('src/lib/auth/getSessionUser.ts', { getSessionUser: async () => userId === null ? null : { userId } })
    source('src/lib/flags.ts', { isFeatureEnabled: async (...args) => { calls.push(args); return enabled } })
    source('src/app/search/SearchComp.tsx', { default: () => null })
    const Page = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })(path.join(root, 'src/app/search/page.tsx')).default
    for (const value of [true, false]) {
      enabled = value
      const page = await Page({ searchParams: Promise.resolve({ searchTerm: 'my question' }) })
      assert.equal(page.props.children.props.askAiFullscreenEnabled, value)
      assert.equal(page.props.children.props._searchTerm, 'my question')
      assert.deepEqual(calls.at(-1), [flag, 985])
    }
    const previousCalls = calls.length
    for (const identity of [7, null]) {
      userId = identity
      const page = await Page({ searchParams: Promise.resolve({}) })
      assert.equal(page.props.children.props.askAiFullscreenEnabled, false)
    }
    assert.equal(calls.length, previousCalls, 'a forged display cookie cannot authorize fullscreen behavior')
  } finally {
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key]
    for (const [key, value] of cached) require.cache[key] = value
  }
})

test('the reused sender adds the question first and streams the reply without sending or clearing a saved composer', async () => {
  const cached = new Map(Object.entries(require.cache))
  const source = (file, exports) => {
    const filename = path.join(root, file)
    require.cache[filename] = { id: filename, filename, loaded: true, exports }
  }
  const originalFetch = global.fetch
  try {
    source('src/lib/mcp/bearerAuth.ts', { mcpAuthorizationHeaders: () => ({}) })
    source('src/lib/demo/guestBoardBuild.ts', { isGuestBoardBuild: () => false })
    source('src/lib/realtime/taskCommentsRefresh.ts', { refreshTaskComments: async () => {} })
    source('src/hooks/Inbox/useGetNotifications.ts', { INBOX_QUERY_KEY: ['inbox'] })
    source('src/hooks/MultiPages/AIChat/aiChatShared.ts', { parseAiStreamErrorContent: (content) => content })
    const { createAiChatSend } = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false })(path.join(root, 'src/hooks/MultiPages/AIChat/aiChatSend.ts'))
    for (const [fullscreenEnabled, requestedPreservation] of [[true, true], [true, false], [false, false], [false, true]]) {
      const preserveComposer = fullscreenEnabled && requestedPreservation
      const messages = []
      const cleared = []
      const processed = []
      let payload
      global.fetch = async (_url, request) => {
        payload = JSON.parse(request.body)
        const frames = ['event: content\ndata: {"content":"Hello"}\n\n', 'event: content\ndata: {"content":" world"}\n\n', 'event: done\ndata: {"assistant_persisted":true}\n\n']
        return { ok: true, body: new ReadableStream({ start(controller) { for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame)); controller.close() } }) }
      }
      const ref = () => ({ current: null })
      const session = { id: 'new', messages: [] }
      const { handleSendMessage } = createAiChatSend({
        isByokBlocked: false, isTyping: false,
        editor: { getText: () => 'Unsent draft', commands: { clearContent: () => cleared.push('draft') } },
        fileUpload: { fileItems: [{ name: 'unsent.txt' }], clearFiles: () => cleared.push('files') },
        sendInFlightRef: { current: false }, waitForChatSession: async () => session,
        processAttachments: async (...args) => { processed.push(args); return [{ mimeType: 'text/plain', fileName: 'unsent.txt', url: '/draft' }] },
        setIsTyping() {}, addMessageToSessionQuery: (_id, message) => messages.push(message),
        isFullScreenChat: true, currentAiOption: { id: 'model', model: 'model', source: 'openai' },
        currentUser: { id: 985 }, streamingSessionRef: ref(), streamingAssistantMessageRef: ref(), streamingRequestRef: ref(),
        setCurrentStreamingSession() {}, chatRoute: '/api/ai/chat/stream', setAgentStatus() {}, updateSessionTitle() {},
        queryClient: { refetchQueries: async () => {} }, drainQueuedMessage() {}, handleSendMessageRef: ref(),
      }, fullscreenEnabled ? { preserveComposer: true } : undefined)
      await handleSendMessage('Where is my work?', requestedPreservation ? { preserveComposer: true } : undefined)
      if (requestedPreservation && !fullscreenEnabled) {
        assert.equal(payload, undefined, 'a revoked preservation request must cancel, never consume the composer')
        assert.deepEqual(messages, [])
        assert.deepEqual(cleared, [])
        assert.deepEqual(processed, [])
        continue
      }
      assert.equal(payload.message, 'Where is my work?')
      assert.equal(payload.session_id, 'new')
      assert.deepEqual(payload.chat_history, [])
      assert.equal(messages[0].role, 'human')
      assert.equal(messages[0].content, 'Where is my work?')
      assert.deepEqual(messages.slice(2).map(({ content, isDelivered }) => [content, isDelivered]), [['Hello', false], ['Hello world', false], ['Hello world', true]])
      assert.deepEqual(cleared, preserveComposer ? [] : ['draft', 'files'])
      assert.equal(processed.length, preserveComposer ? 0 : 1)
      assert.equal(payload.attachments.length, preserveComposer ? 0 : 1)
    }
  } finally {
    global.fetch = originalFetch
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key]
    for (const [key, value] of cached) require.cache[key] = value
  }
})
