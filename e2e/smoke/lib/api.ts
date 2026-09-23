import type { APIRequestContext } from '@playwright/test'

// Thin wrappers around the same authenticated JSON routes the app's own UI
// calls (never Prisma/raw SQL, see CLAUDE.md "Hypertask app operations").
// `request` is Playwright's APIRequestContext, already carrying the
// account's storageState cookies via playwright.config.smoke.ts.
//
// Every shape below was read directly from the route/controller source
// (src/pages/api/..., src/utils/controllers/...), not guessed, but never
// exercised against a live account in this build, since no
// ~/.config/ht-qa/state*.json exists yet. Confirm on the first real run.

export type BootstrapTeam = { id: number; googleAccountId: number | null; projects: Array<{ id: number; title: string }> }
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

// src/utils/controllers/projects/create.ts 400s unless ALL FOUR of these
// are truthy, including googleAccountId, a team with no linked Google
// account (googleAccountId: null in the bootstrap teams slice) cannot
// create a board through this route today. That's a real constraint, not
// an oversight here; callers must check for it (boardSetup.ts does).
// Also 403s via isBoardLimitReached: a Free-tier account already owning 3
// boards cannot create a 4th (FREE_BOARD_LIMIT = 3).
export async function createProject(
  request: APIRequestContext,
  { userId, teamId, title, googleAccountId }: { userId: number; teamId: number; title: string; googleAccountId: number },
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
): Promise<{ project: { id: number; section: Array<{ id: number; title: string }> }; tasks: BoardTask[] }> {
  const res = await request.post('/api/projects/boardTasks', { data: { projectId } })
  if (!res.ok()) throw new Error(`boardTasks failed: HTTP ${res.status()} ${await res.text()}`)
  return res.json()
}

// The direct-response branch in src/pages/api/tasks/create.ts needs
// ranking + section (a section TITLE string) + sectionId, or it falls into
// a lookup branch that can leave the request hanging with no response.
// fullScreenTask: true is what makes the response come back wrapped as
// { newTask }; response is normalized here regardless, since the exact
// branch taken by an unfamiliar section/ranking combination isn't 100%
// certain without a live run.
export async function createTask(
  request: APIRequestContext,
  { title, projectId, sectionId, sectionTitle }: { title: string; projectId: number; sectionId: number; sectionTitle: string },
): Promise<{ id: number; uniqueIndex: number }> {
  const res = await request.post('/api/tasks/create', {
    data: { title, projectId, sectionId, section: sectionTitle, ranking: '1', fullScreenTask: true },
  })
  if (!res.ok()) throw new Error(`task create failed: HTTP ${res.status()} ${await res.text()}`)
  const body = await res.json()
  const task = body.newTask ?? body
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
