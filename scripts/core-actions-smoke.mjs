const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

const config = {
  baseUrl: required('CORE_SMOKE_BASE_URL').replace(/\/$/, ''),
  cookie: required('CORE_SMOKE_COOKIE'),
  projectId: Number(required('CORE_SMOKE_PROJECT_ID')),
  taskId: Number(required('CORE_SMOKE_TASK_ID')),
  userId: Number(required('CORE_SMOKE_USER_ID')),
  userName: required('CORE_SMOKE_USER_NAME'),
  agentId: required('CORE_SMOKE_AGENT_ID'),
  agentName: required('CORE_SMOKE_AGENT_NAME'),
  targetSectionId: Number(required('CORE_SMOKE_TARGET_SECTION_ID')),
  targetSectionTitle: required('CORE_SMOKE_TARGET_SECTION_TITLE'),
  searchText: required('CORE_SMOKE_SEARCH_TEXT'),
}
const moveTaskPath = '/api/tasks/moveTask'

for (const [name, value] of Object.entries(config)) {
  if (typeof value === 'number' && (!Number.isInteger(value) || value < 1)) {
    throw new Error(`Invalid ${name}`)
  }
}

const request = async (label, path, { authenticated = true, body, method = 'GET' } = {}) => {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(authenticated ? { cookie: config.cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`${label}: ${response.status} returned non-JSON: ${text.slice(0, 160)}`)
  }
  if (!response.ok) {
    throw new Error(`${label}: ${response.status} ${JSON.stringify(json).slice(0, 240)}`)
  }
  return { json, status: response.status }
}

const expect = (condition, message) => {
  if (!condition) throw new Error(message)
}

const loadTask = async () => {
  const { json, status } = await request('open task', `/api/tasks/single?id=${config.taskId}`)
  expect(status === 200 && json?.id === config.taskId, 'open task: persisted task was missing')
  return json
}

const loadBoard = async () => {
  const { json, status } = await request('open board', '/api/projects/boardTasks', {
    method: 'POST',
    body: { projectId: config.projectId },
  })
  expect(
    status === 200 && json?.project?.id === config.projectId,
    'open board: project was missing',
  )
  expect(
    json.tasks?.some((task) => task.id === config.taskId),
    'open board: task was missing',
  )
  return json
}

const loadComments = async () => {
  const { json, status } = await request(
    'load comments',
    `/api/comments/getByTask?taskId=${config.taskId}`,
  )
  expect(status === 200 && Array.isArray(json?.comments), 'load comments: invalid response')
  return json.comments
}

const isHumanAssigned = (board) => {
  const task = board.tasks.find((candidate) => candidate.id === config.taskId)
  return (
    task?.assignees?.some((assignee) => assignee.userId === config.userId && !assignee.agentId) ??
    false
  )
}

const setHumanAssignment = async (assigned) => {
  const action = assigned ? 'assign' : 'unassign'
  const { json, status } = await request(`${action} user`, '/api/assignees/assign', {
    method: 'POST',
    body: { userId: config.userId, taskId: config.taskId, intent: action },
  })
  expect(status === 200 && Array.isArray(json?.body), `${action} user: invalid response`)
  expect(isHumanAssigned(await loadBoard()) === assigned, `${action} user: state did not persist`)
}

const moveTask = async (sectionId, sectionTitle, label) => {
  const { status } = await request(label, moveTaskPath, {
    method: 'PUT',
    body: {
      taskId: config.taskId,
      section_title: sectionTitle,
      sectionId,
      projectId: config.projectId,
    },
  })
  expect(status === 200, `${label}: invalid response`)
  expect((await loadTask()).sectionId === sectionId, `${label}: state did not persist`)
}

const createComment = async (text, label) => {
  const { json, status } = await request(label, '/api/comments/create', {
    method: 'POST',
    body: {
      text,
      creatorId: config.userId,
      ownerId: config.userId,
      taskId: config.taskId,
    },
  })
  expect(status === 200 && Number.isInteger(json?.id), `${label}: invalid response`)
  const comments = await loadComments()
  expect(
    comments.some((comment) => comment.id === json.id),
    `${label}: state did not persist`,
  )
}

