const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { execFile, spawnSync } = require('node:child_process')
const { generateKeyPairSync } = require('node:crypto')
const { mkdir, mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const dir = '.github/scripts/subscription-review'
const tokenScript = `${dir}/review-app-token`
const hasJwt = spawnSync('python3', ['-c', 'import jwt']).status === 0

function isoIn(ms) {
  return new Date(Date.now() + ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

async function setup(t, respond) {
  const root = await mkdtemp(join(tmpdir(), 'review-app-token-'))
  const etc = join(root, 'etc')
  const state = join(root, 'state')
  await mkdir(etc)
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  await writeFile(join(etc, 'review-app.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }))
  await writeFile(join(etc, 'review-app.env'), 'APP_ID=123\nINSTALLATION_ID=456\n')
  const hits = { count: 0, paths: [] }
  const server = http.createServer((req, res) => {
    hits.count += 1
    hits.paths.push(`${req.method} ${req.url}`)
    respond(res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.close()
    await rm(root, { force: true, recursive: true })
  })
  const env = {
    ...process.env,
    HYPERTASK_REVIEW_APP_ETC: etc,
    HYPERTASK_REVIEW_STATE_ROOT: state,
    HYPERTASK_REVIEW_APP_API: `http://127.0.0.1:${server.address().port}`,
  }
  const run = () =>
    execFileAsync('python3', [tokenScript], { env }).then(
      (r) => ({ code: 0, stdout: r.stdout, stderr: r.stderr }),
      (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }),
    )
  return { state, hits, run }
}

const ok = (res) => {
  res.writeHead(201, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ token: 'test-token-1', expires_at: isoIn(3600e3) }))
}

test('review-app-token mints, caches and re-mints after expiry', { skip: !hasJwt && 'PyJWT missing' }, async (t) => {
  const { state, hits, run } = await setup(t, ok)

  const first = await run()
  assert.equal(first.code, 0, first.stderr)
  const confPath = first.stdout.trim()
  assert.equal(confPath, join(state, 'app-token', 'curl.conf'))
  assert.equal((await stat(confPath)).mode & 0o777, 0o600)
  assert.match(await readFile(confPath, 'utf8'), /Authorization: token test-token-1/)
  assert.equal(hits.count, 1)
  assert.equal(hits.paths[0], 'POST /app/installations/456/access_tokens')

  const second = await run()
  assert.equal(second.code, 0)
  assert.equal(second.stdout.trim(), confPath)
  assert.equal(hits.count, 1, 'second run must use the cache')

  await writeFile(
    join(state, 'app-token', 'token.json'),
    JSON.stringify({ expires_at: Math.floor(Date.now() / 1000) - 5 }),
  )
  const third = await run()
  assert.equal(third.code, 0, third.stderr)
  assert.equal(hits.count, 2, 'expired token must be minted again')
})

test('review-app-token exits 1 with empty stdout when GitHub answers 500', { skip: !hasJwt && 'PyJWT missing' }, async (t) => {
  const { run } = await setup(t, (res) => {
    res.writeHead(500)
    res.end('{}')
  })
  const result = await run()
  assert.equal(result.code, 1)
  assert.equal(result.stdout, '')
  assert.doesNotMatch(result.stderr, /test-token/)
})

test('dispatch scripts use the App config for the app repo and the old credential for the reviewer repo', async () => {
  for (const name of ['dispatch-scan', 'dispatch-review']) {
    const text = await readFile(`${dir}/${name}`, 'utf8')
    assert.match(text, /app_config=\$\(.*hypertask-review-app-token/)
    assert.match(text, /app_config=\$curl_config/, `${name} keeps the fallback line`)
    const calls = text
      .replace(/\\\n\s*/g, ' ')
      .split('\n')
      .filter((l) => /--config "\$(app|curl)_config"/.test(l))
    assert.ok(calls.length > 0)
    for (const line of calls) {
      if (line.includes('repos/hypertask-ai/hypertask/')) assert.match(line, /--config "\$app_config"/, line)
      if (line.includes('repos/hypertask-ai/reviewer/')) assert.match(line, /--config "\$curl_config"/, line)
    }
  }
  const install = await readFile(`${dir}/install-wrappers.sh`, 'utf8')
  assert.match(install, /review-app-token" \/usr\/local\/libexec\/hypertask-review-app-token/)
})
