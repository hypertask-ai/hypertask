import type { APIRequestContext } from '@playwright/test'

// Thin wrappers around the same authenticated JSON routes the app's own UI
// calls (never Prisma/raw SQL, see CLAUDE.md "Hypertask app operations").
// `request` is Playwright's APIRequestContext, already carrying the
// account's storageState cookies via playwright.config.smoke.ts.
//
// Every shape below was read from the route/controller source
// (src/pages/api/..., src/utils/controllers/...) and checked against a live
// free-tier account on the first real run (HTPR-6636).

// Team ids and googleAccountIds are UUID strings in the live payload, not numbers.
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

// Each bootstrap slice races an 800ms timeout (src/lib/appShellBootstrap/server.ts
// SLICE_TIMEOUT_MS) and comes back { ok: false } when it loses, e.g. on a cold
// start. The app's own client treats that as "not preloaded" and fetches the
// data itself, so a slow slice is not "this account has no team". Retry a few
// times and keep "timed out" and "really empty" apart in the error.
export async function fetchBootstrapWithTeams(request: APIRequestContext): Promise<Bootstrap & { teams: BootstrapTeam[] }> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const bootstrap = await fetchBootstrap(request)
    const teams = bootstrap.slices.teams
    if (teams?.ok) return { ...bootstrap, teams: teams.data }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt))
  }
  throw new Error('bootstrap teams slice did not load (timed out 4 times), cannot tell whether this account has a team')
}

// src/utils/controllers/projects/create.ts 400s unless ALL FOUR of these
// are truthy, including googleAccountId, a team with no linked Google
// account (googleAccountId: null in the bootstrap teams slice) cannot
// create a board through this route today. That's a real constraint, not
// an oversight here; callers must check for it (boardSetup.ts does).
// Also 403s via isBoardLimitReached: a Free-tier account already owning 3
// boards cannot create a 4th (FREE_BOARD_LIMIT = 3).
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

// POST, not GET, src/pages/api/projects/boardTasks.ts takes projectId in
// the JSON body. Response is { project, tasks, allViews }, not a bare array.
export async function fetchBoardTasks(
  request: APIRequestContext,
  projectId: number,
): Promise<{ project: { id: number; section: Array<{ id: number; section_title: string }> }; tasks: BoardTask[] }> {
  const res = await request.post('/api/projects/boardTasks', { data: { projectId } })
  if (!res.ok()) throw new Error(`boardTasks failed: HTTP ${res.status()} ${await res.text()}`)
  return res.json()
}

// fullScreenTask: true takes the createFullScreenTaskAndReturn branch of
// src/pages/api/tasks/create.ts: it picks the board's first visible section
// itself, but takes the creator from body.userId. Without userId the task
// controller throws and the route answers 500 "Something Went Wrong!".
// The response is double-wrapped: { newTask: { message, error, newTask: task } }.
export async function createTask(
  request: APIRequestContext,
  { title, projectId, userId }: { title: string; projectId: number; userId: number },
): Promise<{ id: number; uniqueIndex: number }> {
  // Two creates on the same board at the same moment can both pick the same
  // next ticket number and one fails with 500 (a real product race, reported
  // separately). The suite runs 4 workers on one board, so retry here to keep
  // that race from failing unrelated journeys.
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

// The real UI delete is two steps (src/utils/api/global/apiHelpers/deleteTask.ts
// + src/pages/api/tasks/deleteTask.ts): soft-delete via the queue route
// (sets status "Deleted", schedules a 30-day undo), then the DELETE route
// finalizes it immediately, DELETE alone 404s on a task that's still
// "Normal". Both steps here, so cleanup actually removes the row rather
// than leaving a 30-day-dangling soft-deleted task on the QA runner board.
export async function deleteTask(request: APIRequestContext, taskId: number): Promise<void> {
  const soft = await request.post('/api/queues/tasks/taskDeleteReminder', { data: { taskId } })
  if (!soft.ok()) throw new Error(`soft-delete failed for task ${taskId}: HTTP ${soft.status()}`)

  const hard = await request.delete(`/api/tasks/deleteTask?taskId=${taskId}`)
  if (!hard.ok() && hard.status() !== 404) {
    throw new Error(`hard-delete failed for task ${taskId}: HTTP ${hard.status()}`)
  }
}
