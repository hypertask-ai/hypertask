const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const allowlistPath = path.join(root, 'tests/fixtures/api-no-login-allowlist.json')
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']
const BEFORE_AUTH = new Set([400, 404, 405, 422])
const HANDLER_TIMEOUT_MS = 800

// Explicit import stubs. Each one exists because loading the real module
// either opens a database connection or throws outside a Next request.
// '@/lib/prisma' (src/lib/prisma.ts) is the only module that constructs
// PrismaClient. Routes import it as the default export.
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ht-6801-no-login-'))
const prismaStubPath = path.join(stubDir, 'prisma-stub.cjs')
const headersStubPath = path.join(stubDir, 'headers-stub.cjs')

fs.writeFileSync(prismaStubPath, `
const touches = []
function make(label) {
  const fn = function prismaStub() {}
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined
      if (prop === 'constructor' || prop === 'prototype' || prop === 'name' || prop === 'length') return undefined
      touches.push(label + '.' + String(prop))
      return make(label + '.' + String(prop))
    },
    apply() {
      touches.push(label + '()')
      const error = new Error('PRISMA_TOUCHED ' + label)
      error.code = 'PRISMA_TOUCHED'
      throw error
    },
    construct() {
      touches.push('new ' + label)
      const error = new Error('PRISMA_TOUCHED new ' + label)
      error.code = 'PRISMA_TOUCHED'
      throw error
    },
  })
}
const proxy = make('prisma')
module.exports = {
  __esModule: true,
  default: proxy,
  __touches: touches,
  __reset() { touches.length = 0 },
}
`)

// next/headers reads the Next.js request store. A direct handler call has
// no store, so cookies() would throw before the route's own auth check.
// The stub matches the request we send: no cookies and no authorization.
fs.writeFileSync(headersStubPath, `
function store() {
  return {
    get() { return undefined },
    getAll() { return [] },
    has() { return false },
    set() {},
    delete() {},
  }
}
function asAsync(value) {
  const promise = Promise.resolve(value)
  return new Proxy(promise, {
    get(target, prop, receiver) {
      if (prop in value) {
        const field = value[prop]
        return typeof field === 'function' ? field.bind(value) : field
      }
      const field = Reflect.get(target, prop, receiver)
      return typeof field === 'function' ? field.bind(target) : field
    },
  })
}
function cookies() { return asAsync(store()) }
function headers() { return asAsync(new Headers()) }
function draftMode() { return asAsync({ isEnabled: false, enable() {}, disable() {} }) }
module.exports = { cookies, headers, draftMode }
`)

const REQUEST_STUBS = {
  // Empty Next request-store cookies. See the comment above the stub file.
  'next/headers': headersStubPath,
}

function isPrismaRequest(value) {
  const normalized = String(value).replace(/\\/g, '/')
  return normalized === '@/lib/prisma' ||
    normalized === '@/lib/prisma.ts' ||
    normalized === '@/lib/prisma.js' ||
    normalized.endsWith('/src/lib/prisma.ts') ||
    normalized.endsWith('/src/lib/prisma.js')
}

function isHeadersRequest(value) {
  const normalized = String(value).replace(/\\/g, '/')
  return normalized === 'next/headers' || normalized.endsWith('/next/headers.js')
}

