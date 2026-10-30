import type { APIRequestContext } from '@playwright/test'
import { createProject, deleteTask, fetchBoardTasks, fetchBootstrapWithTeams, getProjectMembers } from './api'

export const QA_RUNNER_BOARD_TITLE = 'QA runner board'

export const QA_TASK_PREFIX = '[qa-runner]'

export class BoardNotOwnedSolelyError extends Error {}

export type QaRunnerBoard = {
  userId: number
  projectId: number
  boardPath: string
  sectionId: number
  sectionTitle: string
}

export async function ensureQaRunnerBoard(request: APIRequestContext): Promise<QaRunnerBoard> {
  const bootstrap = await fetchBootstrapWithTeams(request)
  const userId = bootstrap.slices.user?.ok ? bootstrap.slices.user.data.id : bootstrap.accountId
  if (!userId) throw new Error('bootstrap did not return a logged-in user, is the session valid?')

  const teams = bootstrap.teams
  if (teams.length === 0) throw new Error('bootstrap loaded but this account really has no team')

  let projectId: number | undefined
  for (const team of teams) {
    const match = team.projects.find((p) => p.title === QA_RUNNER_BOARD_TITLE)
    if (match) {
      projectId = match.id
      break
    }
  }

  if (!projectId) {
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

  return { userId, projectId, boardPath: `/project?id=${projectId}`, sectionId: section.id, sectionTitle: section.section_title }
}

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
