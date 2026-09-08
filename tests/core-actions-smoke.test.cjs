const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')

const taskId = 7
const projectId = 4
const userId = 3
const agentId = '00000000-0000-4000-8000-000000000001'

async function withServer(options, verify) {
  const state = {
    assigned: false,
    comments: [{ id: 10, text: '<p>existing</p>' }],
    nextCommentId: 11,
    section: 'Todo',
    sectionId: 20,
  }
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const send = (status, value) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    let body = null
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
    } catch {
      return send(400, { message: 'Invalid JSON' })
    }
    const expectedMethods = new Map([
      ['/api/tasks/single', 'GET'],
      ['/api/projects/boardTasks', 'POST'],
      ['/api/comments/getByTask', 'GET'],
      ['/api/comments/create', 'POST'],
      ['/api/comments/deleteCommentById', 'POST'],
      ['/api/tasks/moveTask', 'PUT'],
      ['/api/assignees/assign', 'POST'],
      ['/api/tasks/searchAll', 'POST'],
    ])
    const expectedMethod = expectedMethods.get(url.pathname)
    if (expectedMethod && request.method !== expectedMethod) {
      return send(405, { message: 'Method not allowed' })
    }
    const addActivity = () => {
      state.comments.push({
        id: state.nextCommentId++,
        text: '<p>activity</p>',
      })
    }

    if (url.pathname === '/api/tasks/single') {
      if (options.failOpen) return send(500, { message: 'simulated failure' })
      return send(200, {
        id: taskId,
        projectId,
        section: state.section,
        sectionId: state.sectionId,
      })
    }
    if (url.pathname === '/api/projects/boardTasks') {
      return send(200, {
        project: { id: projectId },
        tasks: [
          {
            id: taskId,
            assignees: state.assigned ? [{ userId, agentId: null }] : [],
          },
        ],
      })
    }
    if (url.pathname === '/api/comments/getByTask') {
      return send(200, {
        comments: state.comments,
        lastReadAt: null,
        agentRunActivities: [],
      })
    }
    if (url.pathname === '/api/comments/create') {
      const comment = { id: state.nextCommentId++, text: body.text }
      state.comments.push(comment)
      return send(200, comment)
    }
    if (url.pathname === '/api/comments/deleteCommentById') {
      state.comments = state.comments.filter((comment) => comment.id !== body.id)
      return send(200, { message: 'Comment deleted' })
    }
    if (url.pathname === '/api/tasks/moveTask') {
      if (!request.headers.cookie) return send(401, { message: 'Unauthorized' })
      state.section = body.section_title
      state.sectionId = body.sectionId
      addActivity()
      return send(200, {
        id: taskId,
        section: state.section,
        sectionId: state.sectionId,
      })
    }
    if (url.pathname === '/api/assignees/assign') {
      state.assigned = body.intent === 'assign'
      addActivity()
      return send(200, {
        body: state.assigned ? [{ userId, agentId: null }] : [],
      })
    }
    if (url.pathname === '/api/tasks/searchAll') {
      if (options.failSearch) return send(500, { message: 'simulated failure' })
      return send(200, [{ id: taskId }])
    }
    send(404, { message: 'Not found' })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const address = server.address()
    const result = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [path.join(process.cwd(), 'scripts/core-actions-smoke.mjs')],
        {
          env: {
            ...process.env,
            CORE_SMOKE_BASE_URL: `http://127.0.0.1:${address.port}`,
            CORE_SMOKE_COOKIE: 'nookies_user=test; ht_session=test',
            CORE_SMOKE_PROJECT_ID: String(projectId),
            CORE_SMOKE_TASK_ID: String(taskId),
            CORE_SMOKE_USER_ID: String(userId),
            CORE_SMOKE_USER_NAME: 'Smoke User',
            CORE_SMOKE_AGENT_ID: agentId,
            CORE_SMOKE_AGENT_NAME: 'Smoke Agent',
            CORE_SMOKE_TARGET_SECTION_ID: '21',
            CORE_SMOKE_TARGET_SECTION_TITLE: 'Doing',
            CORE_SMOKE_SEARCH_TEXT: 'core-actions-smoke',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000)
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      child.on('close', (status, signal) => {
        clearTimeout(timeout)
        resolve({ status, signal, stdout, stderr })
      })
    })
    await verify({ result, state })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('core actions smoke fails on a non-2xx task response', async () => {
  await withServer({ failOpen: true }, ({ result }) => {
    assert.equal(result.status, 1)
    assert.match(result.stderr, /open task: 500/)
  })
})

test('core actions smoke restores state after a late failure', async () => {
  await withServer({ failSearch: true }, ({ result, state }) => {
    assert.equal(result.status, 1)
    assert.match(result.stderr, /search: 500/)
    assert.equal(state.sectionId, 20)
    assert.equal(state.section, 'Todo')
    assert.equal(state.assigned, false)
    assert.deepEqual(state.comments, [{ id: 10, text: '<p>existing</p>' }])
  })
})

test('core actions smoke passes all eight actions and removes its mutations', async () => {
  await withServer({}, ({ result, state }) => {
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /8 actions returned 2xx/)
    assert.equal(state.sectionId, 20)
    assert.equal(state.assigned, false)
    assert.deepEqual(state.comments, [{ id: 10, text: '<p>existing</p>' }])
  })
})