// jiti compiles a route by reading the TypeScript source, then evaluates
// require("@/lib/prisma"). Rewriting that specifier to the stub file stops
// src/lib/prisma.ts from constructing a real PrismaClient.
function rewriteLoadedSource(file, data, options) {
  if (typeof file !== 'string' || !file.includes('/src/')) return data
  if (!/\.(?:ts|tsx|js|mjs|cjs)$/.test(file)) return data
  const encoding = typeof options === 'string' ? options : options && options.encoding
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
  if (!text.includes('@/lib/prisma') && !text.includes('next/headers') && !text.includes('/lib/prisma')) return data
  const rewritten = text
    .replace(/(['"])@\/lib\/prisma(?:\.ts)?\1/g, `'${prismaStubPath}'`)
    .replace(/(['"])next\/headers\1/g, `'${headersStubPath}'`)
    .replace(/(['"])(?:\.\.\/)+lib\/prisma(?:\.ts)?\1/g, `'${prismaStubPath}'`)
  if (rewritten === text) return data
  if (Buffer.isBuffer(data) && !encoding) return Buffer.from(rewritten)
  return rewritten
}

const originalReadFileSync = fs.readFileSync
fs.readFileSync = function readFileSyncStubbed(file, options) {
  return rewriteLoadedSource(file, originalReadFileSync.apply(this, arguments), options)
}
const originalReadFile = fs.promises.readFile
fs.promises.readFile = async function readFileStubbed(file, options) {
  return rewriteLoadedSource(file, await originalReadFile.apply(this, arguments), options)
}

const originalResolve = Module._resolveFilename
Module._resolveFilename = function resolveStubbed(request, parent, isMain, options) {
  if (Object.prototype.hasOwnProperty.call(REQUEST_STUBS, request)) return REQUEST_STUBS[request]
  if (isHeadersRequest(request)) return headersStubPath
  if (isPrismaRequest(request)) return prismaStubPath
  const resolved = originalResolve.call(this, request, parent, isMain, options)
  if (isHeadersRequest(resolved)) return headersStubPath
  if (isPrismaRequest(resolved)) return prismaStubPath
  return resolved
}

const prismaStub = require(prismaStubPath)
const { NextRequest } = require('next/server')
const jiti = require('jiti')(path.join(root, 'tests/api-no-login.test.cjs'), {
  interopDefault: true,
  // A filesystem cache would replay transforms from before the specifier rewrite.
  fsCache: false,
  alias: { '@': path.join(root, 'src') },
})

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else files.push(full)
  }
  return files
}

function discoverRoutes() {
  const pages = walk(path.join(root, 'src/pages/api'))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .map((file) => ({
      kind: 'pages',
      file,
      url: '/api/' + path.relative(path.join(root, 'src/pages/api'), file).split(path.sep).join('/').slice(0, -3),
    }))
  const app = walk(path.join(root, 'src/app/api'))
    .filter((file) => file.endsWith(path.sep + 'route.ts') || file.endsWith('/route.ts'))
    .map((file) => ({
      kind: 'app',
      file,
      url: '/api/' + path.relative(path.join(root, 'src/app/api'), path.dirname(file)).split(path.sep).join('/'),
    }))
  return pages.concat(app).sort((a, b) => a.url.localeCompare(b.url) || a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file))
}

function loadAllowlist() {
  const parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
  return {
    allow: parsed.allow || [],
    importFailures: parsed.importFailures || [],
  }
}

function isAllowlisted(url, allow) {
  return allow.some((entry) => {
    if (entry.match === 'exact') return url === entry.path
    return url === entry.path || url.startsWith(entry.path + '/')
  })
}

function routeParams(url) {
  const params = {}
  for (const part of url.split('/')) {
    const optional = part.match(/^\[\[\.\.\.(.+)\]\]$/)
    const catchAll = part.match(/^\[\.\.\.(.+)\]$/)
    const single = part.match(/^\[(.+)\]$/)
    if (optional) params[optional[1]] = ['1']
    else if (catchAll) params[catchAll[1]] = ['1']
    else if (single) params[single[1]] = '1'
  }
  return params
}

function acceptedWriteMethods(source) {
  const equals = []
  const rejected = []
  for (const method of WRITE_METHODS) {
    const equalsPattern = new RegExp(
      'req\\.method\\s*===?\\s*[\'"]' + method + '[\'"]|case\\s*[\'"]' + method + '[\'"]',
    )
    const rejectedPattern = new RegExp('req\\.method\\s*!==?\\s*[\'"]' + method + '[\'"]')
    if (equalsPattern.test(source)) equals.push(method)
    if (rejectedPattern.test(source)) rejected.push(method)
  }
  if (equals.length > 0) return equals
  if (rejected.length === 1) return rejected
  return ['POST']
}

function appWriteMethods(source) {
  return WRITE_METHODS.filter((method) => {
    const pattern = new RegExp(
      'export\\s+(?:async\\s+)?function\\s+' + method + '\\b' +
      '|export\\s+(?:const|let|var)\\s+' + method + '\\b' +
      '|export\\s*\\{[^}]*\\b' + method + '\\b',
    )
    return pattern.test(source)
  })
}

function isLoginRedirect(result) {
  if (result.status !== 303) return false
  const location = String(result.location || '')
  if (!location) return false
  try {
    return new URL(location, 'http://127.0.0.1').pathname === '/login'
  } catch {
    return false
  }
}

function classifyResult(result) {
  if (result.threw || result.prismaTouched) return 'fail'
  if (result.status === 401 || result.status === 403 || result.status === 410) return 'auth'
  if (isLoginRedirect(result)) return 'auth'
  if (BEFORE_AUTH.has(result.status)) return 'before'
  return 'fail'
}

function errorChain(error) {
  const parts = []
  const seen = new Set()
  let current = error
  while (current && !seen.has(current) && parts.length < 6) {
    seen.add(current)
    parts.push(String(current.code || ''), String(current.message || ''))
    current = current.cause
  }
  return parts.join(' ')
}

function isPrismaError(error) {
  return errorChain(error).includes('PRISMA_TOUCHED')
}

function oneLine(value) {
  return String(value || '').replace(/\s+/g, ' ').slice(0, 180)
}

function createPagesResponse() {
  const state = { statusCode: null, ended: false }
  const res = {
    get statusCode() { return state.statusCode == null ? 200 : state.statusCode },
    set statusCode(value) { state.statusCode = value },
    headersSent: false,
    setHeader() { return res },
    getHeader() { return undefined },
    removeHeader() {},
    appendHeader() { return res },
    writeHead(code) {
      state.statusCode = code
      res.headersSent = true
      return res
    },
    status(code) {
      state.statusCode = code
      return res
    },
    json() { state.ended = true; return res },
    send() { state.ended = true; return res },
    end() { state.ended = true; return res },
    write() { return true },
    redirect(first) {
      state.statusCode = typeof first === 'number' ? first : (state.statusCode == null ? 307 : state.statusCode)
      state.ended = true
      return res
    },
  }
  return { res, state }
}

function concreteUrl(url) {
  return url
    .replace(/\[\[\.\.\.[^\]]+\]\]/g, '1')
    .replace(/\[\.\.\.[^\]]+\]/g, '1')
    .replace(/\[[^\]]+\]/g, '1')
}

async function invoke(work) {
  prismaStub.__reset()
  const exit = process.exit
  process.exit = (code) => {
    const error = new Error('process.exit ' + code)
    error.code = 'PROCESS_EXIT'
    throw error
  }
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error('HANDLER_TIMEOUT')
        error.code = 'HANDLER_TIMEOUT'
        reject(error)
      }, HANDLER_TIMEOUT_MS)
      Promise.resolve().then(work).then(
        (value) => { clearTimeout(timer); resolve(value) },
        (error) => { clearTimeout(timer); reject(error) },
      )
    })
  } finally {
    process.exit = exit
  }
}

