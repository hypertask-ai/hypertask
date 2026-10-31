import type { APIRequestContext } from '@playwright/test'


export type BootstrapTeam = { id: string; googleAccountId: string | null; projects: Array<{ id: number; title: string }> }
export type Bootstrap = {
  accountId: number
  slices: {
    user?: { ok: true; data: { id: number } } | { ok: false }
    teams?: { ok: true; data: BootstrapTeam[] } | { ok: false }
  }
}

export async function fetchBootstrap(request: APIRequestContext): Promise<Bootstrap> {
  const res = await request.post('/api/app-shell/bootstrap')
  if (!res.ok()) throw new Error(`bootstrap failed: HTTP ${res.status()}`)
  return res.json()
}

export async function fetchBootstrapWithTeams(request: APIRequestContext): Promise<Bootstrap & { teams: BootstrapTeam[] }> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const bootstrap = await fetchBootstrap(request)
    const teams = bootstrap.slices.teams
    if (teams?.ok) return { ...bootstrap, teams: teams.data }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt))
  }
  throw new Error('bootstrap teams slice did not load (timed out 4 times), cannot tell whether this account has a team')
}

export async function createProject(
  request: APIRequestContext,
  { userId, teamId, title, googleAccountId }: { userId: number; teamId: string; title: string; googleAccountId: string },
): Promise<{ id: number; title: string; section: Array<{ id: number; title: string }> }> {
  const res = await request.post('/api/projects/create', {
    data: { userId, teamId, title, googleAccountId },
  })
  if (!res.ok()) throw new Error(`project create failed: HTTP ${res.status()} ${await res.text()}`)
  return res.json()
}

export type ProjectMember = { role: string; user: { id: number; email?: string } }

export async function getProjectMembers(
  request: APIRequestContext,
  projectId: number,
): Promise<{ members: ProjectMember[]; owner: { id: number; email?: string } }> {
  const res = await request.get(`/api/members/getAllForAssignees?projectId=${projectId}`)
  if (!res.ok()) throw new Error(`getAllForAssignees failed: HTTP ${res.status()}`)
  return res.json()
}

export type BoardTask = { id: number; title: string; status: string; updatedAt?: string }

export async function fetchBoardTasks(
  request: APIRequestContext,
  projectId: number,
): Promise<{ project: { id: number; section: Array<{ id: number; section_title: string }> }; tasks: BoardTask[] }> {
  const res = await request.post('/api/projects/boardTasks', { data: { projectId } })
  if (!res.ok()) throw new Error(`boardTasks failed: HTTP ${res.status()} ${await res.text()}`)
  return res.json()
}

export async function createTask(
  request: APIRequestContext,
  { title, projectId, userId }: { title: string; projectId: number; userId: number },
): Promise<{ id: number; uniqueIndex: number }> {
  let res = await request.post('/api/tasks/create', { data: { title, projectId, userId, fullScreenTask: true } })
  for (let attempt = 1; attempt <= 3 && res.status() === 500; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 300 * attempt + Math.random() * 300))
    res = await request.post('/api/tasks/create', { data: { title, projectId, userId, fullScreenTask: true } })
  }
  if (!res.ok()) throw new Error(`task create failed: HTTP ${res.status()} ${await res.text()}`)
  const body = await res.json()
  const task = body.newTask?.newTask ?? body.newTask ?? body
  if (!task?.id) throw new Error(`task create returned no task id: ${JSON.stringify(body).slice(0, 300)}`)
  return task
}

export async function deleteTask(request: APIRequestContext, taskId: number): Promise<void> {
  const soft = await request.post('/api/queues/tasks/taskDeleteReminder', { data: { taskId } })
  if (!soft.ok()) throw new Error(`soft-delete failed for task ${taskId}: HTTP ${soft.status()}`)

  const hard = await request.delete(`/api/tasks/deleteTask?taskId=${taskId}`)
  if (!hard.ok() && hard.status() !== 404) {
    throw new Error(`hard-delete failed for task ${taskId}: HTTP ${hard.status()}`)
  }
}
