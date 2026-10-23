require('./helpers/register-server-only.cjs')
const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { createJiti } = require('jiti')
const root = path.resolve(__dirname, '..')
const flag = 'htpr-7501-search-server-start'

async function withModules(stubs, run) {
  const cached = new Map(Object.entries(require.cache))
  const stub = (filename, exports) => { require.cache[filename] = { id: filename, filename, loaded: true, exports } }
  try {
    for (const [file, exports] of Object.entries(stubs)) stub(file.startsWith('/') ? file : path.join(root, file), exports)
    const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })
    return await run(jiti)
  } finally {
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key]
    for (const [key, value] of cached) require.cache[key] = value
  }
}

test('the flag is an Everyone improvement', () => {
  const definition = createJiti(__filename, { interopDefault: true })(path.join(root, 'src/lib/flags/definitions/htpr-7501-search-server-start.ts'))
  assert.equal(definition.key, flag)
  assert.equal(definition.kind, 'improvement')
  assert.equal(definition.defaultMode, 'EVERYONE')
})

test('the search page starts the server search only on a full page load for the signed-in user with the flag on', async () => {
  const started = []
  const flagCalls = []
  let enabled = true
  let rsc = null
  let sessionUserId = 985
  await withModules({
    [require.resolve('next/headers', { paths: [root] })]: {
      cookies: async () => ({ get: () => ({ value: JSON.stringify({ id: 985 }) }) }),
      headers: async () => new Headers(rsc ? { rsc } : {}),
    },
    'src/lib/auth/getSessionUser.ts': { getSessionUser: async () => sessionUserId === null ? null : { userId: sessionUserId } },
    'src/lib/flags.ts': { isFeatureEnabled: async (key, userId) => { flagCalls.push([key, userId]); return key === flag ? enabled : false } },
    'src/app/search/SearchComp.tsx': { default: () => null },
    'src/app/search/startServerSearch.ts': { startServerSearch: async (...args) => { started.push(args); return { status: 200 } } },
  }, async (jiti) => {
    const Page = jiti(path.join(root, 'src/app/search/page.tsx')).default
    const props = async (searchParams) => (await Page({ searchParams: Promise.resolve(searchParams) })).props.children.props
    const first = await props({ searchTerm: 'Result', includeArchived: '1', fromProject: '7' })
    assert.deepEqual(started.at(-1), [985, 'Result', true, 7])
    assert.deepEqual(await first.serverStartedSearch, { status: 200 })

    rsc = '1'
    assert.equal((await props({ searchTerm: 'Result' })).serverStartedSearch, undefined, 'in-app navigation keeps the page search')
    rsc = null
    enabled = false
    assert.equal((await props({ searchTerm: 'Result' })).serverStartedSearch, undefined, 'flag off keeps the page search')
    enabled = true
    const before = flagCalls.filter(([key]) => key === flag).length
    for (const identity of [7, null]) {
      sessionUserId = identity
      assert.equal((await props({ searchTerm: 'Result' })).serverStartedSearch, undefined)
    }
    assert.equal(flagCalls.filter(([key]) => key === flag).length, before, 'a display cookie for another user never starts a search')
    assert.equal(started.length, 1)
  })
})

test('the server search uses the same board list and arguments as the page search, and returns plain JSON', async () => {
  const calls = []
  let boards = { status: 200, json: [{ id: 7 }, { id: 9 }, { id: 7 }] }
  const result = { status: 200, json: { processedData: { All: [{ taskId: 1, updatedAt: new Date('2026-10-21T00:00:00Z'), missing: undefined }] }, tabs: ['All'] } }
  await withModules({
    'src/utils/controllers/projects/getAllMinimal.ts': { default: async (userId, mode) => { calls.push(['boards', userId, mode]); return boards } },
    'src/utils/controllers/search/searchDocuments.ts': { searchDocuments: async (...args) => { calls.push(['search', ...args]); return result } },
  }, async (jiti) => {
    const { startServerSearch } = jiti(path.join(root, 'src/app/search/startServerSearch.ts'))
    const started = await startServerSearch(985, ' Result ', false, null)
    assert.deepEqual(calls, [['boards', 985, 'ExtraMinimal'], ['search', 985, 'Result', [7, 9], 'Normal', null]])
    assert.deepEqual(started, {
      searchQuery: ' Result ', includeArchived: false, fromProject: null, projectIds: [7, 9, 7], status: 200,
      data: { processedData: { All: [{ taskId: 1, updatedAt: '2026-10-21T00:00:00.000Z' }] }, tabs: ['All'] },
    })
    await startServerSearch(985, 'Result', true, 9)
    assert.deepEqual(calls.at(-1), ['search', 985, 'Result', [7, 9], null, 9])

    calls.length = 0
    assert.equal(await startServerSearch(985, 'R', false, null), null)
    assert.equal(await startServerSearch(985, '   ', false, null), null)
    assert.equal(calls.length, 0, 'a query the page would not search is not searched')
    boards = { status: 200, json: [] }
    assert.equal(await startServerSearch(985, 'Result', false, null), null)
    boards = { status: 400, json: [] }
    assert.equal(await startServerSearch(985, 'Result', false, null), null)
    assert.ok(calls.every(([kind]) => kind === 'boards'), 'no board list means no search, as on the page')
  })
})
