require('./helpers/register-server-only.cjs')
const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { createJiti } = require('jiti')
const root = path.resolve(__dirname, '..')
const flag = 'htpr-7502-search-once'

test('the flag is an Everyone improvement', () => {
  const definition = createJiti(__filename, { interopDefault: true })(path.join(root, 'src/lib/flags/definitions/htpr-7502-search-once.ts'))
  assert.equal(definition.key, flag)
  assert.equal(definition.kind, 'improvement')
  assert.equal(definition.defaultMode, 'EVERYONE')
})

test('the search page asks for one search only on a full page load for the signed-in user with the flag on', async () => {
  const cached = new Map(Object.entries(require.cache))
  const stub = (file, exports) => { const filename = file.startsWith('/') ? file : path.join(root, file); require.cache[filename] = { id: filename, filename, loaded: true, exports } }
  let enabled = true
  let rsc = null
  let sessionUserId = 985
  try {
    stub(require.resolve('next/headers', { paths: [root] }), {
      cookies: async () => ({ get: () => ({ value: JSON.stringify({ id: 985 }) }) }),
      headers: async () => new Headers(rsc ? { rsc } : {}),
    })
    stub('src/lib/auth/getSessionUser.ts', { getSessionUser: async () => sessionUserId === null ? null : { userId: sessionUserId } })
    stub('src/lib/flags.ts', { isFeatureEnabled: async (key) => key === flag ? enabled : false })
    stub('src/app/search/SearchComp.tsx', { default: () => null })
    stub('src/app/search/startServerSearch.ts', { startServerSearch: async () => null })
    const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } })
    const Page = jiti(path.join(root, 'src/app/search/page.tsx')).default
    const searchOnce = async () => (await Page({ searchParams: Promise.resolve({ searchTerm: 'Result' }) })).props.children.props.searchOnce
    assert.equal(await searchOnce(), true)
    rsc = '1'
    assert.equal(await searchOnce(), false, 'in-app navigation keeps today\'s search')
    rsc = null
    enabled = false
    assert.equal(await searchOnce(), false, 'flag off keeps today\'s search')
    enabled = true
    sessionUserId = 7
    assert.equal(await searchOnce(), false, 'a user cookie for another user keeps today\'s search')
  } finally {
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key]
    for (const [key, value] of cached) require.cache[key] = value
  }
})