async function callPages(handler, method, url) {
  const { res, state } = createPagesResponse()
  const req = {
    method,
    headers: {},
    cookies: {},
    query: routeParams(url),
    body: {},
    url,
    socket: { remoteAddress: '127.0.0.1' },
    connection: { remoteAddress: '127.0.0.1' },
  }
  try {
    await invoke(() => handler(req, res))
  } catch (error) {
    return {
      method,
      status: error.code === 'HANDLER_TIMEOUT' ? 'timeout' : 'throw',
      prismaTouched: prismaStub.__touches.length > 0 || isPrismaError(error),
      threw: true,
      detail: oneLine(errorChain(error)),
    }
  }
  if (!state.ended && state.statusCode == null) {
    return { method, status: 'no-response', prismaTouched: prismaStub.__touches.length > 0, threw: false, detail: '' }
  }
  return {
    method,
    status: state.statusCode == null ? 200 : state.statusCode,
    prismaTouched: prismaStub.__touches.length > 0,
    threw: false,
    detail: '',
    location: '',
  }
}

function responseLocation(response) {
  if (!response || !response.headers || typeof response.headers.get !== 'function') return ''
  return response.headers.get('location') || ''
}

async function callApp(handler, method, url) {
  try {
    const request = new NextRequest('http://127.0.0.1' + concreteUrl(url), {
      method,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const context = { params: Promise.resolve(routeParams(url)) }
    const response = await invoke(() => handler(request, context))
    if (!response || typeof response.status !== 'number') {
      return { method, status: 'no-response', prismaTouched: prismaStub.__touches.length > 0, threw: false, detail: '', location: '' }
    }
    return {
      method,
      status: response.status,
      prismaTouched: prismaStub.__touches.length > 0,
      threw: false,
      detail: '',
      location: responseLocation(response),
    }
  } catch (error) {
    return {
      method,
      status: error.code === 'HANDLER_TIMEOUT' ? 'timeout' : 'throw',
      prismaTouched: prismaStub.__touches.length > 0 || isPrismaError(error),
      threw: true,
      detail: oneLine(errorChain(error)),
      location: '',
    }
  }
}

function unwrapDefault(loaded) {
  if (typeof loaded === 'function') return loaded
  if (loaded && typeof loaded.default === 'function') return loaded.default
  return null
}

function unwrapMethod(loaded, method) {
  if (loaded && typeof loaded[method] === 'function') return loaded[method]
  if (loaded && loaded.default && typeof loaded.default[method] === 'function') return loaded.default[method]
  return null
}

function silence() {
  const previous = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  }
  const quiet = () => {}
  console.log = quiet
  console.info = quiet
  console.warn = quiet
  console.error = quiet
  console.debug = quiet
  return () => {
    console.log = previous.log
    console.info = previous.info
    console.warn = previous.warn
    console.error = previous.error
    console.debug = previous.debug
  }
}

test('prisma stub records a call and a touched 401 is not a pass', () => {
  const resolved = Module._resolveFilename('@/lib/prisma')
  assert.equal(resolved, prismaStubPath)
  prismaStub.__reset()
  let threw = false
  try {
    prismaStub.default.task.findMany()
  } catch (error) {
    threw = error.code === 'PRISMA_TOUCHED'
  }
  assert.equal(threw, true)
  assert.ok(prismaStub.__touches.length > 0)
  prismaStub.__reset()
  assert.equal(prismaStub.__touches.length, 0)
  assert.equal(classifyResult({ status: 401, prismaTouched: false, threw: false }), 'auth')
  assert.equal(classifyResult({ status: 403, prismaTouched: false, threw: false }), 'auth')
  assert.equal(classifyResult({ status: 410, prismaTouched: false, threw: false }), 'auth')
  assert.equal(classifyResult({ status: 410, prismaTouched: true, threw: false }), 'fail')
  assert.equal(classifyResult({ status: 303, location: 'http://127.0.0.1/login', prismaTouched: false, threw: false }), 'auth')
  assert.equal(classifyResult({ status: 303, location: 'http://127.0.0.1/settings/slack/link', prismaTouched: false, threw: false }), 'fail')
  assert.equal(classifyResult({ status: 101, prismaTouched: false, threw: false }), 'fail')
  assert.equal(classifyResult({ status: 300, prismaTouched: false, threw: false }), 'fail')
  assert.equal(classifyResult({ status: 400, prismaTouched: false, threw: false }), 'before')
  assert.equal(classifyResult({ status: 404, prismaTouched: false, threw: false }), 'before')
  assert.equal(classifyResult({ status: 422, prismaTouched: false, threw: false }), 'before')
  assert.equal(classifyResult({ status: 401, prismaTouched: true, threw: false }), 'fail')
  assert.equal(classifyResult({ status: 200, prismaTouched: false, threw: false }), 'fail')
  assert.equal(classifyResult({ status: 302, prismaTouched: false, threw: false }), 'fail')
  assert.equal(classifyResult({ status: 500, prismaTouched: false, threw: false }), 'fail')
  assert.equal(classifyResult({ status: 405, prismaTouched: true, threw: false }), 'fail')
  assert.equal(classifyResult({ status: 'throw', prismaTouched: false, threw: true }), 'fail')
  process.stdout.write('PRISMA_STUB_CONTROL_PASS\n')
})

test('every write route refuses a request that has no session', { timeout: 170000 }, async () => {
  const started = Date.now()
  const routes = discoverRoutes()
  const allowlist = loadAllowlist()
  const knownImports = new Set(allowlist.importFailures.map((entry) => entry.path))
  const counts = {
    discovered: routes.length,
    writeCalled: 0,
    authReject: 0,
    rejectedBeforeAuth: 0,
    allowlisted: 0,
    importKnownFailures: 0,
    readOnly: 0,
  }
  const failures = []
  const importFailed = []
  const restoreConsole = silence()
  const originalInterval = global.setInterval
  global.setInterval = (...args) => {
    const timer = originalInterval(...args)
    if (timer && typeof timer.unref === 'function') timer.unref()
    return timer
  }

  try {
    for (let index = 0; index < routes.length; index += 1) {
      const route = routes[index]
      if (index > 0 && index % 40 === 0) {
        process.stderr.write('NO_LOGIN_PROGRESS ' + index + '/' + routes.length + '\n')
      }
      if (isAllowlisted(route.url, allowlist.allow)) {
        counts.allowlisted += 1
        continue
      }
      const source = fs.readFileSync(route.file, 'utf8')
      if (route.kind === 'pages' && !/export\s+default\b/.test(source)) continue
      if (route.kind === 'app') {
        const methods = appWriteMethods(source)
        if (methods.length === 0) {
          counts.readOnly += 1
          continue
        }
      }

      prismaStub.__reset()
      let loaded
      try {
        loaded = jiti(route.file)
      } catch (error) {
        if (isPrismaError(error) || prismaStub.__touches.length > 0) {
          failures.push(
            'NO_LOGIN_FAIL IMPORT ' + route.url + ' status=throw prismaTouched=true detail=' + oneLine(errorChain(error) || 'prisma touched while loading'),
          )
          continue
        }
        importFailed.push(route.url)
        if (!knownImports.has(route.url)) {
          failures.push(
            'NO_LOGIN_FAIL IMPORT ' + route.url + ' status=import-failed prismaTouched=false detail=' + oneLine(errorChain(error)),
          )
        }
        continue
      }
      // prisma.default is jiti reading the stub's default export while Better
      // Auth's module builds its adapter. It is not a query. A model call
      // records a longer touch name, and apply() still fails the import.
      if (prismaStub.__touches.some((touch) => touch !== 'prisma.default')) {
        failures.push(
          'NO_LOGIN_FAIL IMPORT ' + route.url + ' status=loaded prismaTouched=true detail=prisma was touched while loading the module',
        )
        continue
      }
      prismaStub.__reset()

      const calls = []
      if (route.kind === 'pages') {
        const handler = unwrapDefault(loaded)
        if (typeof handler !== 'function') continue
        const initial = acceptedWriteMethods(source)
        for (const method of initial) calls.push(await callPages(handler, method, route.url))
        if (calls.every((result) => result.status === 405 && !result.prismaTouched && !result.threw)) {
          for (const method of WRITE_METHODS) {
            if (!initial.includes(method)) calls.push(await callPages(handler, method, route.url))
          }
          if (calls.every((result) => result.status === 405 && !result.prismaTouched && !result.threw)) {
            counts.readOnly += 1
            continue
          }
        }
      } else {
        for (const method of appWriteMethods(source)) {
          const handler = unwrapMethod(loaded, method)
          if (typeof handler !== 'function') {
            calls.push({ method, status: 'missing-export', prismaTouched: false, threw: true, detail: 'export was not a function' })
            continue
          }
          calls.push(await callApp(handler, method, route.url))
        }
      }

      const meaningful = calls.filter((result) => !(result.status === 405 && !result.prismaTouched && !result.threw))
      counts.writeCalled += meaningful.length
      for (const result of meaningful) {
        const kind = classifyResult(result)
        if (kind === 'auth') counts.authReject += 1
        else if (kind === 'before') counts.rejectedBeforeAuth += 1
        else {
          failures.push(
            'NO_LOGIN_FAIL ' + result.method + ' ' + route.url +
            ' status=' + result.status +
            ' prismaTouched=' + result.prismaTouched +
            (result.detail ? ' detail=' + result.detail : ''),
          )
        }
      }
    }
  } finally {
    global.setInterval = originalInterval
    restoreConsole()
    Module._resolveFilename = originalResolve
    fs.readFileSync = originalReadFileSync
    fs.promises.readFile = originalReadFile
  }

  if (global.prismaGlobal) {
    failures.push('NO_LOGIN_FAIL HARNESS /api status=real-prisma prismaTouched=true detail=the real PrismaClient was constructed')
  }

  for (const url of knownImports) {
    if (importFailed.includes(url)) counts.importKnownFailures += 1
    else {
      failures.push(
        'NO_LOGIN_FAIL IMPORT ' + url + ' status=import-ok prismaTouched=false detail=listed import failure imported successfully',
      )
    }
  }

  const elapsedMs = Date.now() - started
  for (const line of failures) process.stdout.write(line + '\n')
  process.stdout.write(
    'NO_LOGIN_SUMMARY' +
    ' discovered=' + counts.discovered +
    ' writeCalled=' + counts.writeCalled +
    ' authReject=' + counts.authReject +
    ' rejectedBeforeAuth=' + counts.rejectedBeforeAuth +
    ' allowlisted=' + counts.allowlisted +
    ' importKnownFailures=' + counts.importKnownFailures +
    ' readOnly=' + counts.readOnly +
    ' failures=' + failures.length +
    ' elapsedMs=' + elapsedMs +
    '\n',
  )
  if (failures.length > 0) assert.fail(failures.length + ' write routes failed the no-session check')
  process.stdout.write('NO_LOGIN_TEST_PASS\n')
})
