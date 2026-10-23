const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
globalThis.AsyncLocalStorage ??= require('node:async_hooks').AsyncLocalStorage
const { unstable_doesMiddlewareMatch: matches } = require('next/experimental/testing/server')
const { harness } = require('./helpers/agent-cookie-bridge.cjs')
const root = path.resolve(__dirname, '..')
const source = ts.createSourceFile('proxy.ts', fs.readFileSync(path.join(root, 'src/proxy.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
const declaration = source.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]).find(d => d.name.getText(source) === 'config')
const config = vm.runInNewContext(`(${declaration.initializer.getText(source)})`)
const oldConfig = { matcher: ['/((?!api|_next|flask-app|files(?:/|$)|.*\\..*).*)', '/api/:path*'] }
function match(config, url) { return matches({ config, nextConfig: {}, url }) }
function publicPaths(directory = path.join(root, 'public')) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? publicPaths(full) : ['/' + path.relative(path.join(root, 'public'), full).split(path.sep).join('/')]
  })
}

test('real Next matcher widens only dotted paths and preserves infrastructure exclusions/API split', () => {
  for (const pathname of ['/detail/project-15/7495.json', '/android-native/latest.json', '/.well-known/assetlinks.json', '/asset.avif', '/asset.ico', '/asset.js', '/asset.png', '/asset.svg', '/asset.txt']) {
    assert.equal(match(oldConfig, pathname), false, pathname)
    assert.equal(match(config, pathname), true, pathname)
  }
  for (const pathname of ['/_next/static/a.js', '/_next/image', '/flask-app/foo.json', '/files', '/files/', '/files/path', '/files/a.png']) {
    assert.equal(match(oldConfig, pathname), false, pathname)
    assert.equal(match(config, pathname), false, pathname)
  }
  for (const pathname of ['/api/tasks.json', '/api/v1/anything', '/project', '/files-private', '/oauth/authorize', '/mcp']) {
    assert.equal(match(oldConfig, pathname), true, pathname)
    assert.equal(match(config, pathname), true, pathname)
  }
})

test('every dotted public file keeps untouched anonymous/human responses before revocation or cookie mutation', async () => {
  const paths = publicPaths().filter(p => p.includes('.'))
  const extensions = new Set(paths.map(p => path.extname(p)))
  for (const ext of ['.avif', '.ico', '.js', '.json', '.png', '.svg', '.txt']) assert.ok(extensions.has(ext), ext)
  assert.ok(paths.includes('/.well-known/assetlinks.json'))
  assert.ok(paths.includes('/android-native/latest.json'))
  const h = harness({ revoked: true })
  for (const pathname of paths) {
    assert.equal(match(oldConfig, pathname), false, pathname)
    assert.equal(match(config, pathname), true, pathname)
    for (const kind of ['none', 'human']) {
      const response = await h.proxy(h.request(pathname, { kind, cookies: { ht_in: '0', previousBoard: 'project-15' } }))
      assert.equal(response.status, 200, pathname)
      assert.equal(response.headers.get('x-middleware-next'), '1', pathname)
      assert.equal(response.headers.has('location'), false, pathname)
      assert.equal(response.headers.has('set-cookie'), false, pathname)
      assert.equal(response.headers.has('cache-control'), false, pathname)
    }
    assert.equal((await h.proxy(h.request(pathname))).status, 403, pathname)
  }
  assert.equal(h.calls.revocation, 0)
})

test('dotted API paths still run existing identity and revocation checks', async () => {
  const h = harness({ revoked: true })
  assert.equal((await h.proxy(h.request('/api/tasks.json', { kind: 'human' }))).status, 401)
  assert.equal(h.calls.revocation, 1)
})

test('already-matched page redirects remain intact', async () => {
  const h = harness()
  for (const [pathname, options, destination] of [
    ['/inbox', { kind: 'none' }, '/login'],
    ['/', { kind: 'none' }, '/demo'],
    ['/', { kind: 'human' }, '/project'],
    ['/login', { kind: 'human' }, '/'],
    ['/detail/project-15', { kind: 'human' }, '/project?id=15'],
    ['/', { kind: 'none', host: 'mcp.hypertask.ai' }, '/mcp'],
    ['/health', { kind: 'none', host: 'mcp.hypertask.ai' }, '/mcp-health'],
    ['/', { kind: 'none', host: 'demo.hypertask.ai' }, '/demo'],
  ]) {
    assert.equal(match(oldConfig, pathname), true)
    const response = await h.proxy(h.request(pathname, options))
    const location = response.headers.get('location') ?? response.headers.get('x-middleware-rewrite')
    assert.equal(location, `https://${options.host ?? 'app.hypertask.ai'}${destination}`)
  }
})
