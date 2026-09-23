import type { APIRequestContext } from '@playwright/test'
import { createProject, deleteTask, fetchBoardTasks, fetchBootstrap, getProjectMembers } from './api'

// The owner's approval (HTPR-6636) covers writes ONLY on a private board
// named exactly this, owned by the test account, with no other members.
// Never rename this without updating the ticket approval.
export const QA_RUNNER_BOARD_TITLE = 'QA runner board'

// Every task this suite creates carries this prefix so the cleanup sweep
// can find and remove leftovers without touching anything a human put on
// the board by mistake.
export const QA_TASK_PREFIX = '[qa-runner]'

export class BoardNotOwnedSolelyError extends Error {}

export type QaRunnerBoard = {
  projectId: number
  boardPath: string
  sectionId: number
  sectionTitle: string
}

// Find "QA runner board" for the logged-in account, creating it if it
// doesn't exist yet. Refuses (throws) if the board has any member besides
// the account itself, the owner's approval doesn't cover a shared board.
export async function ensureQaRunnerBoard(request: APIRequestContext): Promise<QaRunnerBoard> {
  const bootstrap = await fetchBootstrap(request)
  const userSlice = bootstrap.slices.user
  if (!userSlice?.ok) throw new Error('bootstrap did not return a logged-in user, is the session valid?')
  const userId = userSlice.data.id

  const teamsSlice = bootstrap.slices.teams
  if (!teamsSlice?.ok || teamsSlice.data.length === 0) throw new Error('bootstrap returned no teams for this account')
  const teams = teamsSlice.data

  let projectId: number | undefined
  for (const team of teams) {
    const match = team.projects.find((p) => p.title === QA_RUNNER_BOARD_TITLE)
    if (match) {
      projectId = match.id
      break
    }
  }

  if (!projectId) {
    // src/utils/controllers/projects/create.ts 400s without a non-null
    // googleAccountId on the team, pick the first team that has one.
    const team = teams.find((t) => t.googleAccountId != null)
    if (!team) {
      throw new Error(
        `no team on this account has a linked googleAccountId, /api/projects/create requires one and cannot create ` +
          `"${QA_RUNNER_BOARD_TITLE}" without it. This needs a human decision (open question in the PR description), not a workaround here.`,
      )
    }
    const created = await createProject(request, { userId, teamId: team.id, title: QA_RUNNER_BOARD_TITLE, googleAccountId: team.googleAccountId! })
    projectId = created.id
  }

  const { members, owner } = await getProjectMembers(request, projectId)
  const others = members.filter((m) => m.user.id !== userId).concat(owner.id !== userId ? [{ role: 'Admin', user: owner }] : [])
  if (others.length > 0) {
    throw new BoardNotOwnedSolelyError(
      `"${QA_RUNNER_BOARD_TITLE}" (project ${projectId}) has ${others.length} member(s) besides the test account, ` +
        'refusing to run write journeys on a board that isn\'t solely owned by the test account.',
    )
  }

  const { project } = await fetchBoardTasks(request, projectId)
  const section = project.section?.[0]
  if (!section) throw new Error(`"${QA_RUNNER_BOARD_TITLE}" (project ${projectId}) has no sections to create tasks in`)

  return { projectId, boardPath: `/detail/project-${projectId}`, sectionId: section.id, sectionTitle: section.title }
}

// Deletes any [qa-runner] task on the board older than an hour, a
// best-effort sweep for leftovers from a run that crashed before its own
// afterEach cleanup ran. Never touches a task without the prefix.
export async function sweepStaleQaTasks(request: APIRequestContext, projectId: number): Promise<number> {
  const { tasks } = await fetchBoardTasks(request, projectId)
  const oneHourAgo = Date.now() - 60 * 60 * 1000

  let removed = 0
  for (const task of tasks) {
    if (!task.title?.startsWith(QA_TASK_PREFIX)) continue
    const updatedAt = task.updatedAt ? new Date(task.updatedAt).getTime() : 0
    if (updatedAt && updatedAt > oneHourAgo) continue
    await deleteTask(request, task.id)
    removed++
  }
  return removed
}
