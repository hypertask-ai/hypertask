const test = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { createServer } = require('node:http')
const { chmod, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

async function runFiler(t, verdicts, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'strix-file-tickets-'))
  const run = join(root, 'run')
  const app = join(root, 'app')
  const bin = join(root, 'bin')
  const capture = join(root, 'ssh-input')
  const requests = []
  t.after(() => rm(root, { force: true, recursive: true }))
  await mkdir(run)
  await mkdir(join(app, 'src'), { recursive: true })
  await mkdir(bin)
  await writeFile(
    join(app, 'src', 'example.ts'),
    'export function readAccount(accountId) {\n  return db.account.findUnique({ where: { id: accountId } })\n}\n',
  )
  await writeFile(
    join(run, 'vulnerabilities.json'),
    JSON.stringify([
      {
        id: 'STRIX-1',
        title: 'Account lookup misses an ownership check',
        severity: 'high',
        description: 'A caller can request an account that belongs to another user.',
        impact: 'People could read another account.',
        technical_analysis: 'The lookup accepts an account id without an owner filter.',
        reproduction: ['Call the route with another account id.'],
        code_locations: options.codeLocations ?? [
          { file: 'src/example.ts', start_line: 1, end_line: 3 },
        ],
      },
    ]),
  )
  const ssh = join(bin, 'ssh')
  await writeFile(ssh, '#!/bin/bash\ncat > "$SSH_CAPTURE"\nprintf 200\n')
  await chmod(ssh, 0o755)

  const replies = [...verdicts]
  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      requests.push(JSON.parse(body))
      const verdict = replies.shift()
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ verdict, reason: `${verdict} by test` }) } }],
      }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const { port } = server.address()

  const result = await execFileAsync('python3', ['scripts/strix-file-tickets.py', run], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: root,
      HYPERTASKS_JWT_TOKEN: 'test-token',
      PATH: `${bin}:/usr/bin:/bin`,
      SSH_CAPTURE: capture,
      STRIX_APP: app,
      STRIX_CONFIRM_API_BASE: `http://127.0.0.1:${port}/v1`,
      STRIX_CONFIRM_API_KEY: 'test-key',
      STRIX_CONFIRM_MODEL: 'test-model',
      STRIX_FILED_STATE: join(root, 'filed.json'),
    },
  })
  return { ...result, capture, requests }
}

test('Strix filer creates a ticket only after two confirmations', async (t) => {
  const result = await runFiler(t, ['confirmed', 'confirmed'])

  assert.match(result.stdout, /confirmed twice \(confirmed\/confirmed\)/)
  assert.match(result.stdout, /filed: Account lookup misses an ownership check/)
  assert.equal(result.requests.length, 2)
  for (const request of result.requests) {
    assert.equal(request.model, 'test-model')
    assert.match(request.messages[0].content, /src\/example\.ts lines 1-3/)
    assert.match(request.messages[0].content, /Do not trust the finding's conclusion/)
  }

  const remote = await readFile(result.capture, 'utf8')
  const payload = JSON.parse(remote.match(/JSONEOF'\n(\{.*\})\nJSONEOF/s)[1])
  assert.equal(payload.sectionId, 4389)
  assert.equal(payload.assignee, undefined)
  assert.ok(payload.title.length <= 80)
  assert.match(payload.description, /<strong>What went wrong<\/strong>/)
  assert.match(payload.description, /<strong>What changes<\/strong>/)
  assert.match(payload.description, /<strong>Done when<\/strong>/)
})

test('Strix filer rejects a finding when either confirmation disagrees', async (t) => {
  const result = await runFiler(t, ['confirmed', 'rejected'])

  assert.match(result.stdout, /skip \(not confirmed twice:/)
  assert.equal(result.requests.length, 2)
  await assert.rejects(readFile(result.capture, 'utf8'), { code: 'ENOENT' })
})

test('Strix filer rejects findings without readable current source', async (t) => {
  const result = await runFiler(t, ['confirmed', 'confirmed'], {
    codeLocations: [{ file: 'src/missing.ts', snippet: 'scanner-provided evidence' }],
  })

  assert.match(result.stdout, /skip \(confirmation failed\):/)
  assert.match(result.stdout, /no readable current-source evidence/)
  assert.equal(result.requests.length, 0)
  await assert.rejects(readFile(result.capture, 'utf8'), { code: 'ENOENT' })
})