const cleanup = async ({ initialCommentIds, initialHumanAssigned, initialTask }) => {
  const failures = []
  const attempt = async (label, operation) => {
    try {
      await operation()
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : error}`)
    }
  }

  await attempt('restore column', async () => {
    if ((await loadTask()).sectionId !== initialTask.sectionId) {
      await moveTask(initialTask.sectionId, initialTask.section, 'restore column')
    }
  })
  await attempt('restore assignment', async () => {
    const assigned = isHumanAssigned(await loadBoard())
    if (assigned !== initialHumanAssigned) await setHumanAssignment(initialHumanAssigned)
  })
  await attempt('remove generated comments', async () => {
    const comments = await loadComments()
    for (const comment of comments) {
      if (!initialCommentIds.has(comment.id)) {
        await request(`delete comment ${comment.id}`, '/api/comments/deleteCommentById', {
          method: 'POST',
          body: { id: comment.id },
        })
      }
    }
    const remaining = await loadComments()
    expect(
      remaining.every((comment) => initialCommentIds.has(comment.id)),
      'generated comments remained after cleanup',
    )
  })

  if (failures.length) throw new Error(`cleanup failed: ${failures.join('; ')}`)
}

const run = async () => {
  const initialTask = await loadTask()
  expect(initialTask.sectionId, 'open task: source section was missing')
  expect(initialTask.section, 'open task: source section title was missing')
  expect(
    initialTask.sectionId !== config.targetSectionId,
    'move task: target must differ from source',
  )
  const initialBoard = await loadBoard()
  const initialHumanAssigned = isHumanAssigned(initialBoard)
  const initialCommentIds = new Set((await loadComments()).map((comment) => comment.id))
  let primaryFailure

  try {
    const unauthenticated = await fetch(`${config.baseUrl}${moveTaskPath}`, {
      method: 'PUT',
      redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        taskId: config.taskId,
        section_title: config.targetSectionTitle,
        sectionId: config.targetSectionId,
        projectId: config.projectId,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    expect(
      unauthenticated.status >= 400 && unauthenticated.status < 500,
      'unauthenticated move was not rejected',
    )
    expect(
      (await loadTask()).sectionId === initialTask.sectionId,
      'unauthenticated move changed the task',
    )

    await createComment(`<p>core-actions smoke ${config.searchText}</p>`, 'post comment')
    const mentionText = [
      '<p>',
      `<span data-type="mention" class="mention" data-id="${config.userName}" data-label="name-${config.userId}">${config.userName}</span>`,
      ' ',
      `<span data-type="mention" class="mention" data-id="${config.agentName}" data-label="agent-${config.agentId}">${config.agentName}</span>`,
      '</p>',
    ].join('')
    await createComment(mentionText, 'mention user and agent')
    await moveTask(config.targetSectionId, config.targetSectionTitle, 'move task')
    await setHumanAssignment(!initialHumanAssigned)
    await setHumanAssignment(initialHumanAssigned)
    const { json: search, status } = await request('search', '/api/tasks/searchAll', {
      method: 'POST',
      body: {
        projectIds: [config.projectId],
        searchQuery: config.searchText,
      },
    })
    expect(status === 200 && Array.isArray(search), 'search: invalid response')
    expect(
      search.some((task) => task.id === config.taskId),
      'search: seeded task was missing',
    )
  } catch (error) {
    primaryFailure = error
  }

  try {
    await cleanup({ initialCommentIds, initialHumanAssigned, initialTask })
  } catch (cleanupError) {
    const cleanupMessage =
      cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
    if (primaryFailure) {
      throw new Error(
        `${primaryFailure instanceof Error ? primaryFailure.message : primaryFailure}; ${cleanupMessage}`,
      )
    }
    throw cleanupError
  }
  if (primaryFailure) throw primaryFailure
  console.log('Core actions smoke passed: 8 actions returned 2xx and persisted correctly.')
}

await run()
